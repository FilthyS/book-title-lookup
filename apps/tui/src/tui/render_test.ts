// Deterministic rendering tests: exact content snapshots for the coordinator
// SessionState screens plus width invariants. Renders are built by driving the
// real reducer with scripted messages (no catalog, no terminal).

import { assertEquals } from "@std/assert";
import { update } from "../coordinator/reducer.ts";
import type { Message } from "../coordinator/messages.ts";
import { emptyQueryDraft, type SessionState } from "../coordinator/state.ts";
import type {
  CandidateRef,
  ResolvedWorkRef,
  SearchOutcome,
} from "../../../../packages/core/src/module.ts";
import { cursorColumn, initialUiSelection, renderFrame } from "./render.ts";
import type { UiSelection } from "./render.ts";
import type { TerminalSize } from "./terminal.ts";
import { measureWidth, padTo } from "./width.ts";

const SIZE_60x16: TerminalSize = { columns: 60, rows: 16 };

function querySeed(): SessionState {
  return {
    screen: "query",
    goal: { kind: "lookup" },
    draft: emptyQueryDraft(),
    targetLanguages: [],
    notice: null,
  };
}

function typeTitle(state: SessionState, text: string): SessionState {
  return drive(state, [{ type: "text", value: text }]);
}

function drive(
  state: SessionState,
  messages: readonly Message[],
): SessionState {
  let current = state;
  for (const message of messages) {
    current = update(current, message).next;
  }
  return current;
}

const candidateRef = "c-1" as unknown as CandidateRef;
const workRef = "w-1" as unknown as ResolvedWorkRef;

function foundOutcome(): SearchOutcome {
  return {
    status: "found",
    candidates: [
      {
        ref: candidateRef,
        title: "百年孤独",
        alternativeTitles: [],
        authors: ["Gabriel García Márquez"],
        publicationYear: 1967,
        contentLanguages: ["zh"],
        references: [{ namespace: "openlibrary:work", value: "OL1W" }],
      },
      {
        ref: "c-2" as unknown as CandidateRef,
        title: "One Hundred Years of Solitude",
        alternativeTitles: [],
        authors: ["Gabriel García Márquez"],
        contentLanguages: ["en"],
        references: [{ namespace: "openlibrary:work", value: "OL1W" }],
      },
    ],
    warnings: [],
  };
}

function candidatesState(): SessionState {
  const typed = typeTitle(querySeed(), "百年孤独");
  const searching = drive(typed, [{ type: "submitSearch" }]);
  return drive(searching, [
    { type: "requestStarted", slot: "search", requestId: "1" },
    { type: "searchOutcome", requestId: "1", outcome: foundOutcome() },
  ]);
}

function resolvedWorkTitleState(): SessionState {
  const state = drive(candidatesState(), [{ type: "moveSelection", step: 1 }]);
  const resolving = drive(state, [{ type: "confirmCandidate" }]);
  return drive(resolving, [
    { type: "requestStarted", slot: "resolve", requestId: "2" },
    {
      type: "resolveOutcome",
      requestId: "2",
      outcome: {
        status: "resolved",
        work: {
          ref: workRef,
          title: "One Hundred Years of Solitude",
          authors: ["Gabriel García Márquez"],
          firstPublicationYear: 1967,
          contentLanguages: ["en"],
          references: [{ namespace: "openlibrary:work", value: "OL1W" }],
        },
        confirmation: "candidate_confirmed",
        warnings: [],
      },
    },
  ]);
}

function titlesState(): SessionState {
  return drive(resolvedWorkTitleState(), [
    { type: "requestStarted", slot: "titles", requestId: "3" },
    {
      type: "titlesOutcome",
      requestId: "3",
      outcome: {
        status: "found",
        groups: [
          {
            language: "es",
            title: "Cien años de soledad",
            subtitle: null,
            level: "verified",
            recommended: true,
            satisfiesRequest: false,
            originalTitle: false,
            attestations: [{
              source: "openlibrary",
              role: "edition_title",
              text: "Cien años de soledad",
              subtitle: null,
              language: "es",
              sourceRecordUrl: "https://openlibrary.org/works/OL1W",
              references: [],
              stale: false,
              fetchedAt: "2026-09-05T00:00:00.000Z",
            }],
          },
        ],
        warnings: [],
      },
    },
  ]);
}

function groupDetailState(): SessionState {
  return drive(titlesState(), [{ type: "selectGroup", index: 0 }]);
}

Deno.test("query frame renders an exact snapshot with a caret", () => {
  const state = typeTitle(querySeed(), "百年孤独");
  const lines = renderFrame(state, SIZE_60x16);
  assertEquals(lines, [
    "Book Title Lookup",
    "Search: 百年孤独",
    `${" ".repeat(15)}▕`,
    "Enter=search  Esc=quit  Ctrl+C=interrupt",
  ]);
});

