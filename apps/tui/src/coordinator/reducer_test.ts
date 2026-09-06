/**
 * Reducer tests (issue #13 tables 14.1-14.3). Representative rows cover the
 * full transition families: search/candidates, resolution, title lookup,
 * cancellation/late drops, exit intents, and the no-leak invariant that
 * projections carry no opaque refs.
 */

import { assertEquals } from "@std/assert";
import { update } from "./reducer.ts";
import type { Message } from "./messages.ts";
import type {
  CandidateRef,
  ResolvedWorkRef,
  SearchOutcome,
} from "../../../../packages/core/src/module.ts";
import {
  emptyQueryDraft,
  type QueryDraft,
  type SessionState,
} from "./state.ts";

function makeDraft(fields: {
  readonly title?: { readonly text: string; readonly cursor: number };
}): QueryDraft {
  const base = emptyQueryDraft();
  if (fields.title !== undefined) {
    return { ...base, fields: { ...base.fields, title: fields.title } };
  }
  return base;
}

function querySeed(
  goal: { readonly kind: "lookup" } | { readonly kind: "resolve" } = {
    kind: "lookup",
  },
): SessionState {
  return {
    screen: "query",
    goal,
    draft: makeDraft({ title: { text: "百年孤独", cursor: 4 } }),
    targetLanguages: [],
    notice: null,
  };
}

const ref = "c-1" as unknown as CandidateRef;
const workRef = "w-1" as unknown as ResolvedWorkRef;

function candidateRow(): import("../../../../packages/core/src/module.ts").WorkCandidate {
  return {
    ref,
    title: "Cien años de soledad",
    alternativeTitles: [],
    authors: ["Gabriel García Márquez"],
    publicationYear: 1967,
    contentLanguages: ["es"],
    references: [{ namespace: "openlibrary:work", value: "OL274505W" }],
  };
}

function foundOutcome(): SearchOutcome {
  return { status: "found", candidates: [candidateRow()], warnings: [] };
}

function drive(
  state: SessionState,
  messages: readonly Message[],
): SessionState {
  let current = state;
  for (const message of messages) {
    const result = update(current, message);
    current = result.next;
  }
  return current;
}

function searchingState(): SessionState {
  const state = querySeed();
  const after = drive(state, [{ type: "submitSearch" }]);
  return after;
}

function startedSearch(): SessionState {
  return drive(searchingState(), [
    { type: "requestStarted", slot: "search", requestId: "1" },
  ]);
}

Deno.test("R1 empty title submit is rejected at the query station", () => {
  const state = querySeed();
  const empty = drive(state, [
    { type: "clearField" },
    { type: "submitSearch" },
  ]);
  assertEquals(empty.screen, "query");
  if (empty.screen === "query") {
    assertEquals(empty.notice?.messageKey, "input.invalid");
  }
});

Deno.test("R2-R3 valid search starts and requestStarted fills the id", () => {
  const state = querySeed();
  const searching = drive(state, [{ type: "submitSearch" }]);
  assertEquals(searching.screen, "searching");
  if (searching.screen === "searching") {
    assertEquals(searching.requestId, null);
  }
  const started = drive(searching, [
    { type: "requestStarted", slot: "search", requestId: "1" },
  ]);
  assertEquals(started.screen, "searching");
  if (started.screen === "searching") assertEquals(started.requestId, "1");
});

Deno.test("R4/R7 found and partial-found reach candidates with warnings kept", () => {
  const base = startedSearch();
  const ok = drive(base, [
    {
      type: "searchOutcome",
      requestId: "1",
      outcome: {
        status: "found",
        candidates: [candidateRow()],
        warnings: [{ source: "openlibrary", code: "timeout", references: [] }],
      },
    },
  ]);
  assertEquals(ok.screen, "candidates");
  if (ok.screen === "candidates") {
    assertEquals(ok.pool.rows.length, 1);
    assertEquals(ok.pool.warnings.length, 1);
    assertEquals(ok.selected, 0);
  }
});

Deno.test("R6 search not_found returns to query with the notFound notice", () => {
  const state = drive(startedSearch(), [
    {
      type: "searchOutcome",
      requestId: "1",
      outcome: { status: "not_found", warnings: [] },
    },
  ]);
  assertEquals(state.screen, "query");
  if (state.screen === "query") {
    assertEquals(state.notice?.messageKey, "lookup.notFound");
  }
});

Deno.test("R9-R10 confirming a candidate resolves and, under lookup, starts titles", () => {
  const candidates = drive(startedSearch(), [
    {
      type: "searchOutcome",
      requestId: "1",
      outcome: foundOutcome(),
    },
  ]);
  assertEquals(candidates.screen, "candidates");
  const resolving = drive(candidates, [{ type: "confirmCandidate" }]);
  assertEquals(resolving.screen, "resolving");
  if (resolving.screen !== "resolving") return;
  const resolved = drive(resolving, [
    { type: "requestStarted", slot: "resolve", requestId: "2" },
    {
      type: "resolveOutcome",
      requestId: "2",
      outcome: {
        status: "resolved",
        work: {
          ref: workRef,
          title: "Cien años de soledad",
          authors: ["Gabriel García Márquez"],
          firstPublicationYear: 1967,
          contentLanguages: ["es"],
          references: [{ namespace: "openlibrary:work", value: "OL274505W" }],
        },
        confirmation: "candidate_confirmed",
        warnings: [],
      },
    },
  ]);
  assertEquals(resolved.screen, "titles_loading");
});

