/**
 * Title grouping (issue #7 section 12).
 *
 * A Title Group is the set of Title Attestations with the same canonical
 * Title Language tag, the same normalized main title, and an equal subtitle
 * component (both absent, or both present and equal). Grouping never
 * discards attestations and never merges across language, text, or subtitle
 * differences.
 */

import type { EvidenceLevel, TitleAttestation, TitleGroup } from "./module.ts";
import { normalizeTitleText } from "./normalize.ts";

/** An attestation together with its assigned evidence level. The JSON-facing
 *  TitleAttestation intentionally carries no level; grouping lifts the group
 *  level from members. */
export interface LeveledAttestation {
  readonly level: EvidenceLevel;
  readonly attestation: TitleAttestation;
}

const ABSENT = "\u0000";

function groupKeyOf(attestation: TitleAttestation): string {
  const subtitleKey =
    attestation.subtitle === null
      ? ABSENT
      : normalizeTitleText(attestation.subtitle);
  return (
    attestation.language +
    "\u0000" +
    normalizeTitleText(attestation.text) +
    "\u0000" +
    subtitleKey
  );
}

function levelRank(level: EvidenceLevel): number {
  if (level === "verified") return 3;
  if (level === "probable") return 2;
  return 1;
}

function memberOrder(a: TitleAttestation, b: TitleAttestation): number {
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.sourceRecordUrl !== b.sourceRecordUrl) {
    return a.sourceRecordUrl < b.sourceRecordUrl ? -1 : 1;
  }
  const aId = a.statementId ?? "";
  const bId = b.statementId ?? "";
  if (aId !== bId) return aId < bId ? -1 : 1;
  if (a.role !== b.role) return a.role < b.role ? -1 : 1;
  return 0;
}

/**
 * Group leveled attestations into Title Groups. Groups are returned sorted by
 * their structured key so result order is deterministic before
 * recommendation and language flags are applied. The `recommended`,
 * `satisfiesRequest`, and `originalTitle` flags start false and are set by
 * `finalizeGroups`.
 */
export function groupAttestations(
  members: readonly LeveledAttestation[],
): readonly TitleGroup[] {
  const buckets = new Map<string, LeveledAttestation[]>();
  for (const member of members) {
    const key = groupKeyOf(member.attestation);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [member]);
    } else {
      bucket.push(member);
    }
  }
  const keys = [...buckets.keys()].sort();
  const groups: TitleGroup[] = [];
  for (const key of keys) {
    const bucket = buckets.get(key) as LeveledAttestation[];
    const first = bucket[0].attestation;
    const attestations = bucket
      .map((member) => member.attestation)
      .sort(memberOrder);
    const level = bucket.reduce<EvidenceLevel>((best, member) => {
      return levelRank(member.level) > levelRank(best) ? member.level : best;
    }, "ambiguous");
    const displayTitle = attestations[0].text;
    const group: TitleGroup = {
      language: first.language,
      title: displayTitle,
      subtitle: first.subtitle,
      level,
      recommended: false,
      satisfiesRequest: false,
      originalTitle: false,
      attestations,
    };
    groups.push(group);
  }
  return groups;
}

export { levelRank };