Deno.test("query caret aligns with the right edge of the preceding cell", () => {
  const state = typeTitle(querySeed(), "1984");
  const lines = renderFrame(state, SIZE_60x16);
  assertEquals(lines[1], "Search: 1984");
  assertEquals(lines[2], `${" ".repeat(11)}▕`);
});

Deno.test("query caret keeps adjacent insertion boundaries visible", () => {
  const typed = typeTitle(querySeed(), "1984");
  const home = drive(typed, [{ type: "home" }]);
  const right = drive(home, [{ type: "moveCursor", step: 1 }]);
  assertEquals(renderFrame(home, SIZE_60x16)[2], `${" ".repeat(8)}▏`);
  assertEquals(renderFrame(right, SIZE_60x16)[2], `${" ".repeat(8)}▕`);
});

Deno.test("cursor column accounts for double-width Chinese", () => {
  const typed = typeTitle(querySeed(), "小王子");
  const moved = drive(typed, [{ type: "home" }, {
    type: "moveCursor",
    step: 1,
  }]);
  // "Search: " is 8 columns; 小 contributes 2 => caret at column 10.
  assertEquals(cursorColumn(moved), 10);
});

Deno.test("invalid submit shows the input.invalid notice", () => {
  const state = drive(querySeed(), [
    { type: "submitSearch" },
  ]);
  const lines = renderFrame(state, SIZE_60x16);
  assertEquals(
    lines.includes(
      "Enter a non-empty title (year, when given, must be 1-9999).",
    ),
    true,
  );
});

Deno.test("searching frame shows progress and no caret", () => {
  const typed = typeTitle(querySeed(), "活着");
  const searching = drive(typed, [{ type: "submitSearch" }]);
  const lines = renderFrame(searching, SIZE_60x16);
  assertEquals(lines[1], "Searching for '活着'…");
  assertEquals(lines.includes("Enter=search"), false);
});

Deno.test("candidates frame renders an exact snapshot", () => {
  const lines = renderFrame(candidatesState(), SIZE_60x16);
  assertEquals(lines[0], "Book Title Lookup");
  assertEquals(lines[1], "Work candidates:");
  assertEquals(lines[2], "> 1. 百年孤独 — Gabriel García Márquez");
  assertEquals(lines[3], "    (zh)");
  assertEquals(
    lines[4],
    "  2. One Hundred Years of Solitude — Gabriel García Márquez",
  );
  assertEquals(
    lines.includes("Up/Down=select  Enter=confirm  Esc=back  Ctrl+C=interrupt"),
    true,
  );
});

Deno.test("resolved frame shows the work under goal lookup with a titles hint", () => {
  const loading = resolvedWorkTitleState();
  assertEquals(loading.screen, "titles_loading");
  const started = drive(loading, [
    { type: "requestStarted", slot: "titles", requestId: "3" },
  ]);
  const resolved = drive(started, [{ type: "back" }]);
  const lines = renderFrame(resolved, SIZE_60x16);
  assertEquals(lines[1], "Resolved: One Hundred Years of Solitude");
  assertEquals(
    lines.includes("Enter=titles  Esc=back  Ctrl+C=interrupt"),
    true,
  );
});

Deno.test("titles frame lists groups with the selection marker", () => {
  const state = titlesState();
  const selection: UiSelection = { groups: 0 };
  const lines = renderFrame(state, SIZE_60x16, selection);
  assertEquals(lines[1], "Title groups for 'One Hundred Years of Solitude':");
  assertEquals(lines[2].startsWith("> 1. Cien años de soledad"), true);
});

Deno.test("group_detail frame expands the selected group", () => {
  const lines = renderFrame(groupDetailState(), SIZE_60x16);
  assertEquals(lines[1], "Group: Cien años de soledad");
  assertEquals(lines.some((line) => line.includes("edition title")), true);
});

Deno.test("below-minimum size renders the resize message", () => {
  const state = typeTitle(querySeed(), "百年孤独");
  const lines = renderFrame(state, { columns: 40, rows: 10 });
  assertEquals(lines, [
    "Book Title Lookup",
    "Terminal too small: need at least 60x16.",
    "Current size: 40x10.",
    "Resize the window to continue.",
  ]);
});

Deno.test("below-minimum frame fits within a tiny terminal width", () => {
  const state = typeTitle(querySeed(), "百年孤独");
  const lines = renderFrame(state, { columns: 10, rows: 5 });
  assertEquals(lines, [
    "Book Title",
    "Terminal t",
    "Current si",
    "Resize the",
  ]);
});

Deno.test("every padded driver line has the exact terminal width", () => {
  const frames: readonly (readonly string[])[] = [
    renderFrame(typeTitle(querySeed(), "百年孤独"), SIZE_60x16),
    renderFrame(candidatesState(), SIZE_60x16),
    renderFrame(titlesState(), SIZE_60x16, initialUiSelection),
  ];
  for (const frame of frames) {
    for (const line of frame) {
      assertEquals(measureWidth(padTo(line, 60)), 60);
    }
  }
});
