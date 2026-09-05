// Variant A entry point: the thin project-owned ANSI renderer.
//
// Run from an interactive Windows Terminal session:
//   deno run --no-prompt variant-a/main_a.ts
// or compiled (no grants needed):
//   deno compile -o out/variant-a.exe variant-a/main_a.ts
//
// Non-interactive stdin/stdout never starts the full-screen TUI.

import { simulateSearch } from "../shared/demo.ts";
import { EOF, type InputSource, runSession } from "./kernel.ts";
import type { Size } from "./render.ts";

const POLL_MS = 150;

function isInteractive(): boolean {
  try {
    return Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

function currentSize(): Size {
  const size = Deno.consoleSize();
  return { columns: size.columns, rows: size.rows };
}

class StdinInput implements InputSource {
  #queue: Uint8Array[] = [];
  #done = false;
  #error: unknown;

  constructor() {
    // Read stdin in the background so kernel polling never loses input.
    void (async () => {
      try {
        for await (const chunk of Deno.stdin.readable) {
          this.#queue.push(chunk);
        }
      } catch (error) {
        this.#error = error;
      } finally {
        this.#done = true;
      }
    })();
  }

  async next(): Promise<Uint8Array | null | typeof EOF> {
    while (true) {
      if (this.#queue.length > 0) {
        return this.#queue.shift() as Uint8Array;
      }
      if (this.#error !== undefined) {
        throw this.#error;
      }
      if (this.#done) {
        return EOF;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      // A null tick lets the session re-check the terminal size.
      return null;
    }
  }
}

async function main(): Promise<void> {
  if (!isInteractive()) {
    console.error(
      "[spike variant-a] non-interactive stdin/stdout detected; " +
        "the TUI does not start. Run this from Windows Terminal.",
    );
    return;
  }
  const encoder = new TextEncoder();
  const stdoutWriter = (data: string): void => {
    Deno.stdout.writeSync(encoder.encode(data));
  };
  Deno.stdin.setRaw(true, { cbreak: true });
  try {
    await runSession({
      input: new StdinInput(),
      output: { write: stdoutWriter },
      size: currentSize,
      onSearch: simulateSearch,
      terminalControl: true,
      pollResize: true,
    });
  } finally {
    // Never leave the user's terminal in raw mode.
    try {
      Deno.stdin.setRaw(false);
    } catch {
      // Best effort; runSession already restored the alternate screen.
    }
  }
}

if (import.meta.main) {
  await main();
}
