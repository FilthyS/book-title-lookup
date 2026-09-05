// Deterministic reducer tests for the pure update layer. These run with no
// terminal, network, or clock, satisfying the pure-state spike criterion.

import { assert, assertEquals } from "jsr:@std/assert@1.0.15";
import { DEMO_CANDIDATES } from "./demo.ts";
import { type AppState, initialState } from "./model.ts";
import { graphemeCount } from "./segments.ts";
import { update } from "./update.ts";

function typeText(state: AppState, value: string): AppState {
  return update(state, { type: "text", value });
}

function submit(state: AppState): AppState {
  return update(state, { type: "submit" });
}

function receive(
  state: AppState,
  overrides: Partial<
    { requestId: number; candidates: typeof DEMO_CANDIDATES; ok: boolean }
  > = {},
): AppState {
  const requestId = overrides.requestId ?? state.activeRequestId ?? 1;
  const ok = overrides.ok ?? true;
  const candidates = overrides.candidates ?? DEMO_CANDIDATES;
  return update(state, { type: "resultsReceived", requestId, candidates, ok });
}

Deno.test("text insert at empty cursor places graphemes", () => {
  const typed = typeText(initialState(), "百年孤独");
  assertEquals(typed.query.text, "百年孤独");
  assertEquals(typed.query.cursor, graphemeCount("百年孤独"));
});

Deno.test("text insert between graphemes keeps wide clusters intact", () => {
  let state = typeText(initialState(), "小王子");
  state = update(state, { type: "home" });
  state = update(state, { type: "move", step: 1 });
  state = typeText(state, "1984");
  assertEquals(state.query.text, "小1984王子");
  assertEquals(state.query.cursor, 5);
});

Deno.test("backspace deletes one grapheme cluster, not one code point", () => {
  let state = typeText(initialState(), "e\u0301x"); // e + combining acute is one grapheme
  state = update(state, { type: "backspace" });
  assertEquals(state.query.text, "e\u0301");
  assertEquals(state.query.cursor, 1);

  let family = typeText(initialState(), "👨‍👩‍👧‍👦x"); // ZWJ family is one grapheme
  assertEquals(graphemeCount("👨‍👩‍👧‍👦"), 1);
  family = update(family, { type: "backspace" });
  assertEquals(family.query.text, "👨‍👩‍👧‍👦");
  assertEquals(family.query.cursor, 1);
});

Deno.test("delete removes the grapheme after the cursor", () => {
  let state = typeText(initialState(), "小王子");
  state = update(state, { type: "home" });
  state = update(state, { type: "delete" });
  assertEquals(state.query.text, "王子");
  assertEquals(state.query.cursor, 0);
});

Deno.test("home/end and left/right move by grapheme and clamp", () => {
  let state = typeText(initialState(), "ab中文c");
  state = update(state, { type: "home" });
  assertEquals(state.query.cursor, 0);
  state = update(state, { type: "move", step: -1 });
  assertEquals(state.query.cursor, 0);
  state = update(state, { type: "move", step: 1 });
  state = update(state, { type: "move", step: 1 });
  assertEquals(state.query.cursor, 2);
  state = update(state, { type: "end" });
  assertEquals(state.query.cursor, graphemeCount("ab中文c"));
});

Deno.test("clear empties the query and resets the cursor", () => {
  const state = update(typeText(initialState(), "活着"), { type: "clear" });
  assertEquals(state.query, { text: "", cursor: 0 });
});

Deno.test("submit marks searching and remembers the active request", () => {
  const searching = submit(typeText(initialState(), "百年孤独"));
  assertEquals(searching.status, "searching");
  assertEquals(searching.activeRequestId, 1);
  assertEquals(searching.screen, "search");
});

Deno.test("submit is ignored while already searching or with an empty query", () => {
  assertEquals(submit(initialState()), initialState());
  const searching = submit(typeText(initialState(), "x"));
  assertEquals(submit(searching), searching);
});

Deno.test("resultsReceived moves to results for the active request", () => {
  const searching = submit(typeText(initialState(), "百年孤独"));
  const done = receive(searching);
  assertEquals(done.screen, "results");
  assertEquals(done.status, "idle");
  assertEquals(done.candidates.length, DEMO_CANDIDATES.length);
  assertEquals(done.selected, 0);
});

Deno.test("stale resultsReceived is ignored", () => {
  const searching = submit(typeText(initialState(), "百年孤独"));
  const stale = receive(searching, { requestId: 999 });
  assertEquals(stale, searching);

  const fresh = receive(searching, { requestId: searching.activeRequestId });
  assertEquals(fresh.screen, "results");
  const late = receive(fresh, { requestId: 1 });
  assertEquals(late, fresh);
});

Deno.test("failed or empty results return to search with a notice", () => {
  const failed = receive(submit(typeText(initialState(), "不存在")), {
    ok: false,
  });
  assertEquals(failed.screen, "search");
  assertEquals(failed.notice, "No candidates found.");
  const empty = receive(submit(typeText(initialState(), "不存在")), {
    candidates: [],
  });
  assertEquals(empty.screen, "search");
});

Deno.test("selection moves within bounds on the results screen", () => {
  const done = receive(submit(typeText(initialState(), "百年孤独")));
  const down = update(done, { type: "select", step: 1 });
  assertEquals(down.selected, 1);
  const over = update(down, { type: "select", step: 1 });
  assertEquals(over.selected, 2);
  const up = update(over, { type: "select", step: -1 });
  assertEquals(up.selected, 1);
});

Deno.test("backspace on results returns to an editable query", () => {
  let done = receive(submit(typeText(initialState(), "小王子")));
  done = update(done, { type: "select", step: 1 });
  const back = update(done, { type: "backspace" });
  assertEquals(back.screen, "search");
  assertEquals(back.query.text, "小王子");
  const edited = typeText(back, "的");
  assertEquals(edited.query.text, "小王子的");
});

Deno.test("cancel leaves state unchanged (pure acknowledgement)", () => {
  const state = typeText(initialState(), "活着");
  assertEquals(update(state, { type: "cancel" }), state);
});

Deno.test("editing messages are ignored on the results screen", () => {
  const done = receive(submit(typeText(initialState(), "百年孤独")));
  assertEquals(update(done, { type: "text", value: "x" }), done);
  assertEquals(update(done, { type: "delete" }), done);
  assertEquals(update(done, { type: "clear" }), done);
});

Deno.test("update never mutates the previous state", () => {
  const before = typeText(initialState(), "活着");
  const snapshot = structuredClone(before);
  const after = update(before, { type: "backspace" });
  assert(before !== after);
  assertEquals(before.query.text, snapshot.query.text);
});
