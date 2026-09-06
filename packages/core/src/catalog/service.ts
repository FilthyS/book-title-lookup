/**
 * The catalog module implementation (issue #6 seam) that sits at the top of
 * the Core lookup service. `CatalogService` owns the opaque-ref lifecycle,
 * runs the deterministic reconciliation pipeline of issue #7, and composes
 * the internal EvidenceSource port (which Providers implements in a later
 * slice). It never touches the terminal, fetch, environment, files, or
 * Providers code.
 */

import type {
  AttestationRole,
  BookQuery,
  BookTitleCatalog,
  CandidateRef,
  EvidenceLevel,
  ExternalReference,
  RequestOptions,
  ResolvedWork,
  ResolvedWorkRef,
  ResolveOutcome,
  ResolveTarget,
  SearchOutcome,
  TitleAttestation,
  TitleLookupOutcome,
  TitleQuery,
  WorkCandidate,
} from "../module.ts";
import type { EvidenceSource } from "../internal-port.ts";
import { canonicalReferenceValue } from "../normalize.ts";
import { canonicalReferences } from "../domain.ts";
import type { SourceFailure, SourceWarning } from "../domain.ts";
import type { Claim, SourceRecord } from "../evidence.ts";
import {
  authorClaimsOfRecord,
  claimsOfType,
  contentLanguagesOfRecord,
  editionToWorkReferences,
  hasClaimOfType,
  openLibraryWorkIdentifier,
  titleClaims,
  workReferencesOfRecord,
} from "../evidence.ts";
import {
  assessExpandedEditions,
  type AttestationSource,
  buildCandidates,
  type CandidateItem,
  clueFactsForEdition,
  countClueFacts,
  extractEditionAttestations,
  extractWorkAttestations,
  stableOrderItems,
} from "../reconcile.ts";
import { groupAttestations, type LeveledAttestation } from "../group.ts";
import { finalizeGroups } from "../recommend.ts";
import { normalizeTitleText } from "../normalize.ts";

const SOURCE_ORDER: readonly ["openlibrary", "wikidata"] = [
  "openlibrary",
  "wikidata",
];

/** Ref token prefixes keep refs unambiguous and debuggable while remaining
 *  opaque to callers. */
let tokenCounter = 0;
function nextToken(prefix: "c" | "w"): string {
  tokenCounter += 1;
  return `${prefix}-${tokenCounter}`;
}

interface RegisteredCandidate {
  readonly item: CandidateItem;
}

interface RegisteredWork {
  readonly work: ResolvedWork;
  readonly records: readonly SourceRecord[];
}

export class CatalogService implements BookTitleCatalog {
  readonly #sources: readonly EvidenceSource[];
  #candidates = new Map<string, RegisteredCandidate>();
  #works = new Map<string, RegisteredWork>();

