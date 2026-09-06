/**
 * The catalog module application seam (issue #6, refined by issues #7/#12).
 *
 * `BookTitleCatalog` is the only interface the application (CLI and TUI)
 * calls for bibliographic work. This file freezes the query types, the
 * opaque-ref lifecycle, the outcome unions, and the display payload shapes
 * that the reconciliation pipeline produces. Display payload shapes mirror
 * the issue #12 JSON documents so projections never re-derive facts.
 */

import type {
  ExternalReference,
  LanguageTag,
  SourceFailure,
  SourceId,
  SourceWarning,
} from "./domain.ts";

export type {
  ExternalReference,
  LanguageTag,
  SourceFailure,
  SourceId,
  SourceIssueBase,
  SourceIssueCode,
  SourceWarning,
} from "./domain.ts";

/** Opaque handle to one Work Candidate. Callers store and return it; they
 *  never parse or construct it. Valid only while the candidate response that
 *  produced it is the active one. */
declare const candidateRefBrand: unique symbol;
export type CandidateRef = string & {
  readonly [candidateRefBrand]: typeof candidateRefBrand;
};

/** Opaque handle to the Resolved Work. Callers pass it to `findTitles` for
 *  the rest of the module session or until it is replaced. */
declare const resolvedWorkRefBrand: unique symbol;
export type ResolvedWorkRef = string & {
  readonly [resolvedWorkRefBrand]: typeof resolvedWorkRefBrand;
};

/** Search input exactly as the user supplied it. Fields are raw user text;
 *  the module performs normalization. */
export interface BookQuery {
  /** Title text (Chinese in the MVP). Required; never empty or whitespace. */
  readonly title: string;
  /** Optional author or responsible creator. */
  readonly author?: string;
  /** Optional ISBN in any normal user form; the module normalizes it. */
  readonly isbn?: string;
  /** Optional publication year as typed by the user. */
  readonly publicationYear?: number;
}

/** Filters for the title-lookup phase. */
export interface TitleQuery {
  /** Requested result languages. An empty array means all discovered
   *  languages. Unknown-language evidence never satisfies a requested
   *  language. */
  readonly targetLanguages: readonly LanguageTag[];
}

/** Options shared by every module operation. */
export interface RequestOptions {
  /** Cancellation signal. When aborted the operation stops promptly and
   *  resolves to `{ status: "cancelled" }`. */
  readonly signal?: AbortSignal;
}

/** What `resolve()` may be asked to confirm. */
export type ResolveTarget =
  | { readonly kind: "candidate"; readonly ref: CandidateRef }
  | {
      readonly kind: "externalReference";
      readonly reference: ExternalReference;
    };

export type ResolveConfirmation = "strong_reference" | "candidate_confirmed";

export type ResolveChoiceReason = "ambiguous_identifier" | "indirect_evidence";

/** A Work Candidate offered for confirmation. Never serializes its ref;
 *  automation selects the candidate by one of its External References. */
export interface WorkCandidate {
  readonly ref: CandidateRef;
  readonly title: string;
  readonly alternativeTitles: readonly string[];
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly editionCount?: number;
  readonly contentLanguages: readonly LanguageTag[];
  /** Identity-mapped Work references; ordered by namespace then value. */
  readonly references: readonly ExternalReference[];
}

/** A Work whose identity has been confirmed. */
export interface ResolvedWork {
  readonly ref: ResolvedWorkRef;
  readonly title: string;
  readonly authors: readonly string[];
  readonly firstPublicationYear?: number;
  readonly contentLanguages: readonly LanguageTag[];
  /** Canonical Work references; ordered by namespace then value. */
  readonly references: readonly ExternalReference[];
}

export type EvidenceLevel = "verified" | "probable" | "ambiguous";

export type AttestationRole =
  | "edition_title"
  | "edition_subtitle"
  | "edition_display_fallback"
  | "work_original_title";

/** One title attestation backing a Title Group. */
export interface TitleAttestation {
  readonly source: SourceId;
  readonly role: AttestationRole;
  readonly text: string;
  /** Recorded separate subtitle, or null when none was recorded. */
  readonly subtitle: string | null;
  readonly language: LanguageTag;
  readonly sourceRecordUrl: string;
  readonly references: readonly ExternalReference[];
  readonly statementId?: string;
  readonly rank?: "preferred" | "normal";
  readonly stale: boolean;
  readonly fetchedAt: string;
}

/** A language- and title-normalized result group returned by title lookup.
 *  `recommended`, `satisfiesRequest`, and `originalTitle` are computed by the
 *  module so consumers never reimplement RFC 4647 or the comparator. */
export interface TitleGroup {
  readonly language: LanguageTag | "und" | "mul";
  readonly title: string;
  readonly subtitle: string | null;
  readonly level: EvidenceLevel;
  readonly recommended: boolean;
  readonly satisfiesRequest: boolean;
  readonly originalTitle: boolean;
  readonly attestations: readonly TitleAttestation[];
}

export type SearchOutcome =
  | {
      readonly status: "found";
      readonly candidates: readonly WorkCandidate[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "not_found";
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "failed";
      readonly failures: readonly SourceFailure[];
    }
  | { readonly status: "cancelled" };

export type ResolveOutcome =
  | {
      readonly status: "resolved";
      readonly work: ResolvedWork;
      readonly confirmation: ResolveConfirmation;
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "needs_choice";
      readonly reason: ResolveChoiceReason;
      readonly candidates: readonly WorkCandidate[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "not_found";
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "failed";
      readonly failures: readonly SourceFailure[];
    }
  | { readonly status: "cancelled" };

export type TitleLookupOutcome =
  | {
      readonly status: "found";
      readonly groups: readonly TitleGroup[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "no_attested_titles";
      readonly groups: readonly TitleGroup[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "failed";
      readonly failures: readonly SourceFailure[];
    }
  | { readonly status: "cancelled" };

/**
 * The catalog module: the only interface the application calls for
 * bibliographic work. Implementations never reject for expected conditions;
 * every expected outcome is one of the discriminated statuses above.
 */
export interface BookTitleCatalog {
  search(query: BookQuery, options?: RequestOptions): Promise<SearchOutcome>;
  resolve(
    target: ResolveTarget,
    options?: RequestOptions,
  ): Promise<ResolveOutcome>;
  findTitles(
    work: ResolvedWorkRef,
    query: TitleQuery,
    options?: RequestOptions,
  ): Promise<TitleLookupOutcome>;
}
