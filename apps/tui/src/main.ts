/**
 * apps/tui composition root (issue #32 / ticket #15, extended for lookup and
 * the interactive TUI).
 *
 * Wires the real streams, environment reader, filesystem seam, platform kind,
 * clock, and randomness into the CLI driver, owns the SIGINT/SIGTERM abort
 * controller, and maps the returned exit code onto the process. Lookup
 * commands run one-shot directed sessions over the fixture catalog in this
 * slice; a no-command run in a terminal starts the interactive TUI over the
 * real two-source composition.
 */

import {
  type CliDeps,
  runCli,
  type TextWriter,
  type TuiDeps,
} from "./cli/dispatch.ts";
import {
  systemEnvironment,
} from "../../../packages/providers/src/platform/env.ts";
import {
  DenoFileSystemSeam,
} from "../../../packages/providers/src/cache/fs-seam.ts";
import {
  detectPlatformKind,
} from "../../../packages/providers/src/platform/platform.ts";
import { systemClock } from "../../../packages/providers/src/cache/clock.ts";
import {
  systemRandomSource,
} from "../../../packages/providers/src/cache/random.ts";
import type { TerminalIo } from "./tui/terminal.ts";
import { defaultTerminalInputEncoding } from "./tui/input-decoder.ts";

const encoder = new TextEncoder();

export function syncWriter(stream: {
  writeSync(data: Uint8Array): number;
}): TextWriter {
  return {
    write(text: string): Promise<void> {
      const data = encoder.encode(text);
      let offset = 0;
      while (offset < data.length) {
        const written = stream.writeSync(data.subarray(offset));
        if (written <= 0 || written > data.length - offset) {
          throw new Error("The output stream did not accept written data.");
        }
        offset += written;
      }
      return Promise.resolve();
    },
  };
}

function readChunk(): Promise<Uint8Array | null> {
  const buffer = new Uint8Array(256);
  return Deno.stdin.read(buffer).then((read) =>
    read === null ? null : buffer.slice(0, read)
  );
}

const TERMINAL_SIZE_POLL_MS = 100;

function tuiIo(): TerminalIo {
  const write = syncWriter(Deno.stdout);
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return {
    read: readChunk,
    inputEncoding: defaultTerminalInputEncoding(Deno.build.os, locale),
    write: (text: string) => write.write(text),
    setRawMode: (raw: boolean): Promise<void> => {
      Deno.stdin.setRaw(raw);
      return Promise.resolve();
    },
    size: () => Deno.consoleSize(),
    watchSize: (listener: () => void): () => void => {
      let previous = Deno.consoleSize();
      const timer = setInterval(() => {
        const next = Deno.consoleSize();
        if (
          next.columns === previous.columns &&
          next.rows === previous.rows
        ) {
          return;
        }
        previous = next;
        listener();
      }, TERMINAL_SIZE_POLL_MS);
      return () => clearInterval(timer);
    },
  };
}

function tuiDeps(): TuiDeps | undefined {
  let stdinIsTty = false;
  let stdoutIsTty = false;
  try {
    stdinIsTty = Deno.stdin.isTerminal();
    stdoutIsTty = Deno.stdout.isTerminal();
  } catch {
    // Fall through with the flags false: the terminal is never acquired.
  }
  return { stdinIsTty, stdoutIsTty, io: tuiIo() };
}

async function entry(): Promise<void> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  const signals: Deno.Signal[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    try {
      Deno.addSignalListener(signal, onSignal);
    } catch {
      // A platform may not support the listener; the abort controller stays
      // available for in-process cancellation.
    }
  }

  const deps: CliDeps = {
    stdout: syncWriter(Deno.stdout),
    stderr: syncWriter(Deno.stderr),
    env: systemEnvironment,
    fs: new DenoFileSystemSeam(),
    platform: detectPlatformKind(Deno.build.os),
    clock: systemClock,
    random: systemRandomSource,
    signal: controller.signal,
    tui: tuiDeps(),
  };

  const exitCode = await runCli(Deno.args, deps);

  for (const signal of signals) {
    try {
      Deno.removeSignalListener(signal, onSignal);
    } catch {
      // Ignore removal failures; the process is about to exit.
    }
  }
  Deno.exit(exitCode);
}

if (import.meta.main) {
  await entry();
}
