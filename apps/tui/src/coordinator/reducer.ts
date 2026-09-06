/**
 * Pure session reducer (issue #13 section 8).
 *
 * `update(state, message) -> { next, effects }` is total and pure: it never
 * performs I/O, reads a clock, allocates a request id, or calls the catalog.
 * When it returns a request effect, the state is already the matching waiting
 * node with `requestId: null`; the id arrives later through
 * `requestStarted`.
 */

import type {
  BookQuery,
  ResolveOutcome,
  SearchOutcome,
  SourceFailure,
  SourceWarning,
  TitleLookupOutcome,
} from "../../../../packages/core/src/module.ts";
import type { Message } from "./messages.ts";
import type { Effect } from "./effects.ts";
import {
  type CandidatePool,
  type CandidateRow,
  emptyQueryDraft,
  type FieldName,
  type Notice,
  type QueryDraft,
  type QueryState,
  type ResolvedSnapshot,
  type ResolveOrigin,
  type SessionState,
  type TitlesPayload,
} from "./state.ts";

export interface UpdateResult {
  readonly next: SessionState;
  readonly effects: readonly Effect[];
}

function noChange(state: SessionState): UpdateResult {
  return { next: state, effects: [] };
}

function effectOnly(
  state: SessionState,
  effects: readonly Effect[],
): UpdateResult {
  return { next: state, effects };
}

function baseOf(state: SessionState) {
  return {
    goal: state.goal,
    draft: state.draft,
    targetLanguages: state.targetLanguages,
  };
}

function queryNode(state: SessionState, notice: Notice | null): QueryState {
  return { screen: "query", ...baseOf(state), notice };
}

// ---------------------------------------------------------------------------
// Query editing (grapheme-safe by code point)
// ---------------------------------------------------------------------------

function editFocused(
  draft: QueryDraft,
  transform: (
    value: string,
    cursor: number,
  ) => { readonly value: string; readonly cursor: number },
): QueryDraft {
  const focused: FieldName = draft.focused;
  const current = draft.fields[focused];
  const next = transform(current.text, current.cursor);
  return {
    ...draft,
    fields: {
      ...draft.fields,
      [focused]: { text: next.value, cursor: next.cursor },
    },
  };
}

