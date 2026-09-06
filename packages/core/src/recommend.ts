/**
 * Language results and recommendation (issue #7 section 13, issue #12 7.2).
 *
 * `finalizeGroups` assigns the `satisfiesRequest` and `recommended` flags,
 * orders groups deterministically, and decides between the `found` and
 * `no_attested_titles` outcomes. Recommendation is computed within each
 * concrete Title Language tag by the total, deterministic comparator; no tie
 * survives because the last comparison is a lexical group-key tie-break.
 */

import type { TitleGroup } from "./module.ts";
import type { LanguageTag } from "./domain.ts";
import { satisfiesTargetList } from "./normalize.ts";
import { levelRank } from "./group.ts";

export interface TitleResult {
  readonly status: "found" | "no_attested_titles";
  readonly groups: readonly TitleGroup[];
}

/**
 * Deterministic group comparator (issue #7 section 13.2). The comparator
 * uses the attested evidence available on the Title Group document:
 *
 *  1. direct edition evidence (group best level),
 *  2. strong identifier support (member count whose Edition carries a
 *     reference), as distinct supporting editions,
 *  3. independent support (distinct source namespaces, then distinct
 *     supporting editions),
 *  4. publication-metadata completeness (0 for all groups in this slice;
 *     recorded dates are not ranking inputs),
 *  5. stable lexical tie-break over the structured group key.
 */
export function compareGroups(a: TitleGroup, b: TitleGroup): number {
  // 1. Direct edition evidence.
  const levelDelta = levelRank(b.level) - levelRank(a.level);
  if (levelDelta !== 0) return levelDelta;
  // 2. Strong identifier support approximated by supporting members that
  //    carry at least one Edition reference.
  const aId = a.attestations.filter(
    (member) =>
      member.role === "edition_title" ||
      member.role === "edition_display_fallback",
  ).length;
  const bId = b.attestations.filter(
    (member) =>
      member.role === "edition_title" ||
      member.role === "edition_display_fallback",
  ).length;
  if (aId !== bId) return bId - aId;
  // 3. Distinct source namespaces among members.
  const aSources = new Set(a.attestations.map((member) => member.source)).size;
  const bSources = new Set(b.attestations.map((member) => member.source)).size;
  if (aSources !== bSources) return bSources - aSources;
  // 3b. Distinct supporting editions.
  const aEditions = new Set(
    a.attestations.map((member) => member.sourceRecordUrl),
  ).size;
  const bEditions = new Set(
    b.attestations.map((member) => member.sourceRecordUrl),
  ).size;
  if (aEditions !== bEditions) return bEditions - aEditions;
  // 4. Publication-metadata completeness (equal in this slice).
  // 5. Stable lexical tie-break on the structured group key.
  const aKey = groupKeyForCompare(a);
  const bKey = groupKeyForCompare(b);
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return 0;
}

function groupKeyForCompare(group: TitleGroup): string {
  return (
    group.language +
    "\u0000" +
    group.title.normalize("NFC").trim().replace(/\s+/g, " ") +
    "\u0000" +
    (group.subtitle === null
      ? ""
      : group.subtitle.normalize("NFC").trim().replace(/\s+/g, " ")) +
    "\u0000" +
    group.attestations
      .map((member) => `${member.source}:${member.sourceRecordUrl}`)
      .join(",")
  );
}

function languageOrderKey(language: string): string {
  if (language === "und") return "\uFFFF\u0000und";
  if (language === "mul") return "\uFFFF\u0001mul";
  return "\u0000" + language;
}

function isVisible(group: TitleGroup): boolean {
  return group.level !== "ambiguous" && group.satisfiesRequest;
}

/**
 * Finalize raw groups into the module Title Group list: assign language
 * flags, choose exactly one recommended group per concrete language with a
 * visible default group, order the array, and compute the outcome status.
 * `originalLanguage` is the resolved Work's explicit original language when
 * known; groups whose language matches and that contain Work-level original
 * title evidence are annotated as Original Title (display-only).
 */
export function finalizeGroups(
  rawGroups: readonly TitleGroup[],
  targetLanguages: readonly LanguageTag[],
  originalLanguage: string | undefined,
): TitleResult {
  // Satisfies flag: RFC 4647 basic filtering against the target list.
  const satisfied: TitleGroup[] = rawGroups.map((group) => ({
    ...group,
    satisfiesRequest: satisfiesTargetList(group.language, targetLanguages),
  }));

  // Original-title annotation (issue #7 section 10.4): only with explicit
  // original-language evidence on a group containing Work-level statements.
  const annotated =
    originalLanguage === undefined
      ? satisfied
      : satisfied.map((group) =>
          group.language === originalLanguage &&
          group.attestations.some(
            (member) => member.role === "work_original_title",
          )
            ? { ...group, originalTitle: true }
            : group,
        );

  // Recommendation: exactly one visible default group per concrete language.
  const recommended = new Set<TitleGroup>();
  const byLanguage = new Map<string, TitleGroup[]>();
  for (const group of annotated) {
    if (group.language === "und" || group.language === "mul") continue;
    const bucket = byLanguage.get(group.language) ?? [];
    bucket.push(group);
    byLanguage.set(group.language, bucket);
  }
  for (const bucket of byLanguage.values()) {
    const visible = bucket.filter(isVisible);
    if (visible.length === 0) continue;
    visible.sort(compareGroups);
    recommended.add(visible[0]);
  }

  const sorted = [...annotated]
    .sort((a, b) => {
      const aKey = languageOrderKey(a.language);
      const bKey = languageOrderKey(b.language);
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      return compareGroups(a, b);
    })
    .map((group) =>
      recommended.has(group) ? { ...group, recommended: true } : group,
    );

  const anyVisible = sorted.some(isVisible);
  return {
    status: anyVisible ? "found" : "no_attested_titles",
    groups: sorted,
  };
}
