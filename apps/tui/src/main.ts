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
import { systemEnvironment } from "../../../packages/providers/src/platform/env.ts";
import { NodeFileSystemSeam } from "../../../packages/providers/src/cache/fs-seam.ts";
import { detectPlatformKind } from "../../../packages/providers/src/platform/platform.ts";
import { systemClock } from "../../../packages/providers/src/cache/clock.ts";
import { systemRandomSource } from "../../../packages/providers/src/cache/random.ts";
import type { TerminalIo } from "./tui/terminal.ts";
import { DEFAULT_TERMINAL_INPUT_ENCODING } from "./tui/input-decoder.ts";

const encoder = new TextEncoder();

export function streamWriter(stream: {
  write(data: Uint8Array, callback: (error?: Error | null) => void): boolean;
}): TextWriter {
  return {
    write(text: string): Promise<void> {
      const data = encoder.encode(text);
      return new Promise((resolve, reject) => {
        stream.write(data, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function tuiIo(): TerminalIo {
  const write = streamWriter(process.stdout);
  const input = process.stdin[Symbol.asyncIterator]();
  return {
    read: async (): Promise<Uint8Array | null> => {
      const next = await input.next();
      if (next.done) return null;
      return typeof next.value === "string"
        ? encoder.encode(next.value)
        : new Uint8Array(next.value);
    },
    inputEncoding: DEFAULT_TERMINAL_INPUT_ENCODING,
    write: (text: string) => write.write(text),
    setRawMode: (raw: boolean): Promise<void> => {
      if (typeof process.stdin.setRawMode !== "function") {
        throw new Error("stdin does not support raw terminal mode");
      }
      process.stdin.setRawMode(raw);
      return Promise.resolve();
    },
    size: () => ({
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    }),
    watchSize: (listener: () => void): (() => void) => {
      process.stdout.on("resize", listener);
      return () => process.stdout.off("resize", listener);
    },
  };
}

function tuiDeps(): TuiDeps | undefined {
  const stdinIsTty = process.stdin.isTTY === true;
  const stdoutIsTty = process.stdout.isTTY === true;
  return { stdinIsTty, stdoutIsTty, io: tuiIo() };
}

export async function entry(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    try {
      process.on(signal, onSignal);
    } catch {
      // A platform may not support the listener; the abort controller stays
      // available for in-process cancellation.
    }
  }

  const deps: CliDeps = {
    stdout: streamWriter(process.stdout),
    stderr: streamWriter(process.stderr),
    env: systemEnvironment,
    fs: new NodeFileSystemSeam(),
    platform: detectPlatformKind(process.platform),
    clock: systemClock,
    random: systemRandomSource,
    signal: controller.signal,
    tui: tuiDeps(),
  };

  try {
    return await runCli(argv, deps);
  } finally {
    for (const signal of signals) {
      try {
        process.off(signal, onSignal);
      } catch {
        // Ignore removal failures; the process is about to exit.
      }
    }
  }
}