function applyEditing(draft: QueryDraft, message: Message): QueryDraft {
  switch (message.type) {
    case "focusField":
      return { ...draft, focused: message.field };
    case "text": {
      return editFocused(draft, (value, cursor) => ({
        value: value.slice(0, cursor) + message.value + value.slice(cursor),
        cursor: cursor + message.value.length,
      }));
    }
    case "backspace":
      return editFocused(draft, (value, cursor) =>
        cursor <= 0
          ? { value, cursor }
          : {
              value: value.slice(0, cursor - 1) + value.slice(cursor),
              cursor: cursor - 1,
            },
      );
    case "delete":
      return editFocused(draft, (value, cursor) =>
        cursor >= value.length
          ? { value, cursor }
          : {
              value: value.slice(0, cursor) + value.slice(cursor + 1),
              cursor,
            },
      );
    case "moveCursor":
      return editFocused(draft, (value, cursor) => ({
        value,
        cursor: Math.max(0, Math.min(value.length, cursor + message.step)),
      }));
    case "home":
      return editFocused(draft, (value) => ({ value, cursor: 0 }));
    case "end":
      return editFocused(draft, (value) => ({ value, cursor: value.length }));
    case "clearField":
      return editFocused(draft, () => ({ value: "", cursor: 0 }));
    default:
      return draft;
  }
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

type QueryBuild =
  | { readonly ok: true; readonly query: BookQuery }
  | { readonly ok: false };

function buildQueryFromDraft(draft: QueryDraft): QueryBuild {
  const title = draft.fields.title.text.trim();
  if (title === "") return { ok: false };
  const author = draft.fields.author.text.trim();
  const isbn = draft.fields.isbn.text.trim();
  const yearText = draft.fields.year.text.trim();
  if (yearText !== "") {
    const year = Number(yearText);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      return { ok: false };
    }
    return {
      ok: true,
      query: {
        title,
        ...(author !== "" ? { author } : {}),
        ...(isbn !== "" ? { isbn } : {}),
        publicationYear: year,
      },
    };
  }
  return {
    ok: true,
    query: {
      title,
      ...(author !== "" ? { author } : {}),
      ...(isbn !== "" ? { isbn } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

function candidatesNode(
  state: SessionState,
  pool: CandidatePool,
  notice: Notice | null,
): SessionState {
  return {
    screen: "candidates",
    ...baseOf(state),
    pool,
    selected: 0,
    notice,
  };
}

function resolvedNode(
  state: SessionState,
  snapshot: ResolvedSnapshot,
  notice: Notice | null,
): SessionState {
  return { screen: "resolved", ...baseOf(state), snapshot, notice };
}

function backFrom(state: SessionState, notice: Notice | null): SessionState {
  switch (state.screen) {
    case "searching":
      return queryNode(state, notice);
    case "candidates":
      return queryNode(state, notice);
    case "resolving": {
      if (state.origin.station === "query") return queryNode(state, notice);
      return candidatesNode(state, state.origin.pool, notice);
    }
    case "titles_loading":
      return resolvedNode(state, state.snapshot, notice);
    case "resolved": {
      if (state.snapshot.origin.station === "query") {
        return queryNode(state, notice);
      }
      return candidatesNode(state, state.snapshot.origin.pool, notice);
    }
    case "titles":
      return resolvedNode(state, state.snapshot, notice);
    case "group_detail":
      return {
        screen: "titles",
        ...baseOf(state),
        snapshot: state.snapshot,
        payload: state.payload,
        notice: null,
      };
    case "query":
      return state;
  }
}

function noticeFor(
  messageKey: Notice["messageKey"],
  warnings?: readonly SourceWarning[],
  failures?: readonly SourceFailure[],
): Notice {
  return {
    messageKey,
    ...(warnings !== undefined && warnings.length > 0 ? { warnings } : {}),
    ...(failures !== undefined && failures.length > 0 ? { failures } : {}),
  };
}

function waitingNode(
  state: SessionState,
): "search" | "resolve" | "titles" | null {
  if (state.screen === "searching") return "search";
  if (state.screen === "resolving") return "resolve";
  if (state.screen === "titles_loading") return "titles";
  return null;
}

function requestIdOf(state: SessionState): string | null {
  switch (state.screen) {
    case "searching":
    case "resolving":
    case "titles_loading":
      return state.requestId;
    default:
      return null;
  }
}

function setRequestId(state: SessionState, id: string): SessionState {
  switch (state.screen) {
    case "searching":
      return { ...state, requestId: id };
    case "resolving":
      return { ...state, requestId: id };
    case "titles_loading":
      return { ...state, requestId: id };
    default:
      return state;
  }
}

function rowsFromSearch(outcome: SearchOutcome): readonly CandidateRow[] {
  return outcome.status === "found" ? outcome.candidates : [];
}

function rowsFromResolve(outcome: ResolveOutcome): readonly CandidateRow[] {
  return outcome.status === "needs_choice" ? outcome.candidates : [];
}

function buildTitlesPayload(
  state: SessionState,
  outcome: TitleLookupOutcome,
  snapshot: ResolvedSnapshot,
): TitlesPayload {
  const status =
    outcome.status === "found" || outcome.status === "no_attested_titles"
      ? outcome.status
      : "no_attested_titles";
  return {
    work: snapshot.work,
    targetLanguages: state.targetLanguages,
    status,
    groups:
      outcome.status === "found" || outcome.status === "no_attested_titles"
        ? outcome.groups
        : [],
    warnings:
      outcome.status === "found" || outcome.status === "no_attested_titles"
        ? outcome.warnings
        : [],
  };
}

function moveSelected(state: SessionState, step: number): SessionState {
  if (state.screen !== "candidates") return state;
  const count = state.pool.rows.length;
  if (count === 0) return state;
  const selected = Math.max(0, Math.min(count - 1, state.selected + step));
  return { ...state, selected };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function update(state: SessionState, message: Message): UpdateResult {
  switch (message.type) {
    // Editing: only at the Query station.
    case "focusField":
    case "text":
    case "backspace":
    case "delete":
    case "moveCursor":
    case "home":
    case "end":
    case "clearField": {
      if (state.screen !== "query") return noChange(state);
      const draft = applyEditing(state.draft, message as Message);
      return { next: { ...state, draft }, effects: [] };
    }

    case "newSearch": {
      if (
        state.screen !== "candidates" &&
        state.screen !== "resolved" &&
        state.screen !== "titles" &&
        state.screen !== "group_detail"
      ) {
        return noChange(state);
      }
      return {
        next: {
          screen: "query",
          goal: { kind: "lookup" },
          draft: emptyQueryDraft(),
          targetLanguages: [],
          notice: null,
        },
        effects: [],
      };
    }

    case "submitSearch": {
      if (state.screen !== "query") return noChange(state);
      const built = buildQueryFromDraft(state.draft);
      if (!built.ok) {
        return {
          next: queryNode(state, noticeFor("input.invalid")),
          effects: [],
        };
      }
      return {
        next: {
          screen: "searching",
          ...baseOf(state),
          query: built.query,
          requestId: null,
        },
        effects: [{ kind: "search", query: built.query }],
      };
    }

    case "requestStarted": {
      if (waitingNode(state) !== message.slot) return noChange(state);
      if (requestIdOf(state) !== null) return noChange(state);
      return { next: setRequestId(state, message.requestId), effects: [] };
    }

    case "searchOutcome": {
      if (
        state.screen !== "searching" ||
        state.requestId !== message.requestId
      ) {
        return noChange(state);
      }
      const outcome = message.outcome;
      switch (outcome.status) {
        case "found": {
          const rows = rowsFromSearch(outcome);
          if (rows.length === 0) {
            return {
              next: queryNode(
                state,
                noticeFor("lookup.notFound", outcome.warnings),
              ),
              effects: [],
            };
          }
          const pool: CandidatePool = {
            origin: "search",
            rows,
            warnings: outcome.warnings,
          };
          return { next: candidatesNode(state, pool, null), effects: [] };
        }
        case "not_found":
          return {
            next: queryNode(
              state,
              noticeFor("lookup.notFound", outcome.warnings),
            ),
            effects: [],
          };
        case "failed":
          return {
            next: queryNode(
              state,
              noticeFor("lookup.failed", undefined, outcome.failures),
            ),
            effects: [],
          };
        case "cancelled":
          return {
            next: queryNode(state, noticeFor("lookup.interrupted")),
            effects: [],
          };
      }
      return noChange(state);
    }

    case "cancelRequest": {
      const slot = waitingNode(state);
      const id = requestIdOf(state);
      if (slot !== null && id !== null) {
        return {
          next: backFrom(state, null),
          effects: [{ kind: "abort", requestId: id }],
        };
      }
      return noChange(state);
    }

    case "back": {
      const slot = waitingNode(state);
      const id = requestIdOf(state);
      if (slot !== null && id !== null) {
        return {
          next: backFrom(state, null),
          effects: [{ kind: "abort", requestId: id }],
        };
      }
      if (
        state.screen === "candidates" ||
        state.screen === "resolved" ||
        state.screen === "titles" ||
        state.screen === "group_detail"
      ) {
        return { next: backFrom(state, null), effects: [] };
      }
      return noChange(state);
    }

    case "moveSelection": {
      if (state.screen !== "candidates") return noChange(state);
      return { next: moveSelected(state, message.step), effects: [] };
    }

    case "confirmCandidate": {
      if (state.screen !== "candidates") return noChange(state);
      if (state.pool.rows.length === 0) return noChange(state);
      const row = state.pool.rows[state.selected];
      const origin: ResolveOrigin = {
        station: "candidates",
        pool: state.pool,
        selected: state.selected,
      };
      return {
        next: {
          screen: "resolving",
          ...baseOf(state),
          origin,
          target: { kind: "candidate", ref: row.ref },
          requestId: null,
        },
        effects: [
          {
            kind: "resolve",
            target: { kind: "candidate", ref: row.ref },
          },
        ],
      };
    }

    case "resolveReference": {
      if (state.screen !== "query") return noChange(state);
      return {
        next: {
          screen: "resolving",
          ...baseOf(state),
          origin: { station: "query" },
          target: { kind: "externalReference", reference: message.reference },
          requestId: null,
        },
        effects: [
          {
            kind: "resolve",
            target: { kind: "externalReference", reference: message.reference },
          },
        ],
      };
    }

    case "resolveOutcome": {
      if (
        state.screen !== "resolving" ||
        state.requestId !== message.requestId
      ) {
        return noChange(state);
      }
      const outcome = message.outcome;
      switch (outcome.status) {
        case "resolved": {
          const snapshot: ResolvedSnapshot = {
            work: outcome.work,
            origin: state.origin,
          };
          if (state.goal.kind === "resolve") {
            return { next: resolvedNode(state, snapshot, null), effects: [] };
          }
          return {
            next: {
              screen: "titles_loading",
              ...baseOf(state),
              snapshot,
              requestId: null,
            },
            effects: [
              {
                kind: "findTitles",
                workRef: outcome.work.ref,
                query: { targetLanguages: state.targetLanguages },
              },
            ],
          };
        }
        case "needs_choice": {
          const rows = rowsFromResolve(outcome);
          const pool: CandidatePool = {
            origin: "choice",
            reason: outcome.reason,
            rows,
            warnings: outcome.warnings,
          };
          return {
            next: candidatesNode(
              state,
              pool,
              noticeFor("results.partial", outcome.warnings),
            ),
            effects: [],
          };
        }
        case "not_found":
          return {
            next: backFrom(
              state,
              noticeFor("lookup.notFound", outcome.warnings),
            ),
            effects: [],
          };
        case "failed":
          return {
            next: backFrom(
              state,
              noticeFor("lookup.failed", undefined, outcome.failures),
            ),
            effects: [],
          };
        case "cancelled":
          return {
            next: backFrom(state, noticeFor("lookup.interrupted")),
            effects: [],
          };
      }
      return noChange(state);
    }

    case "viewTitles": {
      if (state.screen !== "resolved") return noChange(state);
      return {
        next: {
          screen: "titles_loading",
          ...baseOf(state),
          snapshot: state.snapshot,
          requestId: null,
        },
        effects: [
          {
            kind: "findTitles",
            workRef: state.snapshot.work.ref,
            query: { targetLanguages: state.targetLanguages },
          },
        ],
      };
    }

    case "titlesOutcome": {
      if (
        state.screen !== "titles_loading" ||
        state.requestId !== message.requestId
      ) {
        return noChange(state);
      }
      const outcome = message.outcome;
      switch (outcome.status) {
        case "found":
        case "no_attested_titles": {
          const payload = buildTitlesPayload(state, outcome, state.snapshot);
          const notice =
            outcome.status === "no_attested_titles"
              ? noticeFor("titles.none")
              : null;
          return {
            next: {
              screen: "titles",
              ...baseOf(state),
              snapshot: state.snapshot,
              payload,
              notice,
            },
            effects: [],
          };
        }
        case "failed":
          return {
            next: resolvedNode(
              state,
              state.snapshot,
              noticeFor("lookup.failed", undefined, outcome.failures),
            ),
            effects: [],
          };
        case "cancelled":
          return {
            next: resolvedNode(
              state,
              state.snapshot,
              noticeFor("lookup.interrupted"),
            ),
            effects: [],
          };
      }
      return noChange(state);
    }

    case "changeTargetLanguages": {
      if (state.screen !== "titles") return noChange(state);
      return {
        next: {
          screen: "titles_loading",
          ...baseOf(state),
          snapshot: state.snapshot,
          targetLanguages: message.tags,
          requestId: null,
        },
        effects: [
          {
            kind: "findTitles",
            workRef: state.snapshot.work.ref,
            query: { targetLanguages: message.tags },
          },
        ],
      };
    }

    case "selectGroup": {
      if (state.screen !== "titles") return noChange(state);
      if (message.index < 0 || message.index >= state.payload.groups.length) {
        return noChange(state);
      }
      return {
        next: {
          screen: "group_detail",
          ...baseOf(state),
          snapshot: state.snapshot,
          payload: state.payload,
          groupIndex: message.index,
        },
        effects: [],
      };
    }

    case "quit": {
      const id = requestIdOf(state);
      if (id !== null) {
        return effectOnly(state, [
          { kind: "abort", requestId: id },
          {
            kind: "exit",
            code: 0,
          },
        ]);
      }
      return effectOnly(state, [{ kind: "exit", code: 0 }]);
    }

    case "interrupt": {
      const id = requestIdOf(state);
      if (id !== null) {
        return effectOnly(state, [
          { kind: "abort", requestId: id },
          { kind: "exit", code: 130 },
        ]);
      }
      return effectOnly(state, [{ kind: "exit", code: 130 }]);
    }
  }
}

export { emptyQueryDraft };
