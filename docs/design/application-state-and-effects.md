# Application State and Effect Seam

Grilling ticket: [GitHub issue #13 — Define the application state and effect
seam](https://github.com/FilthyS/book-title-lookup/issues/13)
Type: grilling
Blocked by: #6 (catalog module interface), #7 (evidence reconciliation and
recommendation), #9 (TUI rendering strategy), #12 (CLI and JSON contract) —
all closed; their design documents are listed under References.

Deliverable: the deterministic, executable-level specification of the shared
application coordinator that the full-screen TUI and the ordinary one-shot
CLI both drive, so cancellation, late responses, partial results, and
terminal restoration behave identically and remain testable without a
physical terminal.

This document is a design specification, not production code. It freezes the
coordinator contracts that `apps/tui` implements under issue #14; no package
is scaffolded and no source file is changed by this ticket.

## 1. Decision

Freeze one headless **session coordinator** in `apps/tui` as the single owner
of lookup behavior above the catalog seam:

- a **pure reducer** `update(session, message) -> { session, effects }` that
  owns a discriminated `SessionState`, a `Message` vocabulary for user
  intents and effect results, and a pure `Effect` list; and
- an **effect runner** that owns request-id allocation, `AbortController`
  registration, catalog calls through the `BookTitleCatalog` seam from issue
  #6, and nothing else.

The full-screen TUI and the ordinary CLI are two **drivers** over the same
coordinator. The TUI driver owns terminal acquire/render/restore and keyboard
input; the CLI driver owns argument parsing, one-shot directed sessions, and
the stdout/stderr/exit projection frozen by issue #12. Neither driver
contains lookup policy; the reducer never performs terminal, clock, id,
catalog, or process-exit work.

The reducer is mode-agnostic. Differences between modes are expressed as a
**session goal** in state — `lookup` (interactive TUI and the CLI `titles`
command) or `resolve` (the CLI `resolve` command) — never as driver logic
inside `update`.

What is fixed here:

1. The discriminated session state and the message/effect vocabulary.
2. Request-id allocation and `AbortController` ownership in the effect
   runner, including the `requestStarted` handshake that keeps ids out of the
   reducer.
3. Cancellation and late-result rules: which message aborts which request and
   when a delivered outcome is applied or dropped.
4. Candidate and resolved-work reference lifetime inside the session, and the
   no-leak rule that keeps opaque refs out of every projection.
