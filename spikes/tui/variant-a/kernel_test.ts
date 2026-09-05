// Deterministic kernel tests: the full update -> render -> write loop runs
// against memory streams, proving the pure-state integration criterion without
// a physical terminal.

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.15";
import { DEMO_CANDIDATES } from "../shared/demo.ts";
import type { Candidate } from "../shared/model.ts";
import { enterAlternateScreen, leaveAlternateScreen } from "./ansi.ts";
import {
  EOF,
  type InputSource,
  runSession,
  type SessionDeps,
} from "./kernel.ts";
import type { Size } from "./render.ts";

class StringSink {
  value = "";

  write(data: string): void {
    this.value += data;
  }
}

class SequenceInput implements InputSource {
  private index = 0;

  constructor(private readonly items: (Uint8Array | typeof EOF)[]) {}

  async next(): Promise<Uint8Array | null | typeof EOF> {
    if (this.index >= this.items.length) {
      return EOF;
    }
    return this.items[this.index++];
  }
}

const encoder = new TextEncoder();

function sessionOverrides(
  input: InputSource,
  sink: StringSink,
): SessionDeps {
  return {
    input,
    output: sink,
    size: () => ({ columns: 60, rows: 16 }),
    onSearch: async (query: string) => {
      if (query === "fail") {
        return [];
      }
      return DEMO_CANDIDATES;
    },
    terminalControl: true,
  };
}

Deno.test("session paints search, submits, navigates, and restores the terminal", async () => {
  const sink = new StringSink();
  const input = new SequenceInput([
    encoder.encode("百年孤独"),
    new Uint8Array([0x0d]), // Enter
    new Uint8Array([0x1b, 0x5b, 0x42]), // Down arrow
    new Uint8Array([0x03]), // Ctrl+C
  ]);
  const deps = sessionOverrides(input, sink);
  await runSession(deps);

  const output = sink.value;
  assertEquals(output.startsWith(enterAlternateScreen()), true);
  assertEquals(output.endsWith(leaveAlternateScreen()), true);

  const searchAt = output.indexOf("Search: 百年孤独");
  const candidatesAt = output.indexOf("Candidates for '百年孤独':");
  const selectedAt = output.indexOf("> 2. One Hundred Years of Solitude (en)");
  const hintAt = output.indexOf("Up/Down=select  Backspace=back  Ctrl+C=quit");
  const leaveAt = output.indexOf(leaveAlternateScreen());
  assertStringIncludes(output, "Book Title Lookup - thin renderer spike");
  assertStringIncludes(output, "Searching for “百年孤独”");
  for (const index of [searchAt, candidatesAt, selectedAt, hintAt]) {
    assertEquals(index >= 0, true);
    assertEquals(index < leaveAt, true);
  }
  assertEquals(selectedAt > candidatesAt, true);
});

Deno.test("session reports a no-result effect without disturbing restoration", async () => {
  const sink = new StringSink();
  const input = new SequenceInput([
    encoder.encode("fail"),
    new Uint8Array([0x0d]),
    new Uint8Array([0x03]),
  ]);
  const deps = sessionOverrides(input, sink);
  await runSession(deps);
  assertStringIncludes(sink.value, "No candidates found.");
  assertEquals(sink.value.endsWith(leaveAlternateScreen()), true);
});

Deno.test("session restores the terminal when the input source throws", async () => {
  const sink = new StringSink();
  const throwingInput: InputSource = {
    next: async () => {
      throw new Error("boom");
    },
  };
  const deps = sessionOverrides(throwingInput, sink);
  await assertRejects(() => runSession(deps), Error, "boom");
  assertEquals(sink.value.endsWith(leaveAlternateScreen()), true);
});

Deno.test("session repaints the size message when the terminal shrinks", async () => {
  const sink = new StringSink();
  let current: Size = { columns: 60, rows: 16 };
  let calls = 0;
  const input: InputSource = {
    next: async () => {
      calls += 1;
      if (calls === 2) {
        current = { columns: 40, rows: 10 };
      }
      if (calls === 1) {
        return encoder.encode("x");
      }
      return calls === 2 ? encoder.encode("y") : EOF;
    },
  };
  const deps: SessionDeps = {
    input,
    output: sink,
    size: () => current,
    onSearch: async () => [],
    terminalControl: true,
  };
  await runSession(deps);
  assertStringIncludes(sink.value, "Terminal too small: need at least 60x16.");
  assertStringIncludes(sink.value, "Current size: 40x10.");
  assertEquals(sink.value.endsWith(leaveAlternateScreen()), true);
});

Deno.test("shared fixture keeps the demo corpus stable", () => {
  const sample: Candidate = DEMO_CANDIDATES[0];
  assertEquals(sample.title, "百年孤独");
});
