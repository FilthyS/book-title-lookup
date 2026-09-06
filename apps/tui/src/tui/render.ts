// Deterministic, memory-backed rendering for the thin renderer (issue #13
// section 5; docs/design/tui-rendering-strategy.md).
//
// renderFrame(state, size, selection) returns semantic content lines; it
// performs no I/O and no padding, so tests assert exact snapshots. The driver
// pads and truncates each line to the terminal width before writing. The
// renderer projects only display shapes: it never emits an opaque module
// ref (issue #13 section 9 no-leak rule).

import type {
  CandidatesState,
  GroupDetailState,
  QueryState,
  ResolvedState,
  ResolvingState,
  SearchingState,
  SessionState,
  TitlesLoadingState,
  TitlesState,
} from "../coordinator/state.ts";
import { clustersOf, measureWidth, padTo, truncateTo } from "./width.ts";
import type { TerminalSize } from "./terminal.ts";

/** Minimum supported terminal size from docs/product-spec.md. */
export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;

const TITLE = "B O O K   T I T L E   L O O K U P";
const PLAIN_TITLE = "Book Title Lookup";
export const QUERY_CURSOR_ROW = 3;

/** Driver-local selection used to place markers on list stations. */
export type UiLayout = "stacked" | "compact";

export interface UiSelection {
  readonly groups: number;
  readonly layout: UiLayout;
}

export const initialUiSelection: UiSelection = Object.freeze({
  groups: 0,
  layout: "stacked",
});

export function isTooSmall(size: TerminalSize): boolean {
  return size.columns < MIN_COLUMNS || size.rows < MIN_ROWS;
}

function titleText(state: SessionState): string {
  return state.draft.fields.title.text;
}

/** The input box prefix "│ " plus the width of title text before the cursor. */
export function cursorColumn(state: SessionState): number {
  const prefix = measureWidth("│ ");
  const text = titleText(state);
  const before = text === ""
    ? 0
    : clustersOf(text.slice(0, state.draft.fields.title.cursor))
      .reduce((sum, cluster) => sum + cluster.width, 0);
  return prefix + before;
}

export function noticeLine(state: SessionState): string | null {
  switch (state.screen) {
    case "query":
    case "candidates":
    case "resolved":
    case "titles":
      return state.notice === null ? null : noticeText(state.notice);
    default:
      return null;
  }
}

/** Stable English text for each structured notice message key. */
export function noticeText(
  notice: { readonly messageKey: string },
): string {
  let text: string;
  switch (notice.messageKey) {
    case "lookup.notFound":
      text = "No matching work was found.";
      break;
    case "lookup.interrupted":
      text = "The lookup was interrupted.";
      break;
    case "lookup.failed":
      text = "The lookup failed.";
      break;
    case "titles.none":
      text = "No attested title matched the requested languages.";
      break;
    case "results.partial":
      text = "Some sources could not be queried; the result may be partial.";
      break;
    case "input.invalid":
      text = "Enter a non-empty title (year, when given, must be 1-9999).";
      break;
    default:
      text = "";
  }
  const warnings = "warnings" in notice
    ? (notice as { warnings: unknown[] })
      .warnings.length
    : 0;
  const failures = "failures" in notice
    ? (notice as { failures: unknown[] })
      .failures.length
    : 0;
  if (failures > 0) return `${text} (${failures} source failure(s))`;
  if (warnings > 0) return `${text} (${warnings} warning(s))`;
  return text;
}

const MAX_LIST = 10;

interface VisibleWindow<T> {
  readonly items: readonly T[];
  readonly start: number;
  readonly before: number;
  readonly after: number;
}

/**
 * Keep a fixed-size list window anchored to the current selection. Once the
 * selection moves past the last visible row, the window follows it one row at
 * a time instead of leaving the cursor off-screen.
 */
function visibleWindow<T>(
  items: readonly T[],
  selected: number,
  limit = MAX_LIST,
): VisibleWindow<T> {
  const anchor = Math.max(0, Math.min(selected, items.length - 1));
  const latestStart = Math.max(0, items.length - limit);
  const start = Math.min(Math.max(0, anchor - limit + 1), latestStart);
  const end = Math.min(items.length, start + limit);
  return {
    items: items.slice(start, end),
    start,
    before: start,
    after: items.length - end,
  };
}

function hiddenItemsLine(
  direction: "up" | "down",
  count: number,
  singular: string,
): string {
  const arrow = direction === "up" ? "↑" : "↓";
  const position = direction === "up" ? "earlier" : "more";
  const label = count === 1 ? singular : `${singular}s`;
  return `  ${arrow} ${count} ${position} ${label}`;
}

