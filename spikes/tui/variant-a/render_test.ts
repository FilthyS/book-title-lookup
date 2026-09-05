// Deterministic rendering tests: exact content snapshots for fixed sizes and
// width invariants for the driver's padding step.

import { assertEquals } from "jsr:@std/assert@1.0.15";
import { DEMO_CANDIDATES } from "../shared/demo.ts";
import { type AppState, initialState } from "../shared/model.ts";
import { update } from "../shared/update.ts";
import { cursorColumn, renderFrame, type Size } from "./render.ts";
import { measureWidth, padTo } from "./width.ts";

const SIZE_60x16: Size = { columns: 60, rows: 16 };

function searchState(): AppState {
  return initialState();
}

function resultsState(): AppState {
  const typed = update(searchState(), { type: "text", value: "百年孤独" });
  const searching = update(typed, { type: "submit" });
  return update(searching, {
    type: "resultsReceived",
    requestId: searching.activeRequestId as number,
    candidates: DEMO_CANDIDATES,
    ok: true,
  });
}

Deno.test("search frame renders an exact snapshot at 60x16", () => {
  const lines = renderFrame(searchState(), SIZE_60x16);
  assertEquals(lines, [
    "Book Title Lookup - thin renderer spike",
    "Search: ",
    "        |",
    "Enter=search  Backspace=delete  Ctrl+C=quit",
    "Type a Chinese title and press Enter to search.",
    "minimum terminal 60x16",
  ]);
});

Deno.test("results frame renders an exact snapshot at 60x16", () => {
  const lines = renderFrame(resultsState(), SIZE_60x16);
  assertEquals(lines, [
    "Book Title Lookup - thin renderer spike",
    "Candidates for '百年孤独':",
    "> 1. 百年孤独 (zh)",
    "  2. One Hundred Years of Solitude (en)",
    "  3. 百年の孤独 (ja)",
    "  4. 小王子 (zh)",
    "  5. The Little Prince (en)",
    "Up/Down=select  Backspace=back  Ctrl+C=quit",
    "Use Up/Down to select, Backspace to return to the query.",
    "minimum terminal 60x16",
  ]);
});

Deno.test("cursor column accounts for double-width Chinese", () => {
  let state = update(searchState(), { type: "text", value: "小王子" });
  state = update(state, { type: "home" });
  state = update(state, { type: "move", step: 1 });
  const lines = renderFrame(state, SIZE_60x16);
  // "Search: " is 8 columns; 小 contributes 2 => caret lands at column 10.
  assertEquals(cursorColumn(state), 10);
  assertEquals(lines[2], `${" ".repeat(10)}|`);
});

Deno.test("searching frame shows progress text and no caret", () => {
  const typed = update(searchState(), { type: "text", value: "活着" });
  const searching = update(typed, { type: "submit" });
  const lines = renderFrame(searching, SIZE_60x16);
  assertEquals(lines[1], "Search: 活着…");
  assertEquals(lines.includes("        |"), false);
});

Deno.test("below-minimum size renders the size message", () => {
  const lines = renderFrame(searchState(), { columns: 40, rows: 10 });
  assertEquals(lines, [
    "Book Title Lookup - thin renderer spike",
    "Terminal too small: need at least 60x16.",
    "Current size: 40x10.",
    "Resize the window to continue.",
  ]);
});

Deno.test("padded driver lines all have the exact terminal width", () => {
  const frames: readonly (readonly string[])[] = [
    renderFrame(searchState(), SIZE_60x16),
    renderFrame(resultsState(), SIZE_60x16),
    renderFrame(searchState(), { columns: 120, rows: 40 }),
  ];
  for (const frame of frames) {
    for (const line of frame) {
      assertEquals(measureWidth(padTo(line, SIZE_60x16.columns)), 60);
    }
  }
});

Deno.test("long CJK lines are truncated to the terminal width without splitting graphemes", () => {
  const long = update(searchState(), {
    type: "text",
    value: "百年孤独".repeat(40),
  });
  const lines = renderFrame(long, { columns: 60, rows: 16 });
  assertEquals(measureWidth(lines[1]), 60);
  // Truncation must end on a grapheme boundary: no half CJK character.
  assertEquals(lines[1].length, 34); // 8 prefix + 26 CJK code points (52 columns)
});
