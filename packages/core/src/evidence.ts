/**
 * Core input model and helpers (issue #7 sections 4 and 6).
 *
 * Core receives normalized, typed Source Records from the internal evidence
 * port. Records preserve provenance and carry decoded claims; reconciliation
 * never mutates them and never discards them destructively.
 */

import type {
  ExternalReference,
  LanguageTag,
  SourceWarning,
} from "./domain.ts";

export type RecordKind = "work" | "edition" | "redirect" | "other" | "unknown";
export type Rank = "preferred" | "normal" | "deprecated";

/** A claim variant per issue #7 section 4. `statementId` and `rank` carry
 *  Wikidata provenance where applicable. */
export type Claim =
  | {
    readonly type: "title";
    readonly text: string;
    /** Explicit title-level language tag when the source records one
     *  (Wikidata P1476 monolingual text). */
    readonly language?: LanguageTag;
    readonly statementId?: string;
    readonly rank?: Rank;
  }
  | {
    readonly type: "subtitle";
    readonly text: string;
    readonly statementId?: string;
    readonly rank?: Rank;
  }
  | { readonly type: "content-language"; readonly language: LanguageTag }
  | {
    readonly type: "title-language";
    readonly language: LanguageTag;
    readonly statementId?: string;
  }
  | { readonly type: "translated-from"; readonly language: LanguageTag }
  | {
    readonly type: "work-link";
    readonly reference: ExternalReference;
    readonly statementId?: string;
    readonly rank?: Rank;
  }
  | {
    readonly type: "original-title";
    readonly text: string;
    readonly language?: LanguageTag;
    /** Source field family: translation_of | work_titles | other_titles. */
    readonly kind?: string;
    readonly statementId?: string;
  }
  | {
    readonly type: "author";
    readonly name: string;
    readonly reference?: ExternalReference;
  }
  | {
    readonly type: "translator";
    readonly name: string;
    readonly reference?: ExternalReference;
  }
  | { readonly type: "publisher"; readonly name: string }
  | { readonly type: "publication-year"; readonly year: number }
  | { readonly type: "publication-date"; readonly value: string }
  | {
    readonly type: "identifier";
    readonly namespace: string;
    readonly value: string;
    readonly statementId?: string;
    readonly rank?: Rank;
  }
  | {
    readonly type: "class";
    readonly value: string;
    readonly statementId?: string;
    readonly rank?: Rank;
  }
  | {
    readonly type: "edition-type";
    readonly value:
      | "abridged"
      | "excerpted"
      | "summarized"
      | "adaptation"
      | "collection"
      | "periodical"
      | "non-text";
  }
  | { readonly type: "page-count"; readonly pages: number };

/** A matched search text that surfaced a record (label, alias, snippet).
 *  This is a Search Alias, never a title attestation. */
export interface MatchedAlias {
  readonly text: string;
  readonly language?: LanguageTag;
}

/** A source record preserved with provenance and decoded claims. */
export interface SourceRecord {
  readonly source: "openlibrary" | "wikidata";
  readonly sourceRecordUrl: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
  readonly kind: RecordKind;
  /** Namespaced references on this record. */
  readonly refs: readonly ExternalReference[];
  readonly claims: readonly Claim[];
  readonly warnings?: readonly SourceWarning[];
}

/** A search hit: one Source Record plus the aliases that matched it. */
export interface SourceHit {
  readonly record: SourceRecord;
  readonly matchedAliases: readonly MatchedAlias[];
}

export function claimsOfType<T extends Claim["type"]>(
  record: SourceRecord,
  type: T,
): Extract<Claim, { readonly type: T }>[] {
  return record.claims.filter(
    (claim): claim is Extract<Claim, { readonly type: T }> =>
      claim.type === type,
  );
}

export function hasClaimOfType(
  record: SourceRecord,
  type: Claim["type"],
): boolean {
  return record.claims.some((claim) => claim.type === type);
}

const EXCLUDED_EDITION_TYPES: ReadonlySet<string> = new Set([
  "abridged",
  "excerpted",
  "summarized",
  "adaptation",
  "collection",
  "periodical",
  "non-text",
]);

/** True when the record is explicitly an excluded publication type. */
export function isExcludedEdition(record: SourceRecord): boolean {
  return record.claims.some(
    (claim) =>
      claim.type === "edition-type" && EXCLUDED_EDITION_TYPES.has(claim.value),
  );
}

/** Work references carried by a record: an Open Library work key, or a
 *  Wikidata item on a record classified as a Work. */
export function workReferencesOfRecord(
  record: SourceRecord,
): readonly ExternalReference[] {
  return record.refs.filter((reference) => {
    if (reference.namespace === "openlibrary:work") return true;
    return reference.namespace === "wikidata:item" && record.kind === "work";
  });
}

/** Editions named by the record through an Edition-to-Work relation. */
export function editionToWorkReferences(
  record: SourceRecord,
): readonly ExternalReference[] {
  const out: ExternalReference[] = [];
  for (const claim of claimsOfType(record, "work-link")) {
    if (claim.rank === "deprecated") continue;
    out.push(claim.reference);
  }
  return out;
}

/** Wikidata P648-style identity mapping on a record: an `openlibrary:work`
 *  identifier claim at a non-deprecated rank. */
export function openLibraryWorkIdentifier(
  record: SourceRecord,
): ExternalReference | undefined {
  for (const claim of claimsOfType(record, "identifier")) {
    if (claim.namespace !== "openlibrary:work") continue;
    if (claim.rank === "deprecated") continue;
    return { namespace: "openlibrary:work", value: claim.value };
  }
  return undefined;
}

/** All non-deprecated title claims on a record in record order. */
export function titleClaims(
  record: SourceRecord,
): Extract<Claim, { readonly type: "title" }>[] {
  return claimsOfType(record, "title").filter((claim) =>
    claim.rank !== "deprecated"
  );
}

/** Distinct canonical content-language tags of a record (source order). */
export function contentLanguagesOfRecord(
  record: SourceRecord,
): readonly LanguageTag[] {
  const out: LanguageTag[] = [];
  for (const claim of claimsOfType(record, "content-language")) {
    if (!out.includes(claim.language)) out.push(claim.language);
  }
  return out;
}

export function authorClaimsOfRecord(
  record: SourceRecord,
): Extract<Claim, { readonly type: "author" }>[] {
  return claimsOfType(record, "author");
}

export function publicationYearsOfRecord(
  record: SourceRecord,
): readonly number[] {
  return claimsOfType(record, "publication-year").map((claim) => claim.year);
}

/** Distinct content-language evidence across one or more records. */
export function unionContentLanguages(
  records: readonly SourceRecord[],
): readonly LanguageTag[] {
  const out: LanguageTag[] = [];
  for (const record of records) {
    for (const language of contentLanguagesOfRecord(record)) {
      if (!out.includes(language)) out.push(language);
    }
  }
  return out;
}

/** Distinct author names across records in first-seen order. */
export function unionAuthorNames(
  records: readonly SourceRecord[],
): readonly string[] {
  const out: string[] = [];
  for (const record of records) {
    for (const claim of authorClaimsOfRecord(record)) {
      if (!out.includes(claim.name)) out.push(claim.name);
    }
  }
  return out;
}

/** Best available publication year across records (min of all claimed). */
export function earliestPublicationYear(
  records: readonly SourceRecord[],
): number | undefined {
  let year: number | undefined;
  for (const record of records) {
    for (const value of publicationYearsOfRecord(record)) {
      if (year === undefined || value < year) year = value;
    }
  }
  return year;
}