function visibleItemLimit(
  size: TerminalSize,
  rowsPerItem: number,
  extraRows = 0,
): number {
  // Header, optional up/down overflow markers, and the key-hint footer.
  const reservedRows = 6 + extraRows;
  return Math.max(
    1,
    Math.min(MAX_LIST, Math.floor((size.rows - reservedRows) / rowsPerItem)),
  );
}

function boxTop(label: string, width: number): string {
  const available = Math.max(0, width - 2);
  const decorated = truncateTo(` ${label} `, available);
  return `┌${decorated}${
    "─".repeat(Math.max(0, available - measureWidth(decorated)))
  }┐`;
}

function boxRow(content: string, width: number): string {
  const innerWidth = Math.max(0, width - 4);
  return `│ ${padTo(truncateTo(content, innerWidth), innerWidth)} │`;
}

function boxBottom(width: number): string {
  return `└${"─".repeat(Math.max(0, width - 2))}┘`;
}

function otherLayout(layout: UiLayout): UiLayout {
  return layout === "stacked" ? "compact" : "stacked";
}

/** Render one frame as content lines for the requested terminal size. */
export function renderFrame(
  state: SessionState,
  size: TerminalSize,
  selection: UiSelection = initialUiSelection,
): readonly string[] {
  if (isTooSmall(size)) {
    const lines = [
      PLAIN_TITLE,
      `Terminal too small: need at least ${MIN_COLUMNS}x${MIN_ROWS}.`,
      `Current size: ${size.columns}x${size.rows}.`,
      "Resize the window to continue.",
    ];
    return lines.map((line) => truncateTo(line, Math.max(0, size.columns)));
  }
  switch (state.screen) {
    case "query":
      return renderQuery(state, size);
    case "searching":
      return renderSearching(state);
    case "candidates":
      return renderCandidates(state, size, selection.layout);
    case "resolving":
      return renderResolving(state);
    case "resolved":
      return renderResolved(state);
    case "titles_loading":
      return renderTitlesLoading(state);
    case "titles":
      return renderTitles(state, size, selection);
    case "group_detail":
      return renderGroupDetail(state);
  }
}

function queryFilterLine(state: SessionState): readonly string[] {
  const lines: string[] = [];
  const author = state.draft.fields.author.text.trim();
  const isbn = state.draft.fields.isbn.text.trim();
  const year = state.draft.fields.year.text.trim();
  const parts: string[] = [];
  if (author !== "") parts.push(`author: ${author}`);
  if (isbn !== "") parts.push(`isbn: ${isbn}`);
  if (year !== "") parts.push(`year: ${year}`);
  if (parts.length > 0) lines.push(parts.join("   "));
  return lines;
}

function renderQuery(
  state: QueryState,
  size: TerminalSize,
): readonly string[] {
  const text = titleText(state);
  const lines: string[] = [
    TITLE,
    boxTop("TITLE INPUT", size.columns),
    boxRow(text, size.columns),
    boxBottom(size.columns),
    ...queryFilterLine(state),
    "Enter=search  Esc=quit  Ctrl+C=interrupt",
  ];
  const notice = noticeLine(state);
  if (notice !== null) lines.push(notice);
  return lines;
}

function renderSearching(state: SearchingState): readonly string[] {
  return [
    TITLE,
    `Searching for '${state.query.title}'…`,
    "",
    "Esc=cancel  Ctrl+C=interrupt",
  ];
}

function renderCandidates(
  state: CandidatesState,
  size: TerminalSize,
  layout: UiLayout,
): readonly string[] {
  const lines: string[] = [
    TITLE,
    `Query: ${titleText(state)}`,
    `Work candidates — ${layout} layout`,
  ];
  const rows = state.pool.rows;
  const notice = noticeLine(state);
  const rowsPerItem = layout === "stacked" ? 4 : 1;
  const window = visibleWindow(
    rows,
    state.selected,
    visibleItemLimit(size, rowsPerItem, notice === null ? 0 : 1),
  );
  if (window.before > 0) {
    lines.push(hiddenItemsLine("up", window.before, "candidate"));
  }
  for (let offset = 0; offset < window.items.length; offset += 1) {
    const index = window.start + offset;
    const row = window.items[offset];
    const marker = index === state.selected ? ">" : " ";
    const authors = row.authors.join(", ");
    const langs = row.contentLanguages.join("/");
    if (layout === "stacked") {
      const details = [authors, langs].filter((part) => part !== "").join(
        " · ",
      );
      lines.push(
        boxTop(`${marker} ${index + 1}`, size.columns),
        boxRow(row.title, size.columns),
        boxRow(details, size.columns),
        boxBottom(size.columns),
      );
    } else {
      lines.push(
        `${marker} ${index + 1}. ${row.title}${
          authors === "" ? "" : ` — ${authors}`
        }${langs === "" ? "" : `  [${langs}]`}`,
      );
    }
  }
  if (window.after > 0) {
    lines.push(hiddenItemsLine("down", window.after, "candidate"));
  }
  lines.push(
    `Up/Down=select Enter=confirm Tab=${otherLayout(layout)} ` +
      "N=new search Esc=back ^C=quit",
  );
  if (notice !== null) lines.push(notice);
  return lines;
}