5. The navigation transition table for the interactive workflow from the
   product spec ("Enter title and optional filters", "Search while retaining
   cancellation control", "Review Work Candidates", "Confirm direct or
   indirect Work resolution", "Review Title Groups by language", "Expand a
   group", "Return to the query").
6. Partial, empty, and failure handling in the coordinator and its notice
   vocabulary.
7. CLI projection: how one-shot commands run directed sessions and map
   terminal states to the issue #12 documents and exit codes.
8. Terminal acquire/restore ownership for the TUI driver, with the reducer
   only ever requesting an exit effect.

The coordinator consumes the module outcome unions from issue #6 and the
deterministic payloads from issue #7/#12; it never reaches behind the catalog
seam. Candidate ordering, grouping, evidence levels, `recommended`/
`satisfiesRequest` flags, and deterministic language results arrive already
computed from the module; the coordinator preserves them in order and never
re-ranks or re-derives them.

## 2. Why a shared coordinator exists

Issue #6 fixed the seam between the presentation layer and the Core lookup
service: the application calls `BookTitleCatalog` with `search`, `resolve`,
and `findTitles`, and every expected condition arrives as a discriminated
status — never an exception. Issue #12 fixed the durable automation contract:
three one-shot CLI commands plus the TUI mode, JSON documents, and exit
codes. Issue #9 fixed rendering on a thin project-owned ANSI renderer driven
by the same pure `update` model.

The question this ticket answers is what sits above the catalog seam and
below both front ends so that:

- the full-screen TUI can walk the interactive workflow, and
- the CLI can run deterministic one-shot sessions for `search`, `resolve`,
  and `titles`,

while cancellation, late responses, partial results, empty/failure outcomes,
and terminal restoration are all deterministic to test. The answer is one
session coordinator whose reducer is pure and whose effect runner is the only
place that touches time, ids, signals, and the catalog.

The composition root in `apps/tui` constructs one `BookTitleCatalog` service
(providers wired into Core) per process. The coordinator runs against that
catalog seam. A process runs exactly one mode:

| Mode | Driver | Coordinator sessions | Module sessions |
| --- | --- | --- | --- |
| Full-screen TUI | TUI driver | one interactive session for the process lifetime | one per process (issue #6) |
| `search` / `resolve` / `titles` | CLI driver | one directed session per invocation | one per invocation (issue #12) |
| `cache` / `config` | CLI driver | none — maintenance commands bypass the coordinator | none (issue #10) |

`cache` and `config` do not perform book lookups, so they never enter the
session coordinator; their behavior is already frozen by issues #10 and #12.

## 3. Alignment with accepted contracts

Each decision below intentionally reuses the vocabulary of the accepted
documents:

| Concern | Source contract | Where this document applies it |
| --- | --- | --- |
| Module operations and outcome unions | issue #6 `BookTitleCatalog` | every request effect maps to one operation; outcomes are stored verbatim |
| `RequestOptions.signal` only | issue #6 | the runner passes exactly one `AbortSignal` per request |
| Cancellation resolves `cancelled`, never rejects | issue #6 | the runner dispatches the module's cancelled outcome; the reducer treats it as data |
| Candidate refs scoped to their response; resolved refs session-scoped | issue #6 | pool replacement and resolve rules (section 9) |
| Candidate order, groups, levels, language flags | issues #7, #12 | pools and group rows are stored in module order and never re-ranked |
| Exit codes and JSON documents | issue #12 | CLI projection table (section 12) |
| No opaque handles in automation or display | issues #6, #12 | no-leak invariant (section 9) |
| TUI mode entry, exit 0/130, signals, stderr warnings | issue #12 | terminal ownership (section 13) |
| Pure reducer, driver-owned terminal work | issue #9, architecture.md | enforced by sections 5–8 |
| `Ctrl+C` restores and exits; no-command non-TTY never starts the TUI | product spec, issue #12 | section 13 |

The illustrative `Screen` union and `AppState` sketch in `docs/architecture.md`
predate this ticket; where they overlap, this document's types are the frozen
version and the sketch is superseded.

## 4. Session and goal

A **session** is the unit of work the coordinator drives. The interactive TUI
keeps one session alive for the process; each CLI lookup command starts a
directed session that terminates when the command's terminal state is
reached.

```ts
/** Why this session runs. Drives whether a resolved Work auto-continues to
 *  the Title Group phase. Never changed after session start. */
type SessionGoal =
  | { readonly kind: "lookup" }   // interactive TUI and the CLI `titles` command
  | { readonly kind: "resolve" }; // the CLI `resolve` command only
```

- **`lookup`** — a search may continue through candidates and resolution to
  attested titles. A `resolved` outcome automatically starts a title lookup.
  Used by the TUI and by the CLI `titles` command (whose internal resolution
  must continue into `findTitles`, issue #12 section 8.3).
- **`resolve`** — resolution is terminal. A `resolved` outcome stops at the
  Resolved station. Used by the CLI `resolve` command, whose document must
  not contain Title Groups (issue #12 section 8.2).

The CLI `search` command also runs under the `lookup` goal, but it never
reaches resolution because candidates require a confirmation that a headless
session never issues; its terminal state is the candidate outcome.

## 5. Session state

The state is a discriminated union on `screen`. All members are readonly;
arrays are immutable. State carries only data that the coordinator needs:
opaque module refs that the projection must never leak, module-ordered result
payloads, the preserved query draft, structured notices, and request ids for
the currently in-flight request. No `AbortController`, clock, terminal, or
catalog object is ever stored in state.

### 5.1 Shared value types

```ts
/** Opaque tokens minted by the module (issue #6). Stored in state for
 *  requests only; never rendered, serialized, or compared semantically. */
declare const candidateRefBrand: unique symbol;
declare const resolvedWorkRefBrand: unique symbol;
type CandidateRef = string & { readonly [candidateRefBrand]: typeof candidateRefBrand };
type ResolvedWorkRef = string & { readonly [resolvedWorkRefBrand]: typeof resolvedWorkRefBrand };

/** Canonical BCP 47-style tag as normalized by issue #7. */
type LanguageTag = string;

/** Monotonic or random request correlation id, allocated by the effect
 *  runner. Never projected. */
type RequestId = string;

/** A slot that may carry an in-flight module request. */
type RequestSlot = "search" | "resolve" | "titles";

/** The set of message ids each notice maps to at presentation time.
 *  English-only MVP renders stable English text; a future locale catalog
 *  replaces the text, never the key or payload. */
type MessageKey =
  | "lookup.notFound"
  | "lookup.interrupted"
  | "lookup.failed"
  | "titles.none"
  | "results.partial"
  | "input.invalid";
```

### 5.2 Query editing

```ts
/** Editable text in one field. `cursor` is a grapheme-cluster index. */
interface EditableText {
  readonly text: string;
  readonly cursor: number;
}

type FieldName = "title" | "author" | "isbn" | "year";

/** The editable search form. The title is required at submit time; author,
 *  isbn, and year are optional and validated when the query is built. */
interface QueryDraft {
  readonly fields: Readonly<Record<FieldName, EditableText>>;
  readonly focused: FieldName;
}

// `buildQuery(draft)` returns the module's `BookQuery` (issue #6). The
// coordinator pre-checks the input rules issue #12 freezes for CLI values
// (title required and non-empty; year an integer from 1 to 9999) so an
// invalid draft becomes a notice, never a module invariant violation.
```

### 5.3 Result payloads

The coordinator stores module results in the presentation vocabulary of issue
#12 so that TUI and CLI project the identical facts. Each displayed row adds
its opaque `ref` field, which projections strip.

The outcome and payload types from the accepted contracts are used as-is:
`BookQuery`, `TitleQuery`, `RequestOptions`, `ExternalReference`, `SourceId`,
`SourceWarning`, `SourceFailure`, `ResolveTarget`, `ResolveChoiceReason`, and
the `SearchOutcome`/`ResolveOutcome`/`TitleLookupOutcome` unions come from
issue #6; `SourceWarning` codes and the Title Group semantics come from
issues #7/#12. The sections below add only application-layer vocabulary.

```ts
/** One Work Candidate row in a pool: the issue #12 Work Candidate shape
 *  plus the opaque CandidateRef used for confirmation. */
interface CandidateRow {
  readonly ref: CandidateRef;                    // never projected
  readonly title: string;
  readonly alternativeTitles: readonly string[];
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly editionCount?: number;
  readonly contentLanguages: readonly LanguageTag[];
  readonly references: readonly ExternalReference[];
}

interface CandidatePool {
  /** Where this pool came from. A `choice` pool carries a reason. */
  readonly origin: "search" | "choice";
  readonly reason?: ResolveChoiceReason;         // present when origin is choice
  readonly rows: readonly CandidateRow[];        // module order, never re-ranked
  readonly warnings: readonly SourceWarning[];
}

/** A Resolved Work as stored at the Resolved station: issue #12 Resolved
 *  Work shape plus the opaque ResolvedWorkRef used for findTitles. */
interface ResolvedWorkView {
  readonly ref: ResolvedWorkRef;                 // never projected
  readonly title: string;
  readonly authors: readonly string[];
  readonly firstPublicationYear?: number;
  readonly contentLanguages: readonly LanguageTag[];
  readonly references: readonly ExternalReference[];
}

/** A Title Group exactly as issue #12 serializes it. The coordinator keeps
 *  the full group list (recommended first per language, ambiguous groups
 *  included with their flags) so TUI and CLI agree without re-deriving. */
interface TitleGroupView {
  readonly language: LanguageTag | "und" | "mul";
  readonly title: string;
  readonly subtitle: string | null;
  readonly level: "verified" | "probable" | "ambiguous";
  readonly recommended: boolean;
  readonly satisfiesRequest: boolean;
  readonly originalTitle: boolean;
  readonly attestations: readonly AttestationView[];
}

interface AttestationView {
  readonly source: SourceId;
  readonly role: string;
  readonly text: string;
  readonly subtitle: string | null;
  readonly language: LanguageTag | "und" | "mul";
  readonly sourceRecordUrl: string;
  readonly references: readonly ExternalReference[];
  readonly statementId?: string;
  readonly rank?: string;
  readonly stale: boolean;
  readonly fetchedAt: string;
}

/** The complete Title Group outcome payload for the Titles and Group Detail
 *  stations. */
interface TitlesPayload {
  readonly work: ResolvedWorkView;
  readonly targetLanguages: readonly LanguageTag[];
  readonly status: "found" | "no_attested_titles";
  readonly groups: readonly TitleGroupView[];
  readonly warnings: readonly SourceWarning[];
}

/** A structured notice shown at a station. `warnings`/`failures` reuse the
 *  issue #6/#12 shapes verbatim; localization keys are stable. */
interface Notice {
  readonly messageKey: MessageKey;
  readonly warnings?: readonly SourceWarning[];
  readonly failures?: readonly SourceFailure[];
}
```

### 5.4 Station snapshots and back targets

Interactive navigation needs to return to the previous content without losing
state, so nodes that leave a station keep the immutable snapshot they came
from. Readonly frozen trees make this cheap and safe; the spec does not
require copying large subtrees, only that the restored station be identical
to the one that was left.

```ts
/** Where a resolution started and where the Resolved station returns to on
 *  `back`: the candidate pool that was being confirmed, or the Query station
 *  when resolution started from an explicit External Reference. */
type ResolveOrigin =
  | {
      readonly station: "candidates";
      readonly pool: CandidatePool;
      readonly selected: number;
    }
  | { readonly station: "query" };

/** A resolved Work together with its origin. Every title-phase node carries
 *  the same snapshot so `back` deterministically reconstructs the Resolved
 *  station and, from there, the origin station. */
interface ResolvedSnapshot {
  readonly work: ResolvedWorkView;
  readonly origin: ResolveOrigin;
}
```

### 5.5 The discriminated session state

```ts
type SessionState =
  | QueryState
  | SearchingState
  | CandidatesState
  | ResolvingState
  | ResolvedState
  | TitlesLoadingState
  | TitlesState
  | GroupDetailState;

/** Common fields on every node: the goal, the preserved query draft, and
 *  the target-language filter (empty means all discovered languages). */
interface SessionBase {
  readonly goal: SessionGoal;
  readonly draft: QueryDraft;
  readonly targetLanguages: readonly LanguageTag[];
}

/** Editing the query. The only station that accepts text-edit messages. */
interface QueryState extends SessionBase {
  readonly screen: "query";
  readonly notice: Notice | null;
}

/** Search request in flight. */
interface SearchingState extends SessionBase {
  readonly screen: "searching";
  readonly query: BookQuery;
  /** Null only between effect start and the requestStarted handshake. */
  readonly requestId: RequestId | null;
}

/** A candidate pool awaiting confirmation (search found, or resolve
 *  needs_choice). */
interface CandidatesState extends SessionBase {
  readonly screen: "candidates";
  readonly pool: CandidatePool;
  readonly selected: number;
  readonly notice: Notice | null;
}

/** Resolve request in flight. */
interface ResolvingState extends SessionBase {
  readonly screen: "resolving";
  readonly origin: ResolveOrigin;
  readonly target: ResolveTarget;
  readonly requestId: RequestId | null;
}

/** A Work was resolved. Terminal for goal `resolve`; also the fallback after
 *  a failed or cancelled title lookup under goal `lookup`. `back` returns to
 *  the `snapshot.origin` station. */
interface ResolvedState extends SessionBase {
  readonly screen: "resolved";
  readonly snapshot: ResolvedSnapshot;
  readonly notice: Notice | null;
}

/** findTitles request in flight (always under goal `lookup`). `back` or
 *  `cancelRequest` returns to the Resolved station of `snapshot`. */
interface TitlesLoadingState extends SessionBase {
  readonly screen: "titles_loading";
  readonly snapshot: ResolvedSnapshot;
  readonly requestId: RequestId | null;
}

/** Title Groups ready: `found` or the valid `no_attested_titles` outcome.
 *  Ambiguous and non-satisfying groups stay in `groups` with their flags
 *  (issue #12). `back` returns to the Resolved station of `snapshot`. */
interface TitlesState extends SessionBase {
  readonly screen: "titles";
  readonly snapshot: ResolvedSnapshot;
  readonly payload: TitlesPayload;
  readonly notice: Notice | null;
}

/** One Title Group expanded to show its editions, source records, warnings,
 *  and identifiers (product spec workflow step 6). `back` returns to the
 *  Titles station reconstructed from `snapshot` and `payload`. */
interface GroupDetailState extends SessionBase {
  readonly screen: "group_detail";
  readonly snapshot: ResolvedSnapshot;
  readonly payload: TitlesPayload;
  readonly groupIndex: number;
}
```

## 6. Messages

Messages are discriminated on `type`. Editing messages arrive from the input
adapter (the thin decoder of issue #9); workflow intents arrive from the user,
from the CLI driver script, or from the effect runner; result messages arrive
only from the effect runner.

```ts
type Message =
  // Editing the focused field. Honored only at the Query station.
  | { readonly type: "focusField"; readonly field: FieldName }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "backspace" }
  | { readonly type: "delete" }
  | { readonly type: "moveCursor"; readonly step: -1 | 1 }
  | { readonly type: "home" }
  | { readonly type: "end" }
  | { readonly type: "clearField" }

  // Workflow intents.
  | { readonly type: "submitSearch" }
  | { readonly type: "cancelRequest" }          // abort in-flight request, stay running
  | { readonly type: "moveSelection"; readonly step: -1 | 1 }
  | { readonly type: "confirmCandidate" }       // confirm the selected candidate
  | { readonly type: "resolveReference"; readonly reference: ExternalReference }
  | { readonly type: "viewTitles" }             // from Resolved station: load title groups
  | { readonly type: "changeTargetLanguages"; readonly tags: readonly LanguageTag[] }
  | { readonly type: "selectGroup"; readonly index: number }
  | { readonly type: "back" }
  | { readonly type: "quit" }                   // normal exit (0)
  | { readonly type: "interrupt" }              // OS SIGINT/SIGTERM (exit 130)

  // Effect bookkeeping and results. Only the effect runner emits these.
  | { readonly type: "requestStarted"; readonly slot: RequestSlot; readonly requestId: RequestId }
  | { readonly type: "searchOutcome"; readonly requestId: RequestId; readonly outcome: SearchOutcome }
  | { readonly type: "resolveOutcome"; readonly requestId: RequestId; readonly outcome: ResolveOutcome }
  | { readonly type: "titlesOutcome"; readonly requestId: RequestId; readonly outcome: TitleLookupOutcome };
```

Mapping notes:

- The issue #9 decoder token vocabulary (`text`, `backspace`, `delete`,
  `move`, `home`, `end`, `clear`, `submit`) maps to the editing and workflow
  messages above at the TUI input adapter. The adapter is a pure byte/token
  translator and owns no bibliographic decisions.
- The CLI driver never emits editing messages; it seeds a `QueryDraft` from
  parsed options and emits `submitSearch`, or emits `resolveReference`
  directly (section 12).
- `requestStarted` is the only path by which a request id enters state. The
  reducer never invents an id.

## 7. Effects (commands)

`update` returns zero or more pure effect descriptors. The effect runner
performs them. Effects never carry a request id: allocation is the runner's
job.

```ts
type Effect =
  // Request effects (slots search / resolve / titles).
  | { readonly kind: "search"; readonly query: BookQuery }
  | { readonly kind: "resolve"; readonly target: ResolveTarget }
  | { readonly kind: "findTitles"; readonly workRef: ResolvedWorkRef; readonly query: TitleQuery }

  // Abort an already-started request by its allocated id.
  | { readonly kind: "abort"; readonly requestId: RequestId }

  // Ask the driver to terminate the process after cleanup.
  | { readonly kind: "exit"; readonly code: 0 | 130 };
```

Rules:

- Rendering is not an effect. Both drivers re-project on every published
  state; the reducer has no render effect.
- A request effect is returned only when the coordinator is entering the
  matching waiting node (`searching`, `resolving`, `titles_loading`).
- When the coordinator leaves a waiting node because of `cancelRequest`,
  `back`, `quit`, or `interrupt`, it returns `abort` for the active
  request id if one exists.
- `exit` is returned for `quit` (code `0`) and `interrupt` (code `130`).
  The driver performs terminal restore and the actual process exit; the
  reducer only requests it.

## 8. Reducer contract and pseudocode

The reducer is a pure total function:

```text
fn update(state: SessionState, message: Message) -> { next: SessionState; effects: Effect[] }
```

The returned state and effects are new frozen values; nothing is mutated.
`update` performs no I/O, reads no clock, allocates no request id, and calls
no catalog operation. When `update` returns a request effect, the state is
already in the matching waiting node with `requestId: null`; the id arrives
later through `requestStarted`.

### 8.1 Reference pseudocode

The following branches are normative for the deterministic tables in section
14. Helper constructors `queryWith(notice)`, `candidates(...)`, and so on
build the corresponding immutable nodes; list rows keep module order.

```text
fn update(state, message):
  switch message.type:

    // ----- Editing: only at the Query station, only when idle -----
    case "text" | "backspace" | "delete" | "moveCursor" | "home" | "end"
         | "clearField" | "focusField":
        if state.screen != "query": return noChange(state)
        field = applyEditing(state.draft, message)          // grapheme-safe
        return { next: { ...state, draft: field }, effects: [] }

    // ----- Start a search -----
    case "submitSearch":
        if state.screen != "query": return noChange(state)
        query = buildQuery(state.draft)
        if query is invalid:                                // empty title, bad year
            return { next: queryWith(state, notice(input.invalid)), effects: [] }
        return { next: { screen: "searching", query, requestId: null, ...state },
                 effects: [{ kind: "search", query }] }

    // ----- Effect handshake -----
    case "requestStarted":
        // Applies only when the waiting node of that slot has no id yet.
        if not waitingFor(state, message.slot): return noChange(state)
        return { next: setRequestId(state, message.requestId), effects: [] }

    // ----- Search results -----
    case "searchOutcome":
        if state.screen != "searching" or state.requestId != message.requestId:
            return noChange(state)                          // stale or late
        switch message.outcome.status:
            case "found":
                rows = toCandidateRows(message.outcome.candidates)
                if rows.empty: return { next: queryWith(notice(lookup.notFound)),
                                        effects: [] }       // defensive invariant
                pool = { origin: "search", rows, warnings: message.outcome.warnings }
                return { next: candidates(pool, selected: 0), effects: [] }
            case "not_found":
                return { next: queryWith(notice(lookup.notFound,
                                          warnings: message.outcome.warnings)),
                         effects: [] }
            case "failed":
                return { next: queryWith(notice(lookup.failed,
                                          failures: message.outcome.failures)),
                         effects: [] }
            case "cancelled":
                // Module-cancelled (for example the module's overall
                // deadline); the user is still on the Searching node.
                return { next: queryWith(notice(lookup.interrupted)), effects: [] }

    // ----- Cancel an in-flight request (stay running) -----
    case "cancelRequest":
        if state.screen in {searching, resolving, titles_loading}
            and state.requestId != null:
            return { next: backFrom(state, keepNotice: false),
                     effects: [{ kind: "abort", requestId: state.requestId }] }
        return noChange(state)

    // ----- Back toward the query, one content station at a time -----
    case "back":
        if state.screen in {searching, titles_loading}
            and state.requestId != null:
            return { next: backFrom(state, keepNotice: false),
                     effects: [{ kind: "abort", requestId: state.requestId }] }
        if state.screen in {resolving} and state.requestId != null:
            return { next: backFrom(state, keepNotice: false),
                     effects: [{ kind: "abort", requestId: state.requestId }] }
        if state.screen in {candidates, resolved, titles, group_detail}:
            return { next: backFrom(state), effects: [] }
        return noChange(state)

    // ----- Candidate review and confirmation -----
    case "moveSelection":
        if state.screen != "candidates": return noChange(state)
        return { next: moveSelected(state, message.step), effects: [] }
    case "confirmCandidate":
        if state.screen != "candidates": return noChange(state)
        if pool.rows.empty: return noChange(state)          // invariant guard
        row = pool.rows[state.selected]
        target = { kind: "candidate", ref: row.ref }
        origin = { station: "candidates", pool: state.pool, selected: state.selected }
        return { next: { screen: "resolving", origin, target,
                         requestId: null, ...state },
                 effects: [{ kind: "resolve", target }] }

    // ----- Direct external-reference resolution (CLI resolve/titles,
    //      advanced TUI action) -----
    case "resolveReference":
        if state.screen != "query": return noChange(state)
        target = { kind: "externalReference", reference: message.reference }
        return { next: { screen: "resolving",
                         origin: { station: "query" }, target,
                         requestId: null, ...state },
                 effects: [{ kind: "resolve", target }] }

    // ----- Resolution results -----
    case "resolveOutcome":
        if state.screen != "resolving" or state.requestId != message.requestId:
            return noChange(state)
        switch message.outcome.status:
            case "resolved":
                work = toResolvedWorkView(message.outcome.work,
                                          message.outcome.confirmation)
                snapshot = { work, origin: state.origin }
                if state.goal.kind == "resolve":
                    return { next: resolved(snapshot), effects: [] }
                // goal lookup: continue automatically to Title Groups.
                return { next: { screen: "titles_loading", snapshot,
                                 requestId: null, ...state },
                         effects: [{ kind: "findTitles",
                                     workRef: work.ref,
                                     query: { targetLanguages: state.targetLanguages } }] }
            case "needs_choice":
                rows = toCandidateRows(message.outcome.candidates)
                pool = { origin: "choice", reason: message.outcome.reason,
                         rows, warnings: message.outcome.warnings }
                return { next: candidates(pool, selected: 0),
                         notice: warningNotice(message.outcome.warnings),
                         effects: [] }
            case "not_found":
                return { next: backFrom(state, notice: notice(lookup.notFound,
                                          warnings: message.outcome.warnings)),
                         effects: [] }
            case "failed":
                return { next: backFrom(state, notice: notice(lookup.failed,
                                          failures: message.outcome.failures)),
                         effects: [] }
            case "cancelled":
                return { next: backFrom(state, notice: notice(lookup.interrupted)),
                         effects: [] }

    // ----- Load title groups from the Resolved station -----
    case "viewTitles":
        if state.screen != "resolved": return noChange(state)
        return { next: { screen: "titles_loading", snapshot: state.snapshot,
                         requestId: null, ...state },
                 effects: [{ kind: "findTitles",
                             workRef: state.snapshot.work.ref,
                             query: { targetLanguages: state.targetLanguages } }] }

    // ----- Title Group results -----
    case "titlesOutcome":
        if state.screen != "titles_loading" or state.requestId != message.requestId:
            return noChange(state)
        switch message.outcome.status:
            case "found" | "no_attested_titles":
                payload = { work: state.snapshot.work,
                            targetLanguages: state.targetLanguages,
                            status: message.outcome.status,
                            groups: toTitleGroupViews(message.outcome),
                            warnings: message.outcome.warnings }
                notice = message.outcome.status == "no_attested_titles"
                             ? notice(titles.none)
                             : null
                return { next: { screen: "titles", snapshot: state.snapshot,
                                 payload, notice, ...state },
                         effects: [] }
            case "failed":
                return { next: resolved(state.snapshot,
                                        notice: notice(lookup.failed,
                                          failures: message.outcome.failures)),
                         effects: [] }
            case "cancelled":
                return { next: resolved(state.snapshot,
                                        notice: notice(lookup.interrupted)),
                         effects: [] }

    // ----- Language filter change: re-run findTitles on the same Work -----
    case "changeTargetLanguages":
        if state.screen != "titles": return noChange(state)
        return { next: { screen: "titles_loading", snapshot: state.snapshot,
                         requestId: null, ...state,
                         targetLanguages: message.tags },
                 effects: [{ kind: "findTitles",
                             workRef: state.snapshot.work.ref,
                             query: { targetLanguages: message.tags } }] }

    // ----- Group expansion -----
    case "selectGroup":
        if state.screen != "titles": return noChange(state)
        if outOfRange(state.payload.groups, message.index): return noChange(state)
        return { next: { screen: "group_detail",
                         snapshot: state.snapshot,
                         payload: state.payload,
                         groupIndex: message.index, ...state },
                 effects: [] }

    // ----- Exit intents -----
    case "quit":
        if state has an in-flight requestId:
            return { next: state, effects: [{ kind: "abort", requestId },
                                            { kind: "exit", code: 0 }] }
        return { next: state, effects: [{ kind: "exit", code: 0 }] }
    case "interrupt":
        if state has an in-flight requestId:
            return { next: state, effects: [{ kind: "abort", requestId },
                                            { kind: "exit", code: 130 }] }
        return { next: state, effects: [{ kind: "exit", code: 130 }] }
```

`backFrom` restores the snapshot embedded by the leaving node:

- from `searching` → Query station with the preserved draft and no notice;
- from `resolving` with a `candidates` origin → that pool at its selected
  index, with an optional notice;
- from `resolving` with a `query` origin → Query station with an optional
  notice;
- from `titles_loading` → the Resolved station of `snapshot` (with an
  optional notice);
- from `resolved` → the `snapshot.origin` station (Candidates pool or
  Query);
- from `candidates` → Query station;
- from `titles` → the Resolved station of `snapshot`;
- from `group_detail` → the Titles station reconstructed from `snapshot`
  and `payload`.

`resolved(snapshot, notice)` builds the Resolved node; `backFrom` never
fabricates a candidate or Work — it restores only snapshots that existed
earlier in the session.

## 9. Request ids, AbortController ownership, and reference lifetime

### 9.1 Request correlation ids

Every module request that the coordinator starts receives one request id.
Ids are correlation tokens only:

- they are generated by the effect runner's injected `RequestIdSource`;
- they never appear in state except through `requestStarted`;
- they are never rendered, serialized, or compared with ids outside the
  process;
- they are distinct from the **canonical request identity** used for the
  cache key (issue #10), which the providers compute from the normalized
  request URL below the seam.

The handshake makes the ordering explicit and deterministic to test:
`update` returns `{ kind: "search" }` (no id); the runner allocates
`requestId`, registers an `AbortController`, dispatches
`requestStarted`, and only then invokes the catalog with
`{ signal: controller.signal }`. Any result message that carries an id the
state is not waiting for is dropped.

### 9.2 Effect-runner interface

```ts
interface RequestIdSource {
  readonly next: () => RequestId;
}

interface RequestRecord {
  readonly slot: RequestSlot;
  readonly controller: AbortController;
}

/** The effect runner. Owns ids, controllers, and catalog calls; owns no
 *  state-machine decisions. */
interface EffectRunner {
  readonly catalog: BookTitleCatalog;
  readonly ids: RequestIdSource;
  readonly requests: ReadonlyMap<RequestId, RequestRecord>;

  /** Perform one request effect: allocate an id, register the controller,
   *  dispatch requestStarted, call the matching module operation, and
   *  dispatch the typed outcome message. */
  start(effect: RequestEffect, dispatch: (message: Message) => void): void;

  /** Abort one registered request. Idempotent; a request id that has
   *  already completed is a no-op. */
  abort(requestId: RequestId): void;

  /** Abort every registered request (used on OS interrupt and exit). */
  abortAll(): void;
}
```

Ownership rules:

1. The runner creates exactly one `AbortController` per in-flight request and
   keeps it in `requests` from `start` until the module promise settles.
2. The only module option is `{ signal }` (issue #6 `RequestOptions`). When
   the signal aborts, the module resolves `{ status: "cancelled" }`; it
   never rejects for cancellation.
3. `abort` calls `controller.abort()` and then stops tracking the id only
   when the outcome is dispatched. A second abort for the same id is a
   no-op.
4. Outcome dispatch is ordered after `requestStarted` for the same request
   because module promises settle in later microtasks; a reducer that has
   already left the waiting node drops the outcome regardless of ordering.
5. The runner never starts a request whose effect the reducer no longer
   wants: aborts are dispatched before a replacement request effect when the
   same slot is reused (the serial workflow normally makes reuse happen only
   after the previous request completed or was aborted).

The runner performs no clock work in the MVP: per-source deadlines, retries,
and the module-level lookup deadline live below the catalog seam (issues #6
and #8), and the module reports them as `cancelled` outcomes that the reducer
already handles. A future app-level deadline would be another timer owned by
the runner, never by the reducer.

### 9.3 Late-response rule

A result message is **late** when the state is not the matching waiting node
or when `state.requestId != message.requestId`. Late messages change nothing
and emit no effects. This covers:

- a search outcome arriving after the user cancelled and started a new
  search (new request id);
- an outcome arriving after `back` returned to a content station;
- a cancelled outcome arriving after the user already cancelled (the state
  left the waiting node immediately);
- any outcome for a request aborted by `quit`/`interrupt`.

### 9.4 Candidate and resolved-work reference lifetime

- `CandidateRef` values originate only inside module `SearchOutcome`/
  `ResolveOutcome` payloads. The coordinator stores them on `CandidateRow`
  rows and never constructs or compares one itself.
- A candidate pool is valid while it is the pool of the current
  `CandidatesState` (or the snapshot a `ResolvingState`/`ResolvedSnapshot`
  still holds). The moment the coordinator leaves a waiting search for a new
  search, or replaces the pool with a `needs_choice` pool, the old pool —
  and its candidate refs — is dropped from state. This matches issue #6:
  candidate refs are scoped to the response that produced them, and a new
  search invalidates the previous search's candidates.
- `resolve` effects are issued only with a `CandidateRef` drawn from the
  current pool row (or an explicit `ExternalReference`). The coordinator can
  therefore never hand the module a stale or fabricated candidate ref, which
  issue #6 treats as an invariant violation.
- A `needs_choice` pool is the module's offered confirmation set. The
  coordinator never synthesizes candidates; if the module intends "confirm
  the original anyway" to be possible after indirect evidence, that original
  candidate must appear in the module's `needs_choice` candidates (issue #7
  section 7.3), and the coordinator simply lets the user select it.
- A `ResolvedWorkRef` comes from the module's resolved outcome and is stored
  on `ResolvedWorkView`. `findTitles` effects always use the ref of the
  currently displayed Work; changing `targetLanguages` reuses that ref
  without re-resolving (issue #6). When the user starts a new search and a
  different Work is resolved, the previous ref is replaced. A ref that is no
  longer displayed is never passed to the module again.
- **No-leak rule:** no opaque ref appears in any projection — not in the TUI
  render view model, not in human text, and not in a JSON document (issue
  #12 contract row R10). Projections receive the display shapes defined in
  section 5.3, which omit `ref` fields; contract tests assert the absence of
  opaque tokens.

## 10. Partial, empty, and failure handling

The coordinator preserves the module's discriminated semantics exactly and
never collapses one status into another:

| Module outcome | Coordinator effect | Handling |
| --- | --- | --- |
| `search` `found` with warnings | Candidates station | Valid result; pool rows plus `SourceWarning`s; never downgraded to failed. |
| `search` `not_found` | Query station + notice | Valid completion; sources answered "no matching Work". |
| `search` `failed` | Query station + notice | Non-empty `failures`; retry possible by editing and resubmitting. |
| `search`/`resolve`/`findTitles` `cancelled` | Return to prior content + notice | Not an error; no warnings/failures fabricated. |
| `resolve` `resolved` | Resolved/titles phase | Confirmation stored (`strong_reference` or `candidate_confirmed`). |
| `resolve` `needs_choice` | Candidates station (choice) | New pool replaces the old; reason and warnings displayed. |
| `resolve` `not_found`/`failed` | Back to origin + notice | Origin pool remains valid; the user may confirm again or go back. |
| `findTitles` `found` | Titles station | Default-visible groups plus warnings. |
| `findTitles` `no_attested_titles` | Titles station | Valid completion; ambiguous/non-satisfying groups stay listed with flags; never triggers a translation. |
| `findTitles` `failed` | Resolved station + notice | Work is still resolved; retry via `viewTitles`. |

Rules:

1. Partial results keep their warnings attached to the pool or title payload
   and are never collapsed into `failed`; the renderer may surface a
   `results.partial` notice, but the coordinator never discards degraded
   data.
2. Empty results are distinct from failures: `not_found` and
   `no_attested_titles` are valid completions with their own notices and (for
   the CLI) their own exit codes.
3. A `failed` notice always carries the module's non-empty `failures`.
4. `cancelled` never invents warnings or failures and never mutates the
   reference scope with a partial result.
5. No retry is automatic: a headless CLI stops at its terminal state, and the
   TUI only retries when the user acts (`submitSearch`, `viewTitles`,
   `changeTargetLanguages`).
6. The coordinator keeps no query history (product spec); returning to the
   Query station restores the draft the user typed, not previous searches.

## 11. Navigation transition table

`Esc`/Backspace-style intent mapping is a presentation decision of the TUI
driver (issue #9); the reducer only recognizes the intents below. The table
is deterministic and is the acceptance matrix for reducer navigation tests.

| # | From station | Message | Result | Effects |
| --- | --- | --- | --- | --- |
| N1 | query (idle) | `submitSearch` (valid) | searching | `search` |
| N2 | query | `submitSearch` (empty title / invalid year) | query + `input.invalid` notice | none |
| N3 | searching | `searchOutcome` `found` | candidates (origin search, selected 0) | none |
| N4 | searching | `searchOutcome` `not_found` | query + `lookup.notFound` | none |
| N5 | searching | `searchOutcome` `failed` | query + `lookup.failed` | none |
| N6 | searching | `cancelRequest` | query | `abort` |
| N7 | searching | `back` | query | `abort` |
| N8 | candidates | `moveSelection` ±1 | candidates (clamped selection) | none |
| N9 | candidates | `confirmCandidate` | resolving (origin candidates) | `resolve` (candidate ref) |
| N10 | candidates | `back` | query | none |
| N11 | resolving | `resolveOutcome` `resolved`, goal `lookup` | titles_loading | `findTitles` |
| N12 | resolving | `resolveOutcome` `resolved`, goal `resolve` | resolved | none |
| N13 | resolving | `resolveOutcome` `needs_choice` | candidates (origin choice, new pool) | none |
| N14 | resolving | `resolveOutcome` `not_found` / `failed` / `cancelled` | origin station + notice | none |
| N15 | resolving | `cancelRequest` | origin station (Candidates pool or Query) | `abort` |
| N16 | resolved | `viewTitles` | titles_loading | `findTitles` |
| N17 | resolved | `back` | `snapshot.origin` (Candidates pool or Query) | none |
| N18 | titles_loading | `titlesOutcome` `found` / `no_attested_titles` | titles | none |
| N19 | titles_loading | `titlesOutcome` `failed` / `cancelled` | resolved + notice | none |
| N20 | titles_loading | `cancelRequest` | resolved | `abort` |
| N21 | titles | `selectGroup` | group_detail | none |
| N22 | titles | `changeTargetLanguages` | titles_loading (same Work ref) | `findTitles` |
| N23 | titles | `back` | resolved | none |
| N24 | group_detail | `back` | titles | none |
| N25 | any | `quit` | same state | `abort` (if in flight), `exit` 0 |
| N26 | any | `interrupt` | same state | `abort` (if in flight), `exit` 130 |

The workflow satisfies product spec steps: N1–N3 search and review, N9/N11
confirm resolution, N18/N21 review groups and expand, and the `back` rows
N10/N15/N17/N23/N24 return toward the query while the preserved draft always
remains editable at the Query station.

## 12. CLI projection

The CLI driver runs one **directed session** per lookup command. A directed
session is a headless coordinator session seeded from parsed options and
driven by a small scripted sequence; it stops at the first terminal state for
the command. Terminal states are determined purely from `SessionState`, so
the reducer tests and CLI integration tests assert the same transitions.

| Command | Seed | Scripted messages | Terminal states |
| --- | --- | --- | --- |
| `search` | Query station with `draft` built from `--title`/`--author`/`--isbn`/`--year` | `submitSearch` | candidates (found); query + `lookup.notFound`; query + `lookup.failed`; query + `lookup.interrupted` |
| `resolve` | Query station, goal `resolve` | `resolveReference` (`--isbn` or `--reference`) | resolved; candidates (needs_choice); query + `lookup.notFound`; query + `lookup.failed`; query + `lookup.interrupted` |
| `titles` | Query station, goal `lookup`, `targetLanguages` from `--language` | `resolveReference` (resolution auto-continues to title lookup under goal `lookup`) | titles (`found`/`no_attested_titles`); resolved + `lookup.failed`; resolved + `lookup.interrupted`; candidates (needs_choice); query + `lookup.notFound`; query + `lookup.failed`; query + `lookup.interrupted` |

The CLI never emits editing, selection, `confirmCandidate`, `viewTitles`,
`back`, or `quit` messages. Under goal `lookup` the reducer itself
auto-continues from a `resolved` outcome into `findTitles`, so the `titles`
command needs only the initial `resolveReference`. The CLI cannot choose a
candidate, so `needs_choice` is terminal with exit `3` (issue #12). `titles`
re-resolves its `--reference` inside the same process and session, exactly as
issue #12 section 5.3/8.3 requires.

A title-phase `failed`/`cancelled` outcome lands on the Resolved station with
a notice (section 10), so those terminal rows are `resolved` plus notice;
a resolve-phase `failed`/`cancelled` lands back on the Query station.

Projection maps a terminal state to the issue #12 JSON document (or human
text) and exit code. `stdout` receives exactly one document; `stderr`
receives diagnostics and the human rendering of warnings. OS signals are
handled by the driver, which writes the `cancelled` document only when the
process can reach a final write (issue #12 section 6.4).

| Terminal state | Command | JSON `status` | Human shape | Exit |
| --- | --- | --- | --- | ---: |
| candidates, origin search | search | `found` | numbered candidates | `3` |
| query + `lookup.notFound` | search | `not_found` | no-match message | `4` |
| query + `lookup.failed` | search | `failed` | failure message | `10` |
| query + `lookup.interrupted` | search | `cancelled` | interruption message | `130` |
| resolved (goal resolve) | resolve | `resolved` (`confirmation` `strong_reference`) | resolved-work text | `0` |
| candidates, origin choice | resolve | `needs_choice` (`reason` + warnings) | reason line + candidates | `3` |
| query + `lookup.notFound` | resolve | `not_found` | no-match message | `4` |
| query + `lookup.failed` | resolve | `failed` | failure message | `10` |
| query + `lookup.interrupted` | resolve | `cancelled` | interruption message | `130` |
| titles, `found` | titles | `found` | groups by language, recommended first | `0` |
| titles, `no_attested_titles` | titles | `no_attested_titles` | work line + no-attested message + ambiguous evidence | `5` |
| resolved + `lookup.failed` | titles | `failed` | failure message | `10` |
| resolved + `lookup.interrupted` | titles | `cancelled` | interruption message | `130` |
| candidates, origin choice | titles | `needs_choice` (resolution precondition) | reason line + candidates | `3` |
| query + `lookup.notFound` | titles | `not_found` (resolution precondition) | no-match message | `4` |
| query + `lookup.failed` | titles | `failed` | failure message | `10` |
| query + `lookup.interrupted` | titles | `cancelled` | interruption message | `130` |

Because a headless `resolve`/`titles` confirms only by strong or explicit
reference, its `resolved` documents always carry `confirmation:
strong_reference` (issue #12 section 8.2); `candidate_confirmed` appears only
in the interactive TUI path and never in CLI JSON.

`cache` and `config` commands never construct a session (section 2); their
documents and exit codes are unchanged from issues #10/#12.

## 13. Terminal acquire/restore ownership

The TUI driver is the only component that acquires a terminal. The reducer
never touches `Deno.stdin`/`Deno.stdout`, never switches alternate screens,
and never reads terminal size.

### 13.1 Mode selection

Mode selection happens once in the launcher before any session starts (issue
#12 section 3.1):

- `book-title` with no command, both stdin and stdout TTY, and no `--json` →
  **TUI mode**. The TUI driver then acquires the terminal.
- Any other no-command invocation (non-TTY, or `--json` present) → CLI usage
  error on stderr, exit `2`, no stdout; the terminal is never acquired.
- An explicit command → CLI mode; the terminal is never acquired (issue #9
  never starts the full-screen TUI for non-interactive I/O).

The throwaway issue #9 spike binaries exited `0` after their guard message
when run non-interactively. That spike behavior is not the production process
contract: issue #12, which postdates the spike, freezes the no-command
non-TTY case as exit `2`, and the coordinator document follows issue #12.

### 13.2 Acquire sequence (TUI only)

The TUI driver acquires, in order and inside one guarded scope:

1. raw input mode and disabled echo;
2. the alternate screen buffer;
3. hidden cursor.

Input decoding then flows through the issue #9 byte decoder into intent
messages; state publication drives the issue #9 thin renderer. A terminal
smaller than the product minimum `60×16` shows the resize message and never
enters the workflow layout (product spec; issue #9 manual gate).

### 13.3 Restore ownership

The same guarded scope restores the terminal in a `finally`-style guarantee
on every exit path:

1. cursor visible;
2. echo restored and raw mode off;
3. alternate screen left;
4. restore is idempotent, so an exception or signal during restore cannot
   double-run it.

Exit paths and their codes:

| Path | Who triggers | Exit code |
| --- | --- | --- |
| Normal quit (`quit` message) | user action | `0` |
| OS `SIGINT`/`SIGTERM` (`interrupt`) | signal handler → `interrupt` message | `130` |
| Uncaught exception | driver error handler | nonzero with terminal already restored |

A `SIGINT` while a request is in flight aborts it (effect runner `abort`),
restores the terminal, and exits `130`; the module's late `cancelled` outcome
never reaches a reducer that has exited. This matches product spec ("Ctrl+C
cancels work, restores the terminal, and exits conventionally") and issue
#12 section 6.4.

The manual Windows Terminal release gate from issue #9 remains authoritative
for real IME, resize, and restoration behavior: automated reducer/driver
tests prove the state transitions and the restore call sequence, and a human
confirms live terminal restoration.

## 14. Deterministic test tables

All reducer/effect tests run with an injected `RequestIdSource` returning a
fixed sequence (`"1"`, `"2"`, ...) and a scripted in-memory catalog (issue #6
module-level fake) whose outcomes the test delivers as messages. No test
needs a network client or a physical terminal. `stateAfter` abbreviates the
final state after processing every message in the scenario.

### 14.1 Navigation and outcomes

| # | Scenario | Scripted messages | Expected final state | Effects observed |
| --- | --- | --- | --- | --- |
| R1 | Empty title submit is rejected | query(draft empty) + `submitSearch` | query + `input.invalid` notice | none |
| R2 | Valid search starts | query + `submitSearch` | searching, `requestId: null` | `search` |
| R3 | requestStarted fills the id | R2 + `requestStarted("search", "1")` | searching, `requestId: "1"` | none |
| R4 | Search found | R3 + `searchOutcome("1", found [A, B])` | candidates, origin search, rows A/B, selected 0 | none |
| R5 | Single candidate still waits | R4 with one row | candidates, one row | none; never auto-resolves |
| R6 | Search not_found | R3 + `searchOutcome("1", not_found, warnings [W])` | query + `lookup.notFound` with W | none |
| R7 | Partial failure stays found | R3 + `searchOutcome("1", found [A], warnings [timeout])` | candidates with A and warnings | none; status never failed |
| R8 | Search failed | R3 + `searchOutcome("1", failed, failures [F])` | query + `lookup.failed` with F | none |
| R9 | Confirm a candidate resolves | candidates(origin search, A) + `confirmCandidate` | resolving, target A, origin candidates | `resolve` (A ref) |
| R10 | Resolve resolved, goal lookup | R9 + start(2) + `resolveOutcome("2", resolved W, candidate_confirmed)` | titles_loading, work W | `findTitles` (W ref) |
| R11 | Resolve resolved, goal resolve | R9 with goal resolve + outcome resolved | resolved station, work W | none |
| R12 | Indirect needs_choice | R9 + `resolveOutcome("2", needs_choice, indirect, [C], warnings)` | candidates, origin choice, rows C | none |
| R13 | Resolve not_found returns to origin | R9 + `resolveOutcome("2", not_found)` | candidates (origin pool A restored) + notice | none |
| R14 | Titles found | R10 + start(3) + `titlesOutcome("3", found, groups G)` | titles, `payload.status found`, groups G | none |
| R15 | Titles no_attested_titles | R10 + `titlesOutcome("3", no_attested_titles, groups [amb])` | titles, status `no_attested_titles`, `titles.none` notice, ambiguous groups retained | none; never offers translation |
| R16 | Titles failed returns to resolved | R10 + `titlesOutcome("3", failed, [F])` | resolved station, work W + `lookup.failed` notice | none |
| R17 | Expand group and back | R14 + `selectGroup(2)` + `back` | group_detail; then titles restored | none |

### 14.2 Cancellation, late responses, and restoration

| # | Scenario | Scripted messages | Expected final state | Effects observed |
| --- | --- | --- | --- | --- |
| C1 | Cancel an in-flight search | R3 + `cancelRequest` | query | `abort("1")` |
| C2 | Late cancelled outcome after cancel | C1 + `searchOutcome("1", cancelled)` | query (unchanged) | none; late message dropped |
| C3 | Late found outcome after cancel | C1 + `searchOutcome("1", found [A])` | query (unchanged) | none; stale candidates never enter state |
| C4 | New search ignores old results | C1 + submitSearch + start(2) + `searchOutcome("1", found)` + `searchOutcome("2", not_found)` | query + `lookup.notFound` | none; id-1 outcome dropped |
| C5 | Cancel resolve returns to pool | R9 + start(2) + `cancelRequest` | candidates, origin pool A | `abort("2")` |
| C6 | Cancel titles load returns to resolved | R10 + start(3) + `cancelRequest` | resolved station, work W | `abort("3")` |
| C7 | Deadline-cancelled search processed | R3 + `searchOutcome("1", cancelled)` | query + `lookup.interrupted` | none |
| C8 | Outcome for the wrong slot is dropped | R3 + `titlesOutcome("1", found)` | searching (unchanged) | none |
| C9 | Quit while searching | R3 + `quit` | searching (unchanged) | `abort("1")`, `exit` 0 |
| C10 | Interrupt while searching | R3 + `interrupt` | searching (unchanged) | `abort("1")`, `exit` 130 |
| C11 | Interrupt while idle | query + `interrupt` | query (unchanged) | `exit` 130 |
| C12 | Back from titles_loading | R10 + start(3) + `back` | resolved station, work W | `abort("3")` |
| C13 | Language change reuses Work ref | R14 + `changeTargetLanguages(["zh-Hant"])` | titles_loading, work W, languages set | `findTitles` with W ref and new languages |
| C14 | Group rows keep module order | R4 | rows A/B in delivered order | none; never re-ranked |

### 14.3 No-leak and purity

| # | Scenario | Scripted messages | Expected result |
| --- | --- | --- | --- |
| L1 | Opaque refs never projected | any terminal state | Projection shapes (section 5.3) contain no `ref` field; JSON documents match issue #12 schema |
| L2 | Reducer purity | any message against any state | `update` performs no I/O; returns frozen `{ next, effects }` |
| L3 | Ids originate only from the runner | any scenario | No message creates an id; state ids appear only after `requestStarted` |
| L4 | No fabrication on failure | R8/R13/R16 | Failures/warnings copy module arrays; no invented candidate, Work, or group |
| L5 | Determinism | repeat any scenario twice | Byte-identical effects and stateAfter with fixed id source and fixtures |

CLI integration tests then assert issue #12 rows (for example S1–S6, R1–R9,
T1–T9, X25) by running the directed sessions above against the module-level
fake; the terminal restore call sequence is asserted by the TUI driver test
double that records acquire/release ordering.

## 15. Invariants

1. `update` is pure and total: it never performs I/O, reads a clock,
   allocates an id, or calls the catalog; it returns immutable `{ next,
   effects }`.
2. Request ids enter state only through `requestStarted`. Effects never carry
   an id; the runner is the only id source and the only `AbortController`
   owner.
3. At most one in-flight request exists per request slot at any time, and a
   replacement never starts before the previous request for that slot is
   aborted.
4. A result message changes state only when the state is the matching waiting
   node and `state.requestId == message.requestId`; every other result is
   dropped with no state change and no effects.
5. `cancelRequest`, `back`, `quit`, and `interrupt` leave a waiting node
   immediately and return `abort`; the coordinator never waits for the
   cancelled outcome of an aborted request.
6. A candidate pool is replaced only by a newer module candidate-bearing
   outcome (`search` `found` or `resolve` `needs_choice`); a `resolve` effect
   is issued only against the current pool's refs or an explicit external
   reference, so stale candidate refs never reach the module.
7. A `findTitles` effect uses only the ref of the Work currently displayed;
   changing languages reuses that ref and never re-resolves.
8. Partial success remains success: `found`/`resolved`/`no_attested_titles`
   with warnings is never collapsed into `failed`, and `failed` always
   carries the module's non-empty failures.
9. `not_found` and `no_attested_titles` are valid completions, never error
   states, and never trigger machine translation (product principle).
10. The coordinator never fabricates evidence: it renders module rows in
    module order and stores module warnings/failures verbatim.
11. Opaque refs never cross the projection boundary; every projection is a
    pure function of the display shapes in section 5.3.
12. Rendering and terminal I/O never decide a transition; they only emit
    intent messages and read published state (issue #9/architecture).

## 16. What this document deliberately does not specify

- Rendering layout, ANSI sequences, input decoding, grapheme width, and the
  resize gate — issue #9 and its spike.
- Module payload internals, candidate ordering, grouping, recommendation, and
  reconciliation — issues #6 and #7.
- JSON serialization order, `schemaVersion`, stdout/stderr text fixtures, and
  exit-code allocation details — issue #12.
- Provider composition, deadlines, retries, cache identity, and
  configuration — issues #8 and #10.
- Package scaffolding and the first vertical slice — issue #14.

## 17. Consequences and risks

### 17.1 Consequences for downstream tickets

- **#14** — Scaffolds `apps/tui`, `packages/core`, and `packages/providers`
  and implements the coordinator contracts here test-first: reducer tests
  from section 14, a module-level fake (issue #6) that scripts outcomes, the
  effect runner with injected ids and a real `AbortController`, the TUI
  driver over the issue #9 thin renderer, and the CLI directed sessions that
  reproduce issue #12 contract rows. CLI JSON projections reuse the issue
  #12 document builders, never a second outcome vocabulary.
- The display shapes in section 5.3 are the in-memory counterpart of the
  issue #12 JSON documents; the first vertical slice snapshots both sides
  against the same fixed fixtures.

### 17.2 Risks and revisit triggers

- **Opaque refs in state are an intentional exception to the no-leak rule.**
  Ref tokens must stay inside `apps/tui` and inside the process; if a future
  hosted or multi-process design appears, refs must be replaced by durable
  External Reference resolution at the module seam (issue #6), not by
  serializing these tokens.
- **The `requestStarted` handshake is an ordering contract.** If a future
  driver ever dispatches outcomes out of order relative to `requestStarted`,
  the stale-drop rule still protects state, but tests must keep the runner's
  ordering explicit.
- **`needs_choice` pools are exactly what the module offers.** If a future
  product flow requires "decline the stronger candidate and confirm the
  original" without the original appearing in the offered pool, the module
  seam (issue #6) must grow an explicit affordance; the coordinator must not
  invent one.
- **Auto-continuation under goal `lookup`** means a resolved outcome starts a
  `findTitles` request without further input. If a future product wants a
  mandatory confirmation pause before title lookup, the change is a reducer
  transition plus the Resolved-station `viewTitles` intent already defined —
  no driver change.
- **Manual terminal gates remain outside automation.** Reducer and driver
  tests prove transitions and restore ordering; live IME, resize, and
  restoration on Windows Terminal remain the issue #9 manual release gate.

## 18. References

Frozen-input constraints (authoritative):

- `CONTEXT.md`, `docs/product-spec.md`, `docs/architecture.md`, ADRs `0001`
  and `0002`.
- `docs/design/catalog-module-interface.md` (issue #6) — `BookTitleCatalog`,
  `RequestOptions.signal`, outcome unions, opaque/External Reference
  lifecycle, and the note that request-id correlation for the state machine
  is this ticket's job.
- `docs/design/evidence-reconciliation.md` (issue #7) — deterministic
  ordering, `needs_choice`, indirect evidence, evidence levels, language
  matching, groups, and warnings.
- `docs/design/tui-rendering-strategy.md` (issue #9) and its disposable spike
  under `spikes/tui/` — thin renderer, pure reducer, driver-owned terminal,
  decoder tokens, and the manual Windows Terminal release gate.
- `docs/design/cli-json-contract.md` (issue #12) — TUI/CLI modes, documents,
  streams, exit codes, no-opaque-handles row R10, signal behavior, and the
  note that TUI screens consume the same outcome vocabulary.
- `docs/design/provider-runtime.md` (issue #8) and
  `docs/design/cache-and-config.md` (issue #10) — typed source failures and
  canonical request identity behind the seam.

Historical planning snapshot (provenance only):
`.scratch/mvp-implementation/issues/13-define-the-application-state-and-effect-seam.md`.