  constructor(sources: readonly EvidenceSource[]) {
    // A vertical slice may compose any subset of the known sources (ticket
    // #17 composes Open Library alone); order is canonical OL-then-WD when
    // both are present so reconciliation stays deterministic.
    this.#sources = SOURCE_ORDER.flatMap((source) => {
      const found = sources.find((entry) => entry.source === source);
      return found === undefined ? [] : [found];
    });
    if (this.#sources.length === 0) {
      throw new TypeError("catalog requires at least one evidence source");
    }
  }

  async search(
    query: BookQuery,
    options: RequestOptions = {},
  ): Promise<SearchOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    validateBookQuery(query);

    // A new search invalidates the previous search's candidates.
    this.#candidates.clear();

    const allHits: {
      readonly record: SourceRecord;
      readonly matchedAliases: readonly {
        readonly text: string;
        readonly language?: string;
      }[];
    }[] = [];
    const failures: SourceFailure[] = [];

    for (const source of this.#sources) {
      const outcome = await source.search(query, options);
      if (outcome.status === "cancelled") return { status: "cancelled" };
      if (outcome.status === "failed") {
        failures.push(outcome.failure);
        continue;
      }
      if (outcome.status === "ok") {
        allHits.push(...outcome.hits);
      }
    }

    const assembled = buildCandidates(
      allHits.map((hit) => ({
        record: hit.record,
        matchedAliases: hit.matchedAliases.map((alias) => ({
          text: alias.text,
          ...(alias.language !== undefined ? { language: alias.language } : {}),
        })),
      })),
      query,
    );

    if (assembled.items.length === 0) {
      const warnings = failuresToWarnings(failures);
      if (failures.length > 0 && allHits.length === 0) {
        return { status: "failed", failures: sortedFailures(failures) };
      }
      return { status: "not_found", warnings: sortWarnings(warnings) };
    }

    const candidates: WorkCandidate[] = [];
    for (const item of assembled.items) {
      candidates.push(this.#registerCandidate(item));
    }
    const warnings = sortWarnings([
      ...assembled.warnings,
      ...failuresToWarnings(failures),
    ]);
    return { status: "found", candidates, warnings };
  }

  async resolve(
    target: ResolveTarget,
    options: RequestOptions = {},
  ): Promise<ResolveOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    if (target.kind === "candidate") {
      return await this.#resolveCandidate(target.ref);
    }
    return await this.#resolveExternalReference(target.reference, options);
  }

  async findTitles(
    work: ResolvedWorkRef,
    query: TitleQuery,
    options: RequestOptions = {},
  ): Promise<TitleLookupOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const registered = this.#works.get(work);
    if (registered === undefined) {
      throw new RangeError("unknown resolved-work ref");
    }
    return await this.#lookupTitles(registered, query.targetLanguages, options);
  }

  // -------------------------------------------------------------------------
  // Candidate resolution
  // -------------------------------------------------------------------------

  async #resolveCandidate(ref: CandidateRef): Promise<ResolveOutcome> {
    const registered = this.#candidates.get(ref);
    if (registered === undefined) {
      // A stale or fabricated candidate ref is an invariant violation.
      throw new RangeError("unknown candidate ref");
    }
    const resolved = await this.#resolveWorkFromRecords(
      registered.item.references,
      this.#recordsOfItem(registered.item),
    );
    if (resolved.status === "failed") return resolved;
    if (resolved.status === "cancelled") return resolved;
    if (resolved.status === "not_found") return resolved;
    const work = this.#registerWork(resolved.work, resolved.records);
    return {
      status: "resolved",
      work,
      confirmation: "candidate_confirmed",
      warnings: resolved.warnings,
    };
  }

  async #resolveExternalReference(
    reference: ExternalReference,
    options: RequestOptions,
  ): Promise<ResolveOutcome> {
    const fetched: SourceRecord[] = [];
    const failures: SourceFailure[] = [];
    let sawOk = false;
    for (const source of this.#sources) {
      const outcome = await source.fetch(reference, options);
      if (outcome.status === "cancelled") return { status: "cancelled" };
      if (outcome.status === "failed") {
        failures.push(outcome.failure);
        continue;
      }
      if (outcome.status === "ok") {
        sawOk = true;
        fetched.push(...outcome.records);
      }
    }

    if (fetched.length === 0) {
      const allFailed = failures.length > 0 && !sawOk;
      if (allFailed) {
        return { status: "failed", failures: sortedFailures(failures) };
      }
      return { status: "not_found", warnings: failuresToWarnings(failures) };
    }

    const warnings = failuresToWarnings(failures);

    // Group Work references into identity clusters (issue #7 6.2): the same
    // canonical provider reference, or a Wikidata P648 claim equal to the
    // Open Library Work key, belongs to one logical Work.
    const clusters = workClusters(fetched);
    if (clusters.length === 0) {
      return {
        status: "not_found",
        warnings: [
          ...warnings,
          {
            source: sourceOfRecords(fetched) ?? "openlibrary",
            code: "unknown_work",
            references: fetched.flatMap((record) => record.refs),
          },
        ],
      };
    }

    // Duplicate identifier: distinct edition objects that carry the same
    // requested identifier, or records that name more than one Work cluster.
    const distinctEditions = distinctEditionKeys(fetched);
    const duplicateByIdentifier =
      reference.namespace === "isbn" && distinctEditions.length > 1;
    if (duplicateByIdentifier || clusters.length > 1) {
      const items = stableOrderItems(
        candidateItemsFromRecords(fetched).items.filter(
          (item) => item.references.length > 0,
        ),
        { title: "" },
      );
      const candidates = items.map((item) => this.#registerCandidate(item));
      const duplicateWarning: SourceWarning = {
        source: sourceOfRecords(fetched) ?? "openlibrary",
        code: "duplicate_identifier",
        references: [reference],
        ...(distinctEditions.length > 1
          ? { details: { editions: distinctEditions.join(",") } }
          : {}),
      };
      return {
        status: "needs_choice",
        reason: "ambiguous_identifier",
        candidates,
        warnings: sortWarnings([...warnings, duplicateWarning]),
      };
    }

    const targetRefs = clusters[0];
    // Fetch the Work record(s) for a rich resolved summary when the fetch
    // did not already return them.
    const withWorkRecords = await this.#ensureWorkRecords(
      fetched,
      targetRefs,
      options,
    );
    if (withWorkRecords.status === "cancelled") return { status: "cancelled" };
    if (withWorkRecords.status === "failed") {
      return { status: "failed", failures: withWorkRecords.failures };
    }

    const resolved = await this.#resolveWorkFromRecords(
      targetRefs,
      withWorkRecords.records,
    );
    if (resolved.status === "failed") return resolved;
    if (resolved.status === "cancelled") return resolved;
    if (resolved.status === "not_found") return resolved;

    // Indirect resolution check (issue #7 section 7.3).
    const indirect = await this.#findIndirectCandidates(
      resolved.work.references,
      options,
    );
    if (indirect.status === "cancelled") return { status: "cancelled" };
    if (indirect.status === "failed") {
      return { status: "failed", failures: indirect.failures };
    }
    if (indirect.status === "indirect") {
      const originalItem = itemFromRecords(resolved.records, targetRefs);
      const combined = stableOrderItems(
        [
          ...(originalItem !== undefined ? [originalItem] : []),
          ...indirect.items,
        ],
        { title: "" },
      );
      const candidates = combined.map((item) => this.#registerCandidate(item));
      return {
        status: "needs_choice",
        reason: "indirect_evidence",
        candidates,
        warnings: sortWarnings([...warnings, ...indirect.warnings]),
      };
    }

    const work = this.#registerWork(resolved.work, resolved.records);
    return {
      status: "resolved",
      work,
      confirmation: "strong_reference",
      warnings,
    };
  }

  /**
   * Run the indirect clue set for a Work that has exactly one qualifying
   * Edition carrying indirect clues. Returns "none" when no second search is
   * warranted and "indirect" with Probable candidates when a stronger
   * candidate was found.
   */
  async #findIndirectCandidates(
    canonicalRefs: readonly ExternalReference[],
    options: RequestOptions,
  ): Promise<
    | { readonly status: "none" }
    | { readonly status: "cancelled" }
    | {
        readonly status: "failed";
        readonly failures: readonly SourceFailure[];
      }
    | {
        readonly status: "indirect";
        readonly items: readonly CandidateItem[];
        readonly warnings: readonly SourceWarning[];
      }
  > {
    const editions: SourceRecord[] = [];
    const failures: SourceFailure[] = [];
    let sawFailure = false;
    for (const canonicalRef of uniqueReferencesByNamespace(canonicalRefs)) {
      for (const source of this.#sources) {
        const outcome = await source.expandEditions(canonicalRef, options);
        if (outcome.status === "cancelled") return { status: "cancelled" };
        if (outcome.status === "failed") {
          failures.push(outcome.failure);
          sawFailure = true;
          continue;
        }
        editions.push(...outcome.records);
      }
    }
    if (editions.length === 0 && sawFailure) {
      return { status: "failed", failures: sortedFailures(failures) };
    }
    const qualifying = editions.filter((record) => {
      if (record.kind !== "edition") return false;
      return editionToWorkReferences(record).some((linked) =>
        canonicalRefs.some(
          (canonical) =>
            canonical.namespace === linked.namespace &&
            canonical.value === linked.value,
        ),
      );
    });
    if (qualifying.length !== 1) return { status: "none" };
    const edition = qualifying[0];
    const clueTexts = edition.claims
      .filter((claim) => claim.type === "original-title")
      .map(
        (claim) =>
          (claim as Extract<Claim, { readonly type: "original-title" }>).text,
      );
    const hasTranslatedFrom = hasClaimOfType(edition, "translated-from");
    const hasAuthor =
      authorClaimsOfRecord(edition).length > 0 ||
      hasClaimOfType(edition, "translator");
    if (clueTexts.length === 0 || !(hasTranslatedFrom || hasAuthor)) {
      return { status: "none" };
    }
    const authorNames = authorClaimsOfRecord(edition).map(
      (claim) => claim.name,
    );

    const items: CandidateItem[] = [];
    const warnings: SourceWarning[] = [];
    for (const clue of dedupeStrings(clueTexts)) {
      const query: BookQuery = {
        title: clue,
        ...(authorNames.length > 0 ? { author: authorNames[0] } : {}),
      };
      const hits: {
        record: SourceRecord;
        matchedAliases: readonly {
          readonly text: string;
          readonly language?: string;
        }[];
      }[] = [];
      const failuresHere: SourceFailure[] = [];
      for (const source of this.#sources) {
        const outcome = await source.search(query, options);
        if (outcome.status === "cancelled") return { status: "cancelled" };
        if (outcome.status === "failed") failuresHere.push(outcome.failure);
        if (outcome.status === "ok") hits.push(...outcome.hits);
      }
      if (failuresHere.length > 0) {
        warnings.push(...failuresToWarnings(failuresHere));
      }
      const assembled = buildCandidates(hits, query);
      warnings.push(...assembled.warnings);
      for (const candidate of assembled.items) {
        // Keep candidates that are not the already-resolved Work.
        const isSelf = candidate.references.some((candidateRef) =>
          canonicalRefs.some(
            (canonical) =>
              canonical.namespace === candidateRef.namespace &&
              canonical.value === candidateRef.value,
          ),
        );
        if (
          !isSelf &&
          !items.some((existing) =>
            candidate.references.every((candidateRef) =>
              existing.references.some(
                (existingRef) =>
                  existingRef.namespace === candidateRef.namespace &&
                  existingRef.value === candidateRef.value,
              ),
            ),
          )
        ) {
          items.push(candidate);
        }
      }
    }
    if (items.length === 0) return { status: "none" };
    return { status: "indirect", items, warnings: sortWarnings(warnings) };
  }

  // -------------------------------------------------------------------------
  // Title lookup
  // -------------------------------------------------------------------------

  async #lookupTitles(
    registered: RegisteredWork,
    targetLanguages: readonly string[],
    options: RequestOptions,
  ): Promise<TitleLookupOutcome> {
    const records: SourceRecord[] = [...registered.records];
    const expansionWarnings: SourceWarning[] = [];
    const failures: SourceFailure[] = [];
    let sawFailure = false;
    const seen = new Set<string>();

    for (const reference of uniqueReferencesByNamespace(
      registered.work.references,
    )) {
      for (const source of this.#sources) {
        const outcome = await source.expandEditions(reference, options);
        if (outcome.status === "cancelled") return { status: "cancelled" };
        if (outcome.status === "failed") {
          failures.push(outcome.failure);
          sawFailure = true;
          continue;
        }
        expansionWarnings.push(...outcome.warnings);
        for (const record of outcome.records) {
          const key = recordKey(record);
          if (seen.has(key)) continue;
          seen.add(key);
          records.push(record);
        }
      }
    }
    if (
      records.filter((record) => record.kind === "edition").length === 0 &&
      sawFailure
    ) {
      return { status: "failed", failures: sortedFailures(failures) };
    }

    const canonicalRefs = registered.work.references;
    const workRecords = records.filter(
      (record) =>
        record.kind === "work" &&
        workReferencesOfRecord(record).some((reference) =>
          canonicalRefs.some(
            (canonical) =>
              canonical.namespace === reference.namespace &&
              canonical.value === reference.value,
          ),
        ),
    );

    const ctx = { canonicalRefs, workRecords };
    const assessment = assessExpandedEditions(
      records.filter((record) => record.kind === "edition"),
      ctx,
    );
    const warnings = sortWarnings([
      ...expansionWarnings,
      ...assessment.warnings,
      ...failuresToWarnings(failures),
    ]);

    const qualifyingRefs = assessment.editions
      .filter((entry) => entry.status.kind === "qualifying")
      .map((entry) => entry.record)
      .flatMap((record) => record.refs);

    const attestedTitles = assessment.editions
      .filter((entry) => entry.status.kind === "qualifying")
      .flatMap((entry) => titleClaims(entry.record).map((claim) => claim.text));

    const members: LeveledAttestation[] = [];
    for (const entry of assessment.editions) {
      const extracted = extractEditionAttestations(entry);
      for (const source of extracted) {
        const editionStatus = entry.status;
        const language = source.attestation.language;
        let level: EvidenceLevel = "ambiguous";
        if (language !== "und") {
          if (editionStatus.kind === "qualifying") {
            level = "verified";
          } else if (editionStatus.kind === "related") {
            const facts = clueFactsForEdition(
              entry.record,
              ctx,
              attestedTitles,
              qualifyingRefs,
            );
            level = countClueFacts(facts) >= 2 ? "probable" : "ambiguous";
          }
        }
        members.push({
          level,
          attestation: toModuleAttestation(source, "edition_title"),
        });
      }
    }
    for (const workRecord of workRecords) {
      for (const source of extractWorkAttestations(workRecord)) {
        members.push({
          level:
            source.attestation.language === "und" ? "ambiguous" : "probable",
          attestation: toModuleAttestation(source, "work_original_title"),
        });
      }
    }

    const rawGroups = groupAttestations(members);
    const originalLanguage = originalLanguageOf(workRecords);
    const finalized = finalizeGroups(
      rawGroups,
      targetLanguages,
      originalLanguage,
    );
    if (finalized.status === "found") {
      return { status: "found", groups: finalized.groups, warnings };
    }
    return {
      status: "no_attested_titles",
      groups: finalized.groups,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  #registerCandidate(item: CandidateItem): WorkCandidate {
    const ref = nextToken("c") as unknown as CandidateRef;
    this.#candidates.set(ref, { item });
    return candidateToModule(item, ref);
  }

  #recordsOfItem(item: CandidateItem): readonly SourceRecord[] {
    return [...item.workRecords, ...item.editionRecords];
  }

  async #ensureWorkRecords(
    existing: readonly SourceRecord[],
    targetRefs: readonly ExternalReference[],
    options: RequestOptions,
  ): Promise<
    | { readonly status: "ok"; readonly records: readonly SourceRecord[] }
    | { readonly status: "cancelled" }
    | {
        readonly status: "failed";
        readonly failures: readonly SourceFailure[];
      }
  > {
    const hasWork = existing.some(
      (record) =>
        record.kind === "work" &&
        workReferencesOfRecord(record).some((reference) =>
          targetRefs.some(
            (target) =>
              target.namespace === reference.namespace &&
              target.value === reference.value,
          ),
        ),
    );
    const records = [...existing];
    if (!hasWork) {
      const failures: SourceFailure[] = [];
      for (const target of targetRefs) {
        for (const source of this.#sources) {
          const outcome = await source.fetch(target, options);
          if (outcome.status === "cancelled") return { status: "cancelled" };
          if (outcome.status === "failed") failures.push(outcome.failure);
          if (outcome.status === "ok") records.push(...outcome.records);
        }
      }
      if (
        failures.length > 0 &&
        !records.some(
          (record) =>
            record.kind === "work" &&
            workReferencesOfRecord(record).some((reference) =>
              targetRefs.some(
                (target) =>
                  target.namespace === reference.namespace &&
                  target.value === reference.value,
              ),
            ),
        )
      ) {
        return { status: "failed", failures: sortedFailures(failures) };
      }
    }
    return { status: "ok", records };
  }

  #resolveWorkFromRecords(
    distinctWorks: readonly ExternalReference[],
    records: readonly SourceRecord[],
  ):
    | {
        readonly status: "ok";
        readonly work: ResolvedWorkCore;
        readonly records: readonly SourceRecord[];
        readonly warnings: readonly SourceWarning[];
      }
    | {
        readonly status: "not_found";
        readonly warnings: readonly SourceWarning[];
      }
    | { readonly status: "failed"; readonly failures: readonly SourceFailure[] }
    | { readonly status: "cancelled" } {
    if (distinctWorks.length === 0) {
      return { status: "not_found", warnings: [] };
    }
    const workRecords = records.filter(
      (record) =>
        record.kind === "work" &&
        workReferencesOfRecord(record).some((reference) =>
          distinctWorks.some(
            (workRef) =>
              workRef.namespace === reference.namespace &&
              workRef.value === reference.value,
          ),
        ),
    );
    if (workRecords.length === 0) {
      return { status: "not_found", warnings: [] };
    }
    const title = firstTitle(workRecords);
    if (title === undefined) return { status: "not_found", warnings: [] };
    const core: ResolvedWorkCore = summarizeResolved(
      workRecords,
      distinctWorks,
      title,
    );
    return { status: "ok", work: core, records, warnings: [] };
  }

  #registerWork(
    core: ResolvedWorkCore,
    records: readonly SourceRecord[],
  ): ResolvedWork {
    const ref = nextToken("w") as unknown as ResolvedWorkRef;
    const work: ResolvedWork = { ref, ...core };
    this.#works.set(ref, { work, records });
    return work;
  }
}

