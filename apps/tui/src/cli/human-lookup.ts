/**
 * Deterministic human text for the lookup commands (issue #12 section 10).
 *
 * Without `--json`, each lookup command writes this plain text to stdout;
 * warnings render to stderr. Human text uses the same grouping and ordering
 * rules as JSON and never invents facts beyond the document content.
 */

import type {
  ExternalReference,
  ResolvedWork,
  SourceFailure,
  SourceWarning,
  TitleGroup,
  WorkCandidate,
} from "../../../../packages/core/src/module.ts";
import type { TerminalSummary } from "../coordinator/projections.ts";

function refsText(references: readonly ExternalReference[]): string {
  return references
    .map((reference) => `${reference.namespace}:${reference.value}`)
    .join(", ");
}

function authorText(authors: readonly string[]): string {
  return authors.length === 0 ? "" : `   Authors: ${authors.join(", ")}\n`;
}

function candidateLines(
  candidates: readonly WorkCandidate[],
): string {
  if (candidates.length === 0) return "";
  const parts: string[] = [];
  candidates.forEach((candidate, index) => {
    const year = candidate.publicationYear !== undefined
      ? ` (${candidate.publicationYear})`
      : "";
    parts.push(`${index + 1}. ${candidate.title}${year}\n`);
    parts.push(authorText(candidate.authors));
    if (candidate.alternativeTitles.length > 0) {
      parts.push(
        `   Alternative titles: ${candidate.alternativeTitles.join(" | ")}\n`,
      );
    }
    parts.push(`   References: ${refsText(candidate.references)}\n`);
  });
  return parts.join("");
}

function groupAttestationLines(group: TitleGroup): string {
  const editionRefs = group.attestations.flatMap((member) => member.references);
  const refs = editionRefs.length > 0
    ? `   Editions: ${refsText(editionRefs)}\n`
    : "";
  return `  ${group.title}  [${group.level}]\n${refs}`;
}

function titleGroupsHuman(
  summary: Extract<
    TerminalSummary,
    { readonly status: "titles_found" | "no_attested_titles" }
  >,
): string {
  const parts = [`Attested titles for ${summary.work.title}\n`];
  const defaultGroups = summary.groups.filter(
    (group) => group.level !== "ambiguous" && group.satisfiesRequest,
  );
  const ambiguous = summary.groups.filter(
    (group) => group.level === "ambiguous" || !group.satisfiesRequest,
  );
  if (defaultGroups.length > 0) {
    const byLanguage = new Map<string, TitleGroup[]>();
    for (const group of defaultGroups) {
      const bucket = byLanguage.get(group.language) ?? [];
      bucket.push(group);
      byLanguage.set(group.language, bucket);
    }
    for (const [language, groups] of byLanguage) {
      parts.push(`\n${language}`);
      for (const group of groups) {
        parts.push(group.recommended ? " (recommended)\n" : "\n");
        parts.push(groupAttestationLines(group));
      }
    }
  }
  if (ambiguous.length > 0) {
    parts.push("\nAmbiguous\n");
    for (const group of ambiguous) {
      parts.push(
        `  ${group.language}: ${group.title}  [${group.level}]\n`,
      );
    }
  }
  return parts.join("");
}

export function humanTextForSummary(summary: TerminalSummary): string {
  switch (summary.status) {
    case "found":
      return `Candidates\n${candidateLines(summary.candidates)}`;
    case "needs_choice": {
      const reason = summary.reason === "ambiguous_identifier"
        ? "The identifier is ambiguous; choose a Work to confirm."
        : "Indirect evidence found a stronger candidate; choose a Work to confirm.";
      return `${reason}\n${candidateLines(summary.candidates)}`;
    }
    case "resolved": {
      const work: ResolvedWork = summary.work;
      const parts = [
        "Resolved work\n",
        `Title: ${work.title}\n`,
        authorText(work.authors),
      ];
      if (work.firstPublicationYear !== undefined) {
        parts.push(`First published: ${work.firstPublicationYear}\n`);
      }
      parts.push(`References: ${refsText(work.references)}\n`);
      return parts.join("");
    }
    case "not_found":
      return "No matching work found.\n";
    case "failed":
      return "The lookup failed; no usable answer was produced.\n";
    case "cancelled":
      return "Interrupted.\n";
    case "titles_found":
      return titleGroupsHuman(summary);
    case "no_attested_titles":
      return titleGroupsHuman(summary) +
        "No attested title satisfied the requested languages.\n";
  }
}

export function warningsToStderr(
  warnings: readonly SourceWarning[],
): string {
  if (warnings.length === 0) return "";
  return warnings
    .map((warning) => {
      const refs = warning.references.length > 0
        ? ` (${refsText(warning.references)})`
        : "";
      return `warning: ${warning.source} ${warning.code}${refs}\n`;
    })
    .join("");
}

export function failuresToStderr(
  failures: readonly SourceFailure[],
): string {
  if (failures.length === 0) return "";
  return failures
    .map((failure) => {
      const refs = failure.references.length > 0
        ? ` (${refsText(failure.references)})`
        : "";
      return `error: ${failure.source} ${failure.code}${refs}\n`;
    })
    .join("");
}
