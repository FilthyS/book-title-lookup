/**
 * Reconciliation pipeline (issue #7): candidate assembly and order, in-scope
 * Edition logic, accepted attestation extraction, and evidence-level
 * assignment. All functions here are pure; they never perform I/O.
 */

import type {
  ExternalReference,
  LanguageTag,
  SourceWarning,
} from "./domain.ts";
import {
  canonicalizeLang,
  matchesLanguageRange,
  normalizeTitleText,
} from "./normalize.ts";
import {
  authorClaimsOfRecord,
  type Claim,
  contentLanguagesOfRecord,
  editionToWorkReferences,
  isExcludedEdition,
  type MatchedAlias,
  openLibraryWorkIdentifier,
  type SourceHit,
  type SourceRecord,
  titleClaims,
  workReferencesOfRecord,
} from "./evidence.ts";
import { canonicalReferences } from "./domain.ts";
import type { BookQuery } from "./module.ts";

// ---------------------------------------------------------------------------
// Candidate assembly (issue #7 section 6)
// ---------------------------------------------------------------------------

/** One assembled candidate before opaque ref minting. */
export interface CandidateItem {
  readonly references: readonly ExternalReference[];
  readonly title: string;
  readonly alternativeTitles: readonly string[];
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly editionCount?: number;
  readonly contentLanguages: readonly LanguageTag[];
  // Ordering evidence (never projected).
  readonly matchedAliases: readonly MatchedAlias[];
  readonly editionRecords: readonly SourceRecord[];
  readonly workRecords: readonly SourceRecord[];
}

interface CandidateAccumulator {
  readonly references: ExternalReference[];
  readonly workRecords: SourceRecord[];
  readonly editionRecords: SourceRecord[];
  readonly matchedAliases: MatchedAlias[];
}

export interface CandidateAssembly {
  readonly items: readonly CandidateItem[];
  readonly warnings: readonly SourceWarning[];
}

function referencesKey(references: readonly ExternalReference[]): string {
  return references
    .map((reference) => `${reference.namespace}:${reference.value}`)
    .sort()
    .join("\u0000");
}

function displayTitleOf(accumulator: CandidateAccumulator): string {
  const ordered = [...accumulator.workRecords, ...accumulator.editionRecords];
  for (const record of ordered) {
    const titles = titleClaims(record);
    if (titles.length > 0) return titles[0].text;
  }
  if (accumulator.matchedAliases.length > 0) {
    return accumulator.matchedAliases[0].text;
  }
  return "";
}

function alternativeTitlesOf(accumulator: CandidateAccumulator): string[] {
  const display = displayTitleOf(accumulator);
  const out: string[] = [];
  const push = (text: string): void => {
    if (text !== display && !out.includes(text)) out.push(text);
  };
  for (
    const record of [...accumulator.workRecords, ...accumulator.editionRecords]
  ) {
    for (const title of titleClaims(record)) push(title.text);
  }
  for (const alias of accumulator.matchedAliases) push(alias.text);
  return out;
}

function toCandidateItem(
  accumulator: CandidateAccumulator,
): CandidateItem {
  const records = [
    ...accumulator.workRecords,
    ...accumulator.editionRecords,
  ];
  const references = canonicalReferences(accumulator.references);
  const editionCount = accumulator.editionRecords.length;
  const languages = new Set<string>();
  for (const record of records) {
    for (const language of contentLanguagesOfRecord(record)) {
      languages.add(language);
    }
  }
  const authors: string[] = [];
  for (const record of records) {
    for (const claim of authorClaimsOfRecord(record)) {
      if (!authors.includes(claim.name)) authors.push(claim.name);
    }
  }
  const years = records
    .flatMap((record) =>
      record.claims
        .filter((
          claim,
        ): claim is Extract<Claim, { readonly type: "publication-year" }> =>
          claim.type === "publication-year"
        )
        .map((claim) => claim.year)
    );
  const publicationYear = years.length === 0 ? undefined : Math.min(...years);
  const contentLanguages = [...languages].sort();
  const item: CandidateItem = {
    references,
    title: displayTitleOf(accumulator),
    alternativeTitles: alternativeTitlesOf(accumulator),
    authors,
    ...(publicationYear !== undefined ? { publicationYear } : {}),
    ...(editionCount > 0 ? { editionCount } : {}),
    contentLanguages,
    matchedAliases: accumulator.matchedAliases,
    editionRecords: accumulator.editionRecords,
    workRecords: accumulator.workRecords,
  };
  return item;
}