type ResolvedWorkCore = Omit<ResolvedWork, "ref">;

function summarizeResolved(
  workRecords: readonly SourceRecord[],
  references: readonly ExternalReference[],
  title: string,
): ResolvedWorkCore {
  const contentLanguages: string[] = [];
  const authors: string[] = [];
  for (const record of workRecords) {
    for (const language of contentLanguagesOfRecord(record)) {
      if (!contentLanguages.includes(language)) contentLanguages.push(language);
    }
    for (const claim of authorClaimsOfRecord(record)) {
      if (!authors.includes(claim.name)) authors.push(claim.name);
    }
  }
  const years = workRecords.flatMap((record) =>
    claimsOfType(record, "publication-year").map((claim) => claim.year),
  );
  const firstPublicationYear =
    years.length === 0 ? undefined : Math.min(...years);
  return {
    title,
    authors,
    ...(firstPublicationYear !== undefined ? { firstPublicationYear } : {}),
    contentLanguages: contentLanguages.sort(),
    references: canonicalReferences(references),
  };
}

function firstTitle(records: readonly SourceRecord[]): string | undefined {
  for (const record of records) {
    const titles = titleClaims(record);
    if (titles.length > 0) return titles[0].text;
  }
  return undefined;
}

function originalLanguageOf(
  workRecords: readonly SourceRecord[],
): string | undefined {
  const languages = new Set<string>();
  for (const record of workRecords) {
    for (const language of contentLanguagesOfRecord(record)) {
      languages.add(language);
    }
  }
  return languages.size === 1 ? [...languages][0] : undefined;
}

