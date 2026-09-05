// Deterministic, memory-backed rendering for the thin renderer.
//
// renderFrame(state, size) returns semantic content lines; it performs no I/O
// and no padding, so tests can assert exact snapshots for a fixed terminal
// size. The driver pads each line to the terminal width before writing.

import type { AppState } from "../shared/model.ts";
import { MIN_COLUMNS, MIN_ROWS } from "../shared/model.ts";
import { clustersOf, measureWidth, truncateTo } from "./width.ts";

export interface Size {
  readonly columns: number;
  readonly rows: number;
}

const TITLE = "Book Title Lookup - thin renderer spike";

export function isTooSmall(size: Size): boolean {
  return size.columns < MIN_COLUMNS || size.rows < MIN_ROWS;
}

export function cursorColumn(state: AppState): number {
  const prefix = measureWidth("Search: ");
  const before = state.query.text === ""
    ? 0
    : clustersOf(state.query.text).slice(0, state.query.cursor)
      .reduce((sum, cluster) => sum + cluster.width, 0);
  return prefix + before;
}

/** Render one frame as content lines for the requested terminal size. */
export function renderFrame(state: AppState, size: Size): readonly string[] {
  if (isTooSmall(size)) {
    return [
      TITLE,
      `Terminal too small: need at least ${MIN_COLUMNS}x${MIN_ROWS}.`,
      `Current size: ${size.columns}x${size.rows}.`,
      "Resize the window to continue.",
    ];
  }
  if (state.screen === "results") {
    return renderResults(state, size);
  }
  return renderSearch(state, size);
}

function renderSearch(state: AppState, size: Size): readonly string[] {
  const query = state.status === "searching"
    ? `${state.query.text}…`
    : state.query.text;
  const caret = state.status === "searching"
    ? []
    : [`${" ".repeat(cursorColumn(state))}|`];
  return [
    TITLE,
    `Search: ${query}`,
    ...caret,
    "Enter=search  Backspace=delete  Ctrl+C=quit",
    state.notice === "" ? " " : state.notice,
    "minimum terminal 60x16",
  ].map((line) => truncateTo(line, size.columns));
}

function renderResults(state: AppState, size: Size): readonly string[] {
  const lines: string[] = [
    TITLE,
    `Candidates for '${state.query.text}':`,
  ];
  for (let index = 0; index < state.candidates.length; index += 1) {
    const candidate = state.candidates[index];
    const marker = index === state.selected ? ">" : " ";
    lines.push(
      `${marker} ${index + 1}. ${candidate.title} (${candidate.language})`,
    );
  }
  lines.push(
    "Up/Down=select  Backspace=back  Ctrl+C=quit",
    state.notice === "" ? " " : state.notice,
    "minimum terminal 60x16",
  );
  return lines.map((line) => truncateTo(line, size.columns));
}
