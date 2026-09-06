/**
 * Coordinator session state (issue #13 sections 4-5).
 *
 * State is a discriminated union on `screen`. Every node carries the session
 * goal, the preserved query draft, and the target-language filter. Opaque
 * module refs live on rows only for requests; projections never leak them.
 */

import type {
  CandidateRef,
  ExternalReference,
  LanguageTag,
  ResolveChoiceReason,
  SourceFailure,
  SourceWarning,
  WorkCandidate,
} from "../../../../packages/core/src/module.ts";
import type {
  BookQuery,
  ResolvedWork,
  TitleGroup,
} from "../../../../packages/core/src/module.ts";

/** Why this session runs. Never changed after session start. */
export type SessionGoal =
  | { readonly kind: "lookup" }
  | { readonly kind: "resolve" };

export type FieldName = "title" | "author" | "isbn" | "year";

export interface EditableText {
  readonly text: string;
  readonly cursor: number;
}

export interface QueryDraft {
  readonly fields: Readonly<Record<FieldName, EditableText>>;
  readonly focused: FieldName;
}

export function emptyQueryDraft(): QueryDraft {
  return {
    fields: {
      title: { text: "", cursor: 0 },
      author: { text: "", cursor: 0 },
      isbn: { text: "", cursor: 0 },
      year: { text: "", cursor: 0 },
    },
    focused: "title",
  };
}

export function draftWithTitle(title: string): QueryDraft {
  return {
    fields: {
      title: { text: title, cursor: title.length },
      author: { text: "", cursor: 0 },
      isbn: { text: "", cursor: 0 },
      year: { text: "", cursor: 0 },
    },
    focused: "title",
  };
}

/** One Work Candidate row: the module payload (ref included). */
export type CandidateRow = WorkCandidate;

export interface CandidatePool {
  readonly origin: "search" | "choice";
  readonly reason?: ResolveChoiceReason;
  readonly rows: readonly CandidateRow[];
  readonly warnings: readonly SourceWarning[];
}

/** A Resolved Work as stored at the Resolved station. */
export type ResolvedWorkView = ResolvedWork;

export type TitleGroupView = TitleGroup;

/** The complete Title Group outcome payload. */
export interface TitlesPayload {
  readonly work: ResolvedWorkView;
  readonly targetLanguages: readonly LanguageTag[];
  readonly status: "found" | "no_attested_titles";
  readonly groups: readonly TitleGroupView[];
  readonly warnings: readonly SourceWarning[];
}

export type MessageKey =
  | "lookup.notFound"
  | "lookup.interrupted"
  | "lookup.failed"
  | "titles.none"
  | "results.partial"
  | "input.invalid";

export interface Notice {
  readonly messageKey: MessageKey;
  readonly warnings?: readonly SourceWarning[];
  readonly failures?: readonly SourceFailure[];
}

export type ResolveOrigin =
  | {
      readonly station: "candidates";
      readonly pool: CandidatePool;
      readonly selected: number;
    }
  | { readonly station: "query" };

export interface ResolvedSnapshot {
  readonly work: ResolvedWorkView;
  readonly origin: ResolveOrigin;
}

/** Common fields on every session node. */
interface SessionBase {
  readonly goal: SessionGoal;
  readonly draft: QueryDraft;
  readonly targetLanguages: readonly LanguageTag[];
}

export interface QueryState extends SessionBase {
  readonly screen: "query";
  readonly notice: Notice | null;
}

export interface SearchingState extends SessionBase {
  readonly screen: "searching";
  readonly query: BookQuery;
  readonly requestId: string | null;
}

export interface CandidatesState extends SessionBase {
  readonly screen: "candidates";
  readonly pool: CandidatePool;
  readonly selected: number;
  readonly notice: Notice | null;
}

export interface ResolvingState extends SessionBase {
  readonly screen: "resolving";
  readonly origin: ResolveOrigin;
  readonly target:
    | { readonly kind: "candidate"; readonly ref: CandidateRef }
    | {
        readonly kind: "externalReference";
        readonly reference: ExternalReference;
      };
  readonly requestId: string | null;
}

export interface ResolvedState extends SessionBase {
  readonly screen: "resolved";
  readonly snapshot: ResolvedSnapshot;
  readonly notice: Notice | null;
}

export interface TitlesLoadingState extends SessionBase {
  readonly screen: "titles_loading";
  readonly snapshot: ResolvedSnapshot;
  readonly requestId: string | null;
}

export interface TitlesState extends SessionBase {
  readonly screen: "titles";
  readonly snapshot: ResolvedSnapshot;
  readonly payload: TitlesPayload;
  readonly notice: Notice | null;
}

export interface GroupDetailState extends SessionBase {
  readonly screen: "group_detail";
  readonly snapshot: ResolvedSnapshot;
  readonly payload: TitlesPayload;
  readonly groupIndex: number;
}

export type SessionState =
  | QueryState
  | SearchingState
  | CandidatesState
  | ResolvingState
  | ResolvedState
  | TitlesLoadingState
  | TitlesState
  | GroupDetailState;

export type RequestSlot = "search" | "resolve" | "titles";
export type RequestId = string;