function recordKey(record: SourceRecord): string {
  if (record.refs.length > 0) {
    return (
      record.source +
      "\u0000" +
      record.refs
        .map((ref) => `${ref.namespace}:${ref.value}`)
        .sort()
        .join(",")
    );
  }
  return record.source + "\u0000" + record.sourceRecordUrl;
}

/**
 * Identity clusters of Work references present in the fetched records: each
 * cluster joins the references of Work-class records through the same
 * canonical provider reference (including Wikidata P648 identity mapping)
 * and the Work references named by Edition-to-Work relations.
 */
function workClusters(
  records: readonly SourceRecord[],
): readonly (readonly ExternalReference[])[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const keyOf = (reference: ExternalReference): string =>
    `${reference.namespace}:${reference.value}`;
  const refsOfWorkRecord = (record: SourceRecord): ExternalReference[] => [
    ...workReferencesOfRecord(record),
    ...(openLibraryWorkIdentifier(record) !== undefined
      ? [openLibraryWorkIdentifier(record) as ExternalReference]
      : []),
  ];

  for (const record of records) {
    if (record.kind === "work") {
      const refs = refsOfWorkRecord(record);
      for (let i = 1; i < refs.length; i++) {
        union(keyOf(refs[0]), keyOf(refs[i]));
      }
    } else if (record.kind === "edition") {
      for (const workRef of editionToWorkReferences(record)) {
        if (!parent.has(keyOf(workRef))) {
          parent.set(keyOf(workRef), keyOf(workRef));
        }
      }
    }
  }

  const clusters = new Map<string, ExternalReference[]>();
  for (const record of records) {
    const refs =
      record.kind === "work"
        ? refsOfWorkRecord(record)
        : editionToWorkReferences(record);
    for (const reference of refs) {
      const key = keyOf(reference);
      const root = find(key);
      const cluster = clusters.get(root) ?? [];
      if (!cluster.some((entry) => keyOf(entry) === keyOf(reference))) {
        cluster.push(reference);
      }
      clusters.set(root, cluster);
    }
  }
  return [...clusters.values()]
    .filter((cluster) => cluster.length > 0)
    .map((cluster) => canonicalReferences(cluster));
}