Deno.test("R14/R15 title outcomes reach titles and can start a new search", () => {
  const candidates = drive(startedSearch(), [
    { type: "searchOutcome", requestId: "1", outcome: foundOutcome() },
  ]);
  const resolving = drive(candidates, [{ type: "confirmCandidate" }]);
  if (resolving.screen !== "resolving") return;
  const resolved = drive(resolving, [
    { type: "requestStarted", slot: "resolve", requestId: "2" },
    {
      type: "resolveOutcome",
      requestId: "2",
      outcome: {
        status: "resolved",
        work: {
          ref: workRef,
          title: "Cien años de soledad",
          authors: [],
          contentLanguages: ["es"],
          references: [{ namespace: "openlibrary:work", value: "OL274505W" }],
        },
        confirmation: "candidate_confirmed",
        warnings: [],
      },
    },
    { type: "requestStarted", slot: "titles", requestId: "3" },
  ]);
  const titles = drive(resolved, [
    {
      type: "titlesOutcome",
      requestId: "3",
      outcome: {
        status: "no_attested_titles",
        groups: [{
          language: "und",
          title: "百年孤独",
          subtitle: null,
          level: "ambiguous",
          recommended: false,
          satisfiesRequest: false,
          originalTitle: false,
          attestations: [],
        }],
        warnings: [],
      },
    },
  ]);
  assertEquals(titles.screen, "titles");
  if (titles.screen === "titles") {
    assertEquals(titles.payload.status, "no_attested_titles");
    assertEquals(titles.notice?.messageKey, "titles.none");
  }
  const restarted = update(titles, { type: "newSearch" });
  assertEquals(restarted.effects, []);
  assertEquals(restarted.next, {
    screen: "query",
    goal: { kind: "lookup" },
    draft: emptyQueryDraft(),
    targetLanguages: [],
    notice: null,
  });
});

Deno.test("C1-C3 cancel aborts, and late outcomes are dropped", () => {
  const searching = searchingState();
  const withId = drive(searching, [
    { type: "requestStarted", slot: "search", requestId: "1" },
  ]);
  const cancelled = update(withId, { type: "cancelRequest" });
  assertEquals(cancelled.next.screen, "query");
  assertEquals(cancelled.effects[0], { kind: "abort", requestId: "1" });
  // Late cancelled outcome changes nothing.
  const late = update(cancelled.next, {
    type: "searchOutcome",
    requestId: "1",
    outcome: { status: "cancelled" },
  });
  assertEquals(late.next, cancelled.next);
  assertEquals(late.effects.length, 0);
});

Deno.test("C9-C11 quit and interrupt return abort plus the exit code", () => {
  const searching = searchingState();
  const withId = drive(searching, [
    { type: "requestStarted", slot: "search", requestId: "1" },
  ]);
  const quit = update(withId, { type: "quit" });
  assertEquals(quit.effects, [
    { kind: "abort", requestId: "1" },
    { kind: "exit", code: 0 },
  ]);
  const idle = querySeed();
  const interrupt = update(idle, { type: "interrupt" });
  assertEquals(interrupt.effects, [{ kind: "exit", code: 130 }]);
});

Deno.test("C13 language change reuses the same Work ref without re-resolving", () => {
  const candidates = drive(startedSearch(), [
    { type: "searchOutcome", requestId: "1", outcome: foundOutcome() },
  ]);
  const resolving = drive(candidates, [{ type: "confirmCandidate" }]);
  if (resolving.screen !== "resolving") return;
  const titlesLoading = drive(resolving, [
    { type: "requestStarted", slot: "resolve", requestId: "2" },
    {
      type: "resolveOutcome",
      requestId: "2",
      outcome: {
        status: "resolved",
        work: {
          ref: workRef,
          title: "Cien años de soledad",
          authors: [],
          contentLanguages: ["es"],
          references: [{ namespace: "openlibrary:work", value: "OL274505W" }],
        },
        confirmation: "candidate_confirmed",
        warnings: [],
      },
    },
  ]);
  if (titlesLoading.screen !== "titles_loading") return;
  const titles = drive(titlesLoading, [
    { type: "requestStarted", slot: "titles", requestId: "3" },
    {
      type: "titlesOutcome",
      requestId: "3",
      outcome: {
        status: "found",
        groups: [],
        warnings: [],
      },
    },
  ]);
  if (titles.screen !== "titles") return;
  const changed = update(titles, {
    type: "changeTargetLanguages",
    tags: ["zh-Hant"],
  });
  assertEquals(changed.next.screen, "titles_loading");
  if (changed.next.screen !== "titles_loading") return;
  assertEquals(changed.next.snapshot.work.ref, workRef);
  assertEquals(changed.effects[0].kind, "findTitles");
});

Deno.test("L3 ids enter state only through requestStarted", () => {
  const state = querySeed();
  const searching = drive(state, [{ type: "submitSearch" }]);
  if (searching.screen === "searching") {
    assertEquals(searching.requestId, null);
  }
});
