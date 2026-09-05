/**
 * apps/tui composition root (issue #32 / ticket #15, extended for lookup).
 *
 * Wires the real streams, environment reader, filesystem seam, platform kind,
 * clock, and randomness into the CLI driver, owns the SIGINT/SIGTERM abort
 * controller, and maps the returned exit code onto the process. Lookup
 * commands run one-shot directed sessions over the fixture catalog in this
 * slice; the full-screen TUI arrives in a later slice.
 */

import { type CliDeps, runCli, type TextWriter } from "./cli/dispatch.ts";
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

const encoder = new TextEncoder();

function syncWriter(stream: {
  writeSync(data: Uint8Array): number;
}): TextWriter {
  return {
    write(text: string): Promise<void> {
      stream.writeSync(encoder.encode(text));
      return Promise.resolve();
    },
  };
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