function sourceOfRecords(
  records: readonly SourceRecord[],
): "openlibrary" | "wikidata" | undefined {
  for (const record of records) {
    if (record.source === "openlibrary") return "openlibrary";
  }
  return records.find((record) => record.source === "wikidata")?.source;
}

function uniqueReferencesByNamespace(
  references: readonly ExternalReference[],
): readonly ExternalReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.namespace)) return false;
    seen.add(reference.namespace);
    return true;
  });
}

/** A candidate item built from the Work cluster of a resolved target. */
function itemFromRecords(
  records: readonly SourceRecord[],
  preferredRefs: readonly ExternalReference[],
): CandidateItem | undefined {
  const items = candidateItemsFromRecords(records).items;
  if (items.length === 0) return undefined;
  const match = items.find((item) =>
    item.references.some((reference) =>
      preferredRefs.some(
        (preferred) =>
          preferred.namespace === reference.namespace &&
          preferred.value === reference.value,
      ),
    ),
  );
  return match ?? items[0];
}

function distinctEditionKeys(records: readonly SourceRecord[]): string[] {
  const editions = new Set<string>();
  for (const record of records) {
    if (record.kind !== "edition") continue;
    const editionRef = record.refs.find(
      (ref) =>
        ref.namespace === "openlibrary:edition" ||
        (ref.namespace === "wikidata:item" && record.kind === "edition"),
    );
    if (editionRef !== undefined) {
      editions.add(`${editionRef.namespace}:${editionRef.value}`);
    } else {
      editions.add(record.source + ":" + record.sourceRecordUrl);
    }
  }
  return [...editions].sort();
}