function renderResolving(state: ResolvingState): readonly string[] {
  return [
    TITLE,
    state.goal.kind === "resolve"
      ? "Resolving the work…"
      : "Resolving and gathering titles…",
    "",
    "Esc=cancel  Ctrl+C=interrupt",
  ];
}

function renderResolved(state: ResolvedState): readonly string[] {
  const work = state.snapshot.work;
  const lines: string[] = [
    TITLE,
    `Resolved: ${work.title}`,
    work.authors.length === 0 ? "" : `by ${work.authors.join(", ")}`,
    "",
  ];
  const notice = noticeLine(state);
  if (notice !== null) lines.push(notice, "");
  if (state.goal.kind === "lookup") {
    lines.push("Enter=titles  N=new search  Esc=back  Ctrl+C=interrupt");
  } else {
    lines.push("N=new search  Esc=back  Ctrl+C=interrupt");
  }
  return lines;
}

function renderTitlesLoading(_state: TitlesLoadingState): readonly string[] {
  return [
    TITLE,
    "Loading title groups…",
    "",
    "Esc=cancel  Ctrl+C=interrupt",
  ];
}

function renderTitles(
  state: TitlesState,
  size: TerminalSize,
  selection: UiSelection,
): readonly string[] {
  const groups = state.payload.groups;
  const notice = noticeLine(state);
  const lines: string[] = [
    TITLE,
    `Title groups for '${state.snapshot.work.title}':`,
    `${selection.layout === "stacked" ? "Stacked" : "Compact"} layout`,
  ];
  const rowsPerItem = selection.layout === "stacked" ? 3 : 1;
  const window = visibleWindow(
    groups,
    selection.groups,
    visibleItemLimit(size, rowsPerItem, notice === null ? 0 : 1),
  );
  if (window.before > 0) {
    lines.push(hiddenItemsLine("up", window.before, "title group"));
  }
  for (let offset = 0; offset < window.items.length; offset += 1) {
    const index = window.start + offset;
    const group = window.items[offset];
    const marker = index === selection.groups ? ">" : " ";
    const flags = [
      group.language,
      group.level,
      group.originalTitle ? "original" : "",
    ].filter((part) => part !== "").join(" ");
    if (selection.layout === "stacked") {
      const stackedFlags = [
        group.language,
        group.level,
        group.originalTitle ? "original" : "",
      ].filter((part) => part !== "").join(" · ");
      lines.push(
        boxTop(`${marker} ${index + 1} · ${stackedFlags}`, size.columns),
        boxRow(group.title, size.columns),
        boxBottom(size.columns),
      );
    } else {
      lines.push(`${marker} ${index + 1}. ${group.title}  [${flags}]`);
    }
  }
  if (groups.length === 0) lines.push("(no groups listed)");
  if (window.after > 0) {
    lines.push(hiddenItemsLine("down", window.after, "title group"));
  }
  lines.push(
    `Up/Down=select Enter=detail Tab=${otherLayout(selection.layout)} ` +
      "N=new search Esc=back ^C=quit",
  );
  if (notice !== null) lines.push(notice);
  return lines;
}

function renderGroupDetail(state: GroupDetailState): readonly string[] {
  const group = state.payload.groups[state.groupIndex];
  if (group === undefined) {
    return [
      TITLE,
      "(group unavailable)",
      "N=new search  Esc=back  Ctrl+C=interrupt",
    ];
  }
  const lines: string[] = [
    TITLE,
    `Group: ${group.title}`,
    `[${group.language} · ${group.level}]${
      group.originalTitle ? " · original" : ""
    }`,
    "",
  ];
  if (group.attestations.length === 0) {
    lines.push("No attestations for this group.");
  } else {
    for (const attestation of group.attestations.slice(0, 6)) {
      const role = attestation.role === "edition_title"
        ? "edition title"
        : attestation.role === "edition_subtitle"
        ? "edition subtitle"
        : attestation.role === "work_original_title"
        ? "original title"
        : "display";
      lines.push(`- ${attestation.text}  [${attestation.source} · ${role}]`);
    }
    if (group.attestations.length > 6) {
      lines.push(`  … and ${group.attestations.length - 6} more`);
    }
  }
  lines.push("", "N=new search  Esc=back  Ctrl+C=interrupt");
  return lines;
}