/**
 * Build Work Candidates from search hits across all sources (issue #7
 * section 6.2). Candidates merge only under an explicit identity mapping:
 * the same canonical provider Work reference, or a Wikidata P648 claim equal
 * to the Open Library Work key of another candidate. Edition hits with no
 * Work relation produce no candidate and a warning.
 */
export function buildCandidates(
  hits: readonly SourceHit[],
  query: BookQuery,
): CandidateAssembly {
  const accumulators: CandidateAccumulator[] = [];
  const warnings: SourceWarning[] = [];

  const bucketFor = (key: string): CandidateAccumulator => {
    let bucket = accumulators.find((entry) => identityKeyOf(entry) === key);
    if (bucket === undefined) {
      bucket = {
        references: [],
        workRecords: [],
        editionRecords: [],
        matchedAliases: [],
      };
      accumulators.push(bucket);
    }
    return bucket;
  };

  for (const hit of hits) {
    const record = hit.record;
    if (record.kind === "work") {
      const refs = canonicalReferences(identityReferencesOf(record));
      if (refs.length === 0) continue;
      const bucket = bucketFor(referencesKey(refs));
      bucket.references.push(...refs);
      bucket.workRecords.push(record);
      bucket.matchedAliases.push(...hit.matchedAliases);
      continue;
    }
    if (record.kind === "edition") {
      const workRefs = editionToWorkReferences(record);
      if (workRefs.length === 0) {
        warnings.push({
          source: record.source,
          code: "unknown_work",
          references: record.refs,
          details: { reason: "edition names no work" },
        });
        continue;
      }
      const canonical = canonicalReferences(workRefs);
      const bucket = bucketFor(referencesKey(canonical));
      bucket.references.push(...canonical);
      bucket.editionRecords.push(record);
      bucket.matchedAliases.push(...hit.matchedAliases);
      continue;
    }
    // Redirect/other/unknown records do not produce Work Candidates.
  }

  // Merge accumulators whose reference clusters overlap (identity mapping
  // via the same canonical provider reference, including Wikidata P648).
  mergeOverlapping(accumulators);

  const items = accumulators
    .filter((accumulator) => accumulator.references.length > 0)
    .map(toCandidateItem);
  return { items: stableOrderItems(items, query), warnings };
}

function identityKeyOf(accumulator: CandidateAccumulator): string {
  return referencesKey(canonicalReferences(accumulator.references));
}

