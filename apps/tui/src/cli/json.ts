/**
 * JSON document builders for the lookup commands (issue #12 sections 7-8).
 *
 * Every builder returns an object whose key order is the exact order the
 * contract lists so the compact serializer never reorders a document.
 * `schemaVersion` is always first; warnings/failures are normalized and
 * ordered deterministically; no opaque ref ever appears.
 */

import type {
  ExternalReference,
  SourceFailure,
  SourceWarning,
} from "../../../../packages/core/src/module.ts";
import {
  canonicalReferences,
  compareIssues,
  sortRecord,
} from "../../../../packages/core/src/domain.ts";
import { CLI_JSON_SCHEMA_VERSION } from "../json/serialize.ts";
import type { TerminalSummary } from "../coordinator/projections.ts";
import type { LookupCommand } from "../coordinator/projections.ts";

export function warningDocument(
  warning: SourceWarning,
): {
  readonly source: string;
  readonly code: string;
  readonly references: object[];
  readonly details: object;
} {
  return {
    source: warning.source,
    code: warning.code,
    references: warning.references.map((reference) =>
      referenceDocument(reference)
    ),
    details: sortRecord(warning.details ?? {}),
  };
}

export function failureDocument(
  failure: SourceFailure,
): {
  readonly source: string;
  readonly code: string;
  readonly references: object[];
  readonly details: object;
} {
  return {
    source: failure.source,
    code: failure.code,
    references: failure.references.map((reference) =>
      referenceDocument(reference)
    ),
    details: sortRecord(failure.details ?? {}),
  };
}

function warningsArray(warnings: readonly SourceWarning[]): object[] {
  return [...warnings]
    .sort(compareIssues)
    .map((warning) => warningDocument(warning));
}

function failuresArray(failures: readonly SourceFailure[]): object[] {
  return [...failures]
    .sort(compareIssues)
    .map((failure) => failureDocument(failure));
}

export function referenceDocument(reference: ExternalReference): {
  readonly namespace: string;
  readonly value: string;
} {
  return { namespace: reference.namespace, value: reference.value };
}

function referencesArray(references: readonly ExternalReference[]): object[] {
  return canonicalReferences(references).map((reference) =>
    referenceDocument(reference)
  );
}

function candidateDocument(candidate: {
  readonly title: string;
  readonly alternativeTitles: readonly string[];
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly editionCount?: number;
  readonly contentLanguages: readonly string[];
  readonly references: readonly ExternalReference[];
}): object {
  return {
    title: candidate.title,
    alternativeTitles: candidate.alternativeTitles,
    authors: candidate.authors,
    ...(candidate.publicationYear !== undefined
      ? { publicationYear: candidate.publicationYear }
      : {}),
    ...(candidate.editionCount !== undefined
      ? { editionCount: candidate.editionCount }
      : {}),
    contentLanguages: candidate.contentLanguages,
    references: referencesArray(candidate.references),
  };
}

function workDocument(work: {
  readonly title: string;
  readonly authors: readonly string[];
  readonly firstPublicationYear?: number;
  readonly contentLanguages: readonly string[];
  readonly references: readonly ExternalReference[];
}): object {
  return {
    title: work.title,
    authors: work.authors,
    ...(work.firstPublicationYear !== undefined
      ? { firstPublicationYear: work.firstPublicationYear }
      : {}),
    contentLanguages: work.contentLanguages,
    references: referencesArray(work.references),
  };
}

function groupDocument(group: {
  readonly language: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly level: string;
  readonly recommended: boolean;
  readonly satisfiesRequest: boolean;
  readonly originalTitle: boolean;
  readonly attestations: readonly object[];
}): object {
  return {
    language: group.language,
    title: group.title,
    subtitle: group.subtitle,
    level: group.level,
    recommended: group.recommended,
    satisfiesRequest: group.satisfiesRequest,
    originalTitle: group.originalTitle,
    attestations: group.attestations,
  };
}

function attestationDocument(a: {
  readonly source: string;
  readonly role: string;
  readonly text: string;
  readonly subtitle: string | null;
  readonly language: string;
  readonly sourceRecordUrl: string;
  readonly references: readonly ExternalReference[];
  readonly statementId?: string;
  readonly rank?: string;
  readonly stale: boolean;
  readonly fetchedAt: string;
}): object {
  return {
    source: a.source,
    role: a.role,
    text: a.text,
    subtitle: a.subtitle,
    language: a.language,
    sourceRecordUrl: a.sourceRecordUrl,
    references: referencesArray(a.references),
    ...(a.statementId !== undefined ? { statementId: a.statementId } : {}),
    ...(a.rank !== undefined ? { rank: a.rank } : {}),
    stale: a.stale,
    fetchedAt: a.fetchedAt,
  };
}

export function documentForSummary(
  command: LookupCommand,
  summary: TerminalSummary,
): object {
  const base = { schemaVersion: CLI_JSON_SCHEMA_VERSION, command };
  switch (summary.status) {
    case "found":
      return {
        ...base,
        status: "found",
        candidates: summary.candidates.map((candidate) =>
          candidateDocument(candidate)
        ),
        warnings: warningsArray(summary.warnings),
      };
    case "needs_choice":
      return {
        ...base,
        status: "needs_choice",
        reason: summary.reason,
        candidates: summary.candidates.map((candidate) =>
          candidateDocument(candidate)
        ),
        warnings: warningsArray(summary.warnings),
      };
    case "resolved":
      return {
        ...base,
        status: "resolved",
        confirmation: summary.confirmation,
        work: workDocument(summary.work),
        warnings: warningsArray(summary.warnings),
      };
    case "not_found":
      return {
        ...base,
        status: "not_found",
        warnings: warningsArray(summary.warnings),
      };
    case "failed":
      return {
        ...base,
        status: "failed",
        failures: failuresArray(summary.failures),
      };
    case "cancelled":
      return { ...base, status: "cancelled" };
    case "titles_found":
    case "no_attested_titles":
      return {
        ...base,
        status: summary.status === "titles_found"
          ? "found"
          : "no_attested_titles",
        work: workDocument(summary.work),
        targetLanguages: summary.targetLanguages,
        groups: summary.groups.map((group) =>
          groupDocument({
            ...group,
            attestations: group.attestations.map((a) => attestationDocument(a)),
          })
        ),
        warnings: warningsArray(summary.warnings),
      };
  }
}