function candidateItemsFromRecords(records: readonly SourceRecord[]) {
  const query = { title: "" };
  return buildCandidates(
    records.map((record) => ({ record, matchedAliases: [] })),
    query,
  );
}

function toModuleAttestation(
  source: AttestationSource,
  role: AttestationRole,
): TitleAttestation {
  const record = source.record;
  return {
    source: record.source,
    role,
    text: source.attestation.text,
    subtitle: source.attestation.subtitle,
    language: source.attestation.language,
    sourceRecordUrl: record.sourceRecordUrl,
    references: record.refs,
    ...(source.attestation.statementId !== undefined
      ? { statementId: source.attestation.statementId }
      : {}),
    ...(source.attestation.rank !== undefined
      ? { rank: source.attestation.rank }
      : {}),
    stale: record.stale,
    fetchedAt: record.fetchedAt,
  };
}

function candidateToModule(
  item: CandidateItem,
  ref: CandidateRef,
): WorkCandidate {
  return {
    ref,
    title: item.title,
    alternativeTitles: item.alternativeTitles,
    authors: item.authors,
    ...(item.publicationYear !== undefined
      ? { publicationYear: item.publicationYear }
      : {}),
    ...(item.editionCount !== undefined
      ? { editionCount: item.editionCount }
      : {}),
    contentLanguages: item.contentLanguages,
    references: item.references,
  };
}