function mergeOverlapping(accumulators: CandidateAccumulator[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < accumulators.length; i++) {
      for (let j = i + 1; j < accumulators.length; j++) {
        if (sharesReference(accumulators[i], accumulators[j])) {
          accumulators[i].references.push(...accumulators[j].references);
          accumulators[i].workRecords.push(...accumulators[j].workRecords);
          accumulators[i].editionRecords.push(
            ...accumulators[j].editionRecords,
          );
          accumulators[i].matchedAliases.push(
            ...accumulators[j].matchedAliases,
          );
          accumulators.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
}

function sharesReference(
  a: CandidateAccumulator,
  b: CandidateAccumulator,
): boolean {
  const aKeys = new Set(
    a.references.map((ref) => `${ref.namespace}:${ref.value}`),
  );
  return b.references.some((ref) => aKeys.has(`${ref.namespace}:${ref.value}`));
}

function identityReferencesOf(record: SourceRecord): ExternalReference[] {
  const refs = [...workReferencesOfRecord(record)];
  const identity = openLibraryWorkIdentifier(record);
  if (identity !== undefined) refs.push(identity);
  return refs;
}

function normalizePersonName(raw: string): string {
  return normalizeTitleText(raw).toLowerCase();
}

/** Deterministic candidate display order (issue #7 section 6.3). */
export function stableOrderItems(
  items: readonly CandidateItem[],
  query: BookQuery,
): readonly CandidateItem[] {
  const queryAuthor = query.author === undefined
    ? undefined
    : normalizePersonName(query.author);
  return [...items].sort((a, b) => compareCandidateItems(a, b, queryAuthor));
}

function compareCandidateItems(
  a: CandidateItem,
  b: CandidateItem,
  queryAuthor: string | undefined,
): number {
  // 1. number of matched aliases (descending).
  const aliasDelta = b.matchedAliases.length - a.matchedAliases.length;
  if (aliasDelta !== 0) return aliasDelta;
  // 2. presence of an author match against the optional query author.
  const aAuthorMatch = authorMatches(a, queryAuthor);
  const bAuthorMatch = authorMatches(b, queryAuthor);
  if (aAuthorMatch !== bAuthorMatch) return aAuthorMatch ? -1 : 1;
  // 3. number of distinct source namespaces (descending).
  const aNamespaces = new Set(a.references.map((ref) => ref.namespace)).size;
  const bNamespaces = new Set(b.references.map((ref) => ref.namespace)).size;
  if (aNamespaces !== bNamespaces) return bNamespaces - aNamespaces;
  // 4. number of distinct edition records with a known content language.
  const aEditions = countLanguageBearingEditions(a.editionRecords);
  const bEditions = countLanguageBearingEditions(b.editionRecords);
  if (aEditions !== bEditions) return bEditions - aEditions;
  // 5. stable tie-break: ascending canonical references then alias texts.
  const aKey = a.references.map((r) => `${r.namespace}:${r.value}`).join(",") +
    "|" + a.matchedAliases.map((alias) => alias.text).sort().join(",");
  const bKey = b.references.map((r) => `${r.namespace}:${r.value}`).join(",") +
    "|" + b.matchedAliases.map((alias) => alias.text).sort().join(",");
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return 0;
}

function authorMatches(item: CandidateItem, queryAuthor: string | undefined) {
  if (queryAuthor === undefined) return false;
  for (const record of [...item.workRecords, ...item.editionRecords]) {
    for (const claim of authorClaimsOfRecord(record)) {
      if (normalizePersonName(claim.name) === queryAuthor) return true;
      if (claim.reference !== undefined) {
        // Entity reference equality is checked when the query carries a ref;
        // the CLI passes raw text, so name equality is the comparison used.
      }
    }
  }
  return false;
}

function countLanguageBearingEditions(
  records: readonly SourceRecord[],
): number {
  return records.filter((record) => contentLanguagesOfRecord(record).length > 0)
    .length;
}

// ---------------------------------------------------------------------------
// In-scope Edition logic and attestation extraction (issue #7 sections 8-10)
// ---------------------------------------------------------------------------

/** The resolved Work context used by the title pipeline. */
export interface ResolvedWorkContext {
  /** Canonical Work references after redirect/identity mapping. */
  readonly canonicalRefs: readonly ExternalReference[];
  /** Work-class source records of the resolved Work. */
  readonly workRecords: readonly SourceRecord[];
}

/** Classification of one expanded Edition record. */
export type EditionStatus =
  | { readonly kind: "qualifying" }
  | { readonly kind: "related"; readonly reason: "relationship_divergence" }
  | { readonly kind: "excluded"; readonly reason: string }
  | { readonly kind: "skipped"; readonly reason: string };

export interface EditionAssessment {
  readonly record: SourceRecord;
  readonly status: EditionStatus;
}

export interface ExpansionAssessment {
  readonly editions: readonly EditionAssessment[];
  readonly warnings: readonly SourceWarning[];
}

/** Warnings produced while reading a record (rank conflicts etc.). */
export function recordWarnings(record: SourceRecord): readonly SourceWarning[] {
  const warnings: SourceWarning[] = [];
  const namespaces = new Map<
    string,
    { deprecated: boolean; nonDeprecated: boolean }
  >();
  for (const claim of record.claims) {
    if (claim.type !== "identifier") continue;
    const entry = namespaces.get(claim.namespace) ?? {
      deprecated: false,
      nonDeprecated: false,
    };
    if (claim.rank === "deprecated") entry.deprecated = true;
    else entry.nonDeprecated = true;
    namespaces.set(claim.namespace, entry);
  }
  for (const [namespace, entry] of namespaces) {
    if (entry.deprecated && entry.nonDeprecated) {
      warnings.push({
        source: record.source,
        code: "rank_conflict",
        references: record.refs,
        details: { namespace },
      });
    }
  }
  return warnings;
}

function sameReference(a: ExternalReference, b: ExternalReference): boolean {
  return a.namespace === b.namespace && a.value === b.value;
}

function hasDirectRelation(record: SourceRecord, ctx: ResolvedWorkContext) {
  const linked = editionToWorkReferences(record);
  return linked.some((reference) =>
    ctx.canonicalRefs.some((canonical) => sameReference(canonical, reference))
  );
}

/**
 * Assess expanded Edition records for a resolved Work (issue #7 section 8).
 * Records whose publication type is explicitly excluded never attest and
 * produce an excluded-record warning.
 */
export function assessExpandedEditions(
  records: readonly SourceRecord[],
  ctx: ResolvedWorkContext,
): ExpansionAssessment {
  const editions: EditionAssessment[] = [];
  const warnings: SourceWarning[] = [];
  for (const record of records) {
    warnings.push(...recordWarnings(record));
    if (record.kind !== "edition") {
      if (record.kind === "work") {
        // A Work returned during edition expansion is a relationship
        // divergence note rather than an attestation carrier.
        warnings.push({
          source: record.source,
          code: "relationship_divergence",
          references: record.refs,
        });
      }
      editions.push({
        record,
        status: { kind: "skipped", reason: "not_edition" },
      });
      continue;
    }
    if (isExcludedEdition(record)) {
      warnings.push({
        source: record.source,
        code: "excluded_record",
        references: record.refs,
        details: { reason: "excluded publication type" },
      });
      editions.push({
        record,
        status: { kind: "excluded", reason: "edition-type" },
      });
      continue;
    }
    const direct = hasDirectRelation(record, ctx);
    if (direct) {
      editions.push({ record, status: { kind: "qualifying" } });
    } else {
      const linked = editionToWorkReferences(record);
      if (linked.length === 0) {
        editions.push({
          record,
          status: { kind: "related", reason: "relationship_divergence" },
        });
        warnings.push({
          source: record.source,
          code: "unknown_work",
          references: record.refs,
        });
      } else {
        editions.push({
          record,
          status: { kind: "related", reason: "relationship_divergence" },
        });
        warnings.push({
          source: record.source,
          code: "detached_work",
          references: record.refs,
          details: {
            otherWork: linked.map((ref) => `${ref.namespace}:${ref.value}`)
              .join(","),
          },
        });
      }
    }
  }
  return { editions, warnings };
}

/** Title Language for an edition title claim (issue #7 section 12.2). */
export function titleLanguageForEdition(
  record: SourceRecord,
  claim: Extract<Claim, { readonly type: "title" }>,
): string {
  if (claim.language !== undefined) {
    const canonical = canonicalizeLang(claim.language);
    if (canonical !== "und") return canonical;
  }
  // An explicit title-level tag may arrive as a title-language claim tied to
  // the same statement.
  const tied = record.claims.find(
    (entry) =>
      entry.type === "title-language" &&
      claim.statementId !== undefined &&
      entry.statementId === claim.statementId,
  );
  if (tied !== undefined && tied.type === "title-language") {
    const canonical = canonicalizeLang(tied.language);
    if (canonical !== "und") return canonical;
  }
  const contentLanguages = contentLanguagesOfRecord(record);
  if (contentLanguages.length === 1) return contentLanguages[0];
  return "und";
}

function findSubtitleFor(
  record: SourceRecord,
  claim: Extract<Claim, { readonly type: "title" }>,
): string | null {
  const candidates = record.claims.filter(
    (entry): entry is Extract<Claim, { readonly type: "subtitle" }> =>
      entry.type === "subtitle",
  );
  const titleCount = titleClaims(record).length;
  for (const subtitle of candidates) {
    if (
      subtitle.statementId !== undefined &&
      claim.statementId !== undefined &&
      subtitle.statementId === claim.statementId
    ) {
      return subtitle.text;
    }
  }
  if (titleCount === 1 && candidates.length === 1) return candidates[0].text;
  return null;
}

export interface AttestationSource {
  readonly attestation: {
    readonly text: string;
    readonly subtitle: string | null;
    readonly language: string;
    readonly statementId?: string;
    readonly rank?: "preferred" | "normal";
  };
  readonly record: SourceRecord;
}

/**
 * Extract accepted edition title attestations (issue #7 section 9 A1/A2).
 * Labels, aliases, work_titles, and other clues are never attestations.
 * Work-level title statements on the resolved Work are extracted separately.
 */
export function extractEditionAttestations(
  assessment: EditionAssessment,
): readonly AttestationSource[] {
  if (
    assessment.status.kind !== "qualifying" &&
    assessment.status.kind !== "related"
  ) {
    return [];
  }
  const record = assessment.record;
  const out: AttestationSource[] = [];
  for (const claim of titleClaims(record)) {
    const language = titleLanguageForEdition(record, claim);
    const subtitle = findSubtitleFor(record, claim);
    const source: AttestationSource = {
      attestation: {
        text: claim.text,
        subtitle,
        language,
        ...(claim.statementId !== undefined
          ? { statementId: claim.statementId }
          : {}),
        ...(claim.rank === "preferred" || claim.rank === "normal"
          ? { rank: claim.rank }
          : {}),
      },
      record,
    };
    out.push(source);
  }
  return out;
}

/** Work-level original-title evidence from a resolved Work record (A4). */
export function extractWorkAttestations(
  workRecord: SourceRecord,
): readonly AttestationSource[] {
  const out: AttestationSource[] = [];
  for (const claim of titleClaims(workRecord)) {
    let language = claim.language !== undefined
      ? canonicalizeLang(claim.language)
      : "und";
    if (language === "und") {
      const contentLanguages = contentLanguagesOfRecord(workRecord);
      if (contentLanguages.length === 1) language = contentLanguages[0];
    }
    out.push({
      attestation: {
        text: claim.text,
        subtitle: null,
        language,
        ...(claim.statementId !== undefined
          ? { statementId: claim.statementId }
          : {}),
        ...(claim.rank === "preferred" || claim.rank === "normal"
          ? { rank: claim.rank }
          : {}),
      },
      record: workRecord,
    });
  }
  return out;
}

/** Independent clue-fact families that connect an Edition to a Work. */
export interface ClueFacts {
  title: boolean;
  originalTitle: boolean;
  author: boolean;
  originLanguage: boolean;
  identifier: boolean;
}

/**
 * Count independent consistent clue facts between a candidate-related Edition
 * and the resolved Work (issue #7 section 10.2). At most one fact per family
 * per Edition counts.
 */
export function clueFactsForEdition(
  record: SourceRecord,
  ctx: ResolvedWorkContext,
  attestedTitles: readonly string[],
  qualifyingEditionRefs: readonly ExternalReference[],
): ClueFacts {
  const facts: ClueFacts = {
    title: false,
    originalTitle: false,
    author: false,
    originLanguage: false,
    identifier: false,
  };
  const workTitles = ctx.workRecords.flatMap((work) =>
    titleClaims(work).map((claim) => claim.text)
  );

  // title family
  for (const claim of titleClaims(record)) {
    if (
      attestedTitles.some((text) =>
        normalizeTitleText(text) === normalizeTitleText(claim.text)
      )
    ) {
      facts.title = true;
      break;
    }
  }

  // original-title family
  for (const claim of record.claims) {
    if (claim.type !== "original-title") continue;
    if (
      workTitles.some((text) =>
        normalizeTitleText(text) === normalizeTitleText(claim.text)
      )
    ) {
      facts.originalTitle = true;
      break;
    }
  }

  // author family
  const workAuthors = ctx.workRecords.flatMap((work) =>
    authorClaimsOfRecord(work)
  );
  for (const claim of authorClaimsOfRecord(record)) {
    const matchedRef = workAuthors.some(
      (entry) =>
        entry.reference !== undefined &&
        claim.reference !== undefined &&
        entry.reference.namespace === claim.reference.namespace &&
        entry.reference.value === claim.reference.value,
    );
    const matchedName = workAuthors.some(
      (entry) =>
        normalizePersonName(entry.name) === normalizePersonName(claim.name),
    );
    if (matchedRef || matchedName) {
      facts.author = true;
      break;
    }
  }

  // origin-language family
  const originalLanguages = new Set<string>();
  for (const work of ctx.workRecords) {
    for (const language of contentLanguagesOfRecord(work)) {
      originalLanguages.add(language);
    }
    for (const claim of titleClaims(work)) {
      if (claim.language !== undefined) {
        originalLanguages.add(canonicalizeLang(claim.language));
      }
    }
  }
  for (const claim of record.claims) {
    if (claim.type !== "translated-from") continue;
    if (originalLanguages.has(canonicalizeLang(claim.language))) {
      facts.originLanguage = true;
      break;
    }
  }

  // identifier family
  const qualifyingIds = new Set<string>();
  for (const editionRef of qualifyingEditionRefs) {
    qualifyingIds.add(`${editionRef.namespace}:${editionRef.value}`);
  }
  for (const claim of record.claims) {
    if (claim.type !== "identifier") continue;
    const canonical = `${claim.namespace}:${claim.value}`;
    if (claim.namespace === "openlibrary:work") continue;
    if (qualifyingIds.has(canonical)) {
      facts.identifier = true;
      break;
    }
  }

  return facts;
}

export function countClueFacts(facts: ClueFacts): number {
  let count = 0;
  for (const value of Object.values(facts)) if (value) count++;
  return count;
}

/** Language used by matchesRange (issue #7 15.1). */
export { matchesLanguageRange };
