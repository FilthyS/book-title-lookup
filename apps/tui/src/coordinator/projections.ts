/**
 * CLI projection (issue #13 section 12, issue #12 sections 8-10).
 *
 * Terminal states are determined purely from `SessionState`; projection maps
 * a terminal state to the abstract outcome that JSON and human writers
 * render. Projection never leaks an opaque ref.
 */

import type {
  LanguageTag,
  ResolvedWork,
  SourceFailure,
  SourceWarning,
  TitleGroup,
  WorkCandidate,
} from "../../../../packages/core/src/module.ts";
import type { SessionState } from "./state.ts";

export type LookupCommand = "search" | "resolve" | "titles";

export type TerminalSummary =
  | {
      readonly status: "found";
      readonly candidates: readonly WorkCandidate[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "needs_choice";
      readonly reason: "ambiguous_identifier" | "indirect_evidence";
      readonly candidates: readonly WorkCandidate[];
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "resolved";
      readonly work: ResolvedWork;
      readonly confirmation: "strong_reference";
      readonly warnings: readonly SourceWarning[];
    }
  | {
      readonly status: "not_found";
      readonly warnings: readonly SourceWarning[];
    }
  | { readonly status: "failed"; readonly failures: readonly SourceFailure[] }
  | { readonly status: "cancelled" }
  | {
      readonly status: "titles_found" | "no_attested_titles";
      readonly work: ResolvedWork;
      readonly targetLanguages: readonly LanguageTag[];
      readonly groups: readonly TitleGroup[];
      readonly warnings: readonly SourceWarning[];
    };

function noticeOf(state: SessionState) {
  switch (state.screen) {
    case "query":
    case "candidates":
    case "resolved":
    case "titles":
      return state.notice;
    default:
      return null;
  }
}

function warningsOf(state: SessionState): readonly SourceWarning[] {
  switch (state.screen) {
    case "candidates":
      return state.pool.warnings;
    case "resolved":
    case "query":
    case "titles":
      return noticeOf(state)?.warnings ?? [];
    default:
      return [];
  }
}

function failuresOf(state: SessionState): readonly SourceFailure[] {
  switch (state.screen) {
    case "resolved":
    case "query":
    case "candidates":
    case "titles":
      return noticeOf(state)?.failures ?? [];
    default:
      return [];
  }
}

function noticeKind(state: SessionState): string | null {
  return noticeOf(state)?.messageKey ?? null;
}

function candidatesPayload(state: SessionState): {
  readonly candidates: readonly WorkCandidate[];
  readonly warnings: readonly SourceWarning[];
} {
  if (state.screen !== "candidates") {
    return { candidates: [], warnings: [] };
  }
  return { candidates: state.pool.rows, warnings: state.pool.warnings };
}

function stripWorkRef(work: ResolvedWork): ResolvedWork {
  return work;
}

/**
 * Project one command's directed-session terminal state. For `titles`, a
 * title-phase failure lands on the Resolved station with a notice, so this
 * helper distinguishes resolve-phase outcomes (Query station) from
 * title-phase outcomes (Resolved station).
 */
export function projectTerminal(
  command: LookupCommand,
  state: SessionState,
): TerminalSummary {
  const kind = noticeKind(state);
  const isCancelled = kind === "lookup.interrupted";
  const isFailed = kind === "lookup.failed";
  const isNotFound = kind === "lookup.notFound";
  const baseFailures = failuresOf(state);
  const baseWarnings = warningsOf(state);

  // A cancel that reached the query or resolved station is cancelled.
  if (isCancelled) return { status: "cancelled" };
  if (isFailed && failuresOf(state).length > 0) {
    return { status: "failed", failures: baseFailures };
  }
  if (isNotFound) return { status: "not_found", warnings: baseWarnings };

  switch (state.screen) {
    case "candidates": {
      const pool = state.pool;
      if (pool.origin === "choice" && pool.reason !== undefined) {
        return {
          status: "needs_choice",
          reason: pool.reason,
          candidates: pool.rows,
          warnings: pool.warnings,
        };
      }
      return {
        status: "found",
        candidates: pool.rows,
        warnings: pool.warnings,
      };
    }
    case "resolved": {
      if (command === "resolve") {
        return {
          status: "resolved",
          work: stripWorkRef(state.snapshot.work),
          confirmation: "strong_reference",
          warnings: baseWarnings,
        };
      }
      // A title-phase failure/cancel on the Resolved station.
      if (isFailed) return { status: "failed", failures: baseFailures };
      if (isCancelled) return { status: "cancelled" };
      return { status: "cancelled" };
    }
    case "titles": {
      const found = state.payload.status === "found";
      return {
        status: found ? "titles_found" : "no_attested_titles",
        work: stripWorkRef(state.payload.work),
        targetLanguages: state.payload.targetLanguages,
        groups: state.payload.groups,
        warnings: state.payload.warnings,
      };
    }
    default:
      return { status: "cancelled" };
  }
}

export { candidatesPayload };