function failuresToWarnings(
  failures: readonly SourceFailure[],
): readonly SourceWarning[] {
  return failures.map((failure) => ({
    source: failure.source,
    code: failure.code,
    references: failure.references,
    ...(failure.details !== undefined ? { details: failure.details } : {}),
  }));
}

function sortedFailures(
  failures: readonly SourceFailure[],
): readonly SourceFailure[] {
  return [...failures].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return 0;
  });
}

function sortWarnings(
  warnings: readonly SourceWarning[],
): readonly SourceWarning[] {
  return [...warnings].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return 0;
  });
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** BookQuery invariant checks (issue #6 invariants 3). */
export function validateBookQuery(query: BookQuery): void {
  const title = normalizeTitleText(query.title);
  if (title === "") {
    throw new RangeError("BookQuery.title must be non-empty");
  }
  if (
    query.publicationYear !== undefined &&
    (query.publicationYear < 1 || query.publicationYear > 9999)
  ) {
    throw new RangeError("BookQuery.publicationYear is out of range");
  }
  if (query.author !== undefined && normalizeTitleText(query.author) === "") {
    throw new RangeError("BookQuery.author must be non-empty when present");
  }
  if (query.isbn !== undefined && canonicalReferenceValue(query.isbn) === "") {
    throw new RangeError("BookQuery.isbn must be non-empty when present");
  }
}
