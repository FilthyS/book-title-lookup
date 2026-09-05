// No-command TUI mode-selection tests (issue #12 section 3.1 rows X6/X7,
// issue #13 section 13.1). These assert which no-command invocations start the
// interactive TUI and that every other path never acquires the terminal.

import { assertEquals } from "@std/assert";
import { type CliDeps, runCli } from "./dispatch.ts";
import { createFakeBookTitleCatalog } from "../catalog/fixture-catalog.ts";
import {
  type EnvironmentReader,
  MemoryEnvironment,
} from "../../../../packages/providers/src/platform/env.ts";
import {
  DenoFileSystemSeam,
} from "../../../../packages/providers/src/cache/fs-seam.ts";
import { FixedClock } from "../../../../packages/providers/src/cache/clock.ts";
import {
  systemRandomSource,
} from "../../../../packages/providers/src/cache/random.ts";
import {
  detectPlatformKind,
} from "../../../../packages/providers/src/platform/platform.ts";
import type { TerminalIo, TerminalSize } from "../tui/terminal.ts";

const platform = detectPlatformKind(Deno.build.os);
const FIXED = "2026-09-05T00:00:00.000Z";

function profileEnv(root: string): Record<string, string> {
  if (platform === "windows") {
    return {
      APPDATA: root + "\\config",
      LOCALAPPDATA: root + "\\local",
      USERPROFILE: root + "\\user",
    };
  }
  return {
    HOME: root + "/home",
    XDG_CONFIG_HOME: root + "/config",
    XDG_CACHE_HOME: root + "/local",
  };
}
function writer() {
  const chunks: string[] = [];
  return {
    write(text: string): Promise<void> {
      chunks.push(text);
      return Promise.resolve();
    },
    text(): string {
      return chunks.join("");
    },
  };
}

/** A memory terminal whose reads come from a bounded queue then EOF. */
function makeTerminal(chunks: readonly (readonly number[])[]) {
  let index = 0;
  const writes: string[] = [];
  const raws: boolean[] = [];
  const io: TerminalIo = {
    read(): Promise<Uint8Array | null> {
      if (index >= chunks.length) return Promise.resolve(null);
      const chunk = Uint8Array.from(chunks[index]);
      index += 1;
      return Promise.resolve(chunk);
    },
    write(text: string): Promise<void> {
      writes.push(text);
      return Promise.resolve();
    },
    setRawMode(raw: boolean): Promise<void> {
      raws.push(raw);
      return Promise.resolve();
    },
    size(): TerminalSize {
      return { columns: 60, rows: 16 };
    },
  };
  return { io, writes, raws };
}

interface Built {
  deps: CliDeps;
  stdout: { text(): string };
  stderr: { text(): string };
  writes: string[];
  raws: boolean[];
}

function makeDeps(options: {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly io: TerminalIo;
  readonly writes: string[];
  readonly raws: boolean[];
  readonly env?: EnvironmentReader;
  readonly signal?: AbortSignal;
}): Built {
  const stdout = writer();
  const stderr = writer();
  return {
    stdout,
    stderr,
    writes: options.writes,
    raws: options.raws,
    deps: {
      stdout,
      stderr,
      env: options.env ?? new MemoryEnvironment({}),
      fs: new DenoFileSystemSeam(),
      platform,
      clock: new FixedClock(FIXED),
      random: systemRandomSource,
      signal: options.signal,
      catalog: createFakeBookTitleCatalog(),
      tui: {
        stdinIsTty: options.stdinIsTty,
        stdoutIsTty: options.stdoutIsTty,
        io: options.io,
      },
    },
  };
}

Deno.test("X6 no-command TTY without --json starts the TUI and exits 0 on quit", async () => {
  // ESC then a harmless byte quits the TUI normally (exit 0).
  const term = makeTerminal([[0x1b, 0x61]]);
  const built = makeDeps({
    stdinIsTty: true,
    stdoutIsTty: true,
    ...term,
  });
  const code = await runCli([], built.deps);
  assertEquals(code, 0);
  assertEquals(built.stdout.text(), "", "no CLI usage on stdout in TUI mode");
  assertEquals(term.raws, [true, false], "terminal was acquired and restored");
  const output = term.writes.join("");
  assertEquals(output.includes("Book Title Lookup"), true);
});

Deno.test("no-command TUI exits 130 and restores on an injected OS signal abort", async () => {
  // An empty terminal stream reaches EOF immediately; the session then waits
  // for an outcome or an external interrupt. Aborting the injected signal
  // (OS SIGINT/SIGTERM) must drive exit 130 through the coordinator.
  const controller = new AbortController();
  const term = makeTerminal([]);
  const built = makeDeps({
    stdinIsTty: true,
    stdoutIsTty: true,
    signal: controller.signal,
    ...term,
  });
  const run = runCli([], built.deps);
  controller.abort();
  const code = await run;
  assertEquals(code, 130);
  assertEquals(built.stdout.text(), "", "no CLI usage on stdout in TUI mode");
  assertEquals(term.raws, [true, false], "terminal was acquired and restored");
});

Deno.test("X7 no-command with --json never starts the TUI or acquires a terminal", async () => {
  const term = makeTerminal([]);
  const built = makeDeps({ stdinIsTty: true, stdoutIsTty: true, ...term });
  const code = await runCli(["--json"], built.deps);
  assertEquals(code, 2);
  assertEquals(built.stdout.text(), "", "no stdout");
  assertEquals(built.stderr.text().includes("no command given"), true);
  assertEquals(term.raws.length, 0, "terminal never acquired");
});

Deno.test("no-command with non-TTY stdin and no --json is exit 2 without acquiring", async () => {
  const term = makeTerminal([]);
  const built = makeDeps({ stdinIsTty: false, stdoutIsTty: true, ...term });
  const code = await runCli([], built.deps);
  assertEquals(code, 2);
  assertEquals(built.stdout.text(), "");
  assertEquals(term.raws.length, 0, "terminal never acquired");
});

Deno.test("an explicit command never acquires the terminal even on a TTY", async () => {
  const term = makeTerminal([]);
  const root = `${Deno.cwd()}/.tmp/tui-mode-explicit`;
  await Deno.mkdir(root, { recursive: true });
  try {
    const built = makeDeps({
      stdinIsTty: true,
      stdoutIsTty: true,
      ...term,
      env: new MemoryEnvironment(profileEnv(root)),
    });
    const code = await runCli(["config", "show", "--json"], built.deps);
    assertEquals(code, 0, built.stderr.text());
    assertEquals(
      term.raws.length,
      0,
      "explicit command never touches the terminal",
    );
    assertEquals(term.writes.length, 0, "no TUI frames were ever written");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
