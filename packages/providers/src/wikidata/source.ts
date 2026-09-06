/**
 * Wikidata EvidenceSource (research #2 bounded pipeline, issue #8 source
 * workflows).
 *
 * Implements Core's internal evidence port over the deep ProviderRuntime:
 *   - discovery via `wbsearchentities` (zh, with a zh-Hant retry for
 *     traditional-script queries that return nothing);
 *   - batch entity reads via `wbgetentities` that classify candidates as
 *     Work/Edition/Other from P31 and preserve claims/ranks/qualifiers/
 *     references/labels;
 *   - Work edition expansion via fixed Shape 2 SPARQL on WDQS, falling back
 *     to the Work's P747 inverse index + entity reads when WDQS fails;
 *   - ISBN lookup via Shape 3 SPARQL with a CirrusSearch `haswbstatement`
 *     fallback.
 *
 * Labels, aliases, descriptions, and sitelinks are Search Alias material
 * only; no WD code calls fetch directly and raw upstream JSON never crosses
 * into Core.
 */

import type {
  BookQuery,
  ExternalReference,
  RequestOptions,
} from "../../../core/src/module.ts";
import type {
  EvidenceSource,
  SourceExpansionOutcome,
  SourceFetchOutcome,
  SourceSearchOutcome,
} from "../../../core/src/internal-port.ts";
import type { SourceFailure, SourceWarning } from "../../../core/src/domain.ts";
import type { SourceRecord } from "../../../core/src/evidence.ts";
import type { ProviderRuntime } from "../runtime/runtime.ts";
import type {
  DecodeResult,
  RequestPlan,
  RuntimeRequestMode,
  TransportEnvelope,
} from "../runtime/types.ts";
import {
  decodeCirrusSearchEnvelope,
  decodeEntitiesEnvelope,
  decodeSearchEnvelope,
  decodeSparqlEnvelope,
  sparqlEntityId,
  type WdEntity,
  type WdSearchResult,
  type WdSparqlRow,
  type WdSparqlValue,
} from "./decoders.ts";
import {
  aliasesOfEntity,
  mapEntity,
  mapSparqlEditionRow,
  type SparqlEditionRow,
} from "./mapping.ts";
import { shape2EditionsQuery, shape3IsbnQuery, sparqlUrl } from "./sparql.ts";
import {
  WD_SEARCH_LANGUAGE,
  WD_SEARCH_LANGUAGE_HANT,
  WD_SEARCH_LIMIT,
} from "./config.ts";

const API_BASE = "https://www.wikidata.org/w/api.php";
/** Label languages requested from wbgetentities (display/clue data). */
const LABEL_LANGUAGES = [
  "zh",
  "zh-hans",
  "zh-hant",
  "en",
  "es",
  "ja",
  "fr",
  "de",
];

/** Non-deprecated P31 class items used to decide Work vs Edition. */
export type { WdEntityKind } from "./mapping.ts";

/** A small marker set of glyphs that strongly signal traditional Chinese
 *  script; when present and the primary zh search finds nothing, a zh-Hant
 *  discovery retry runs (research #2 step 1). Deterministic and bounded. */
const TRADITIONAL_MARKERS =
  "\u8457\u5BC2\u5F8C\u7121\u70BA\u5B78\u904E\u570B\u6642\u9593\u9AD4\u767C\u898B\u6703\u8207\u8AAA\u6A02\u5716\u55AE";

function containsTraditional(title: string): boolean {
  for (const ch of title) {
    if (TRADITIONAL_MARKERS.includes(ch)) return true;
  }
  return false;
}

function searchMatchedAliases(result: WdSearchResult): readonly {
  readonly text: string;
  readonly language?: string;
}[] {
  const out: { readonly text: string; readonly language?: string }[] = [];
  if (result.label !== undefined && result.label.trim() !== "") {
    out.push({ text: result.label.trim() });
  }
  for (const alias of result.aliases) {
    if (alias.trim() !== "") out.push({ text: alias.trim() });
  }
  if (result.matchedText !== undefined && result.matchedText.trim() !== "") {
    out.push({
      text: result.matchedText.trim(),
      ...(result.matchedLanguage !== undefined
        ? { language: result.matchedLanguage }
        : {}),
    });
  }
  return out;
}

export interface WikidataSourceOptions {
  /** Offline mode never fetches; it serves cached envelopes only. */
  readonly offline?: boolean;
}

export class WikidataSource implements EvidenceSource {
  readonly source = "wikidata" as const;
  readonly #runtime: ProviderRuntime;
  readonly #mode: RuntimeRequestMode;

  constructor(runtime: ProviderRuntime, options: WikidataSourceOptions = {}) {
    this.#runtime = runtime;
    this.#mode = options.offline === true ? "offline" : "online";
  }

  // -------------------------------------------------------------------------
  // Candidate discovery (research #2 step 1-2)
  // -------------------------------------------------------------------------

  async search(
    query: BookQuery,
    requestOptions: RequestOptions,
  ): Promise<SourceSearchOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    const operation = this.#runtime.beginOperation({
      mode: this.#mode,
      signal: requestOptions.signal,
    });

    const qids = await this.#discover(operation, query);
    if (qids.kind === "cancelled") return { status: "cancelled" };
    if (qids.kind === "failed") {
      return { status: "failed", failure: qids.failure };
    }
    if (qids.kind === "no_record") return { status: "no_record" };
    if (qids.ids.length === 0) return { status: "no_record" };

    const read = await this.#readEntities(operation, qids.ids);
    if (read.kind === "cancelled") return { status: "cancelled" };
    if (read.kind === "no_record") return { status: "no_record" };
    if (read.kind === "failed") {
      return { status: "failed", failure: read.failure };
    }
    const aliasesByEntity = new Map(
      read.entities.map((entity) => [entity.id, aliasesOfEntity(entity)]),
    );
    const matchedAliasesByQid = new Map(
      qids.matched.map((entry) => [entry.id, entry.aliases]),
    );

    const records: {
      readonly record: SourceRecord;
      readonly matchedAliases: readonly {
        readonly text: string;
        readonly language?: string;
      }[];
    }[] = [];

    for (const entity of read.entities) {
      const mapped = mapEntity(entity, {
        sourceRecordUrl: read.finalUrl,
        fetchedAt: read.fetchedAt,
        stale: read.stale,
      });
      if (mapped === undefined) continue;
      const entityAliases = aliasesByEntity.get(entity.id) ?? [];
      const matched = matchedAliasesByQid.get(entity.id) ?? [];
      const combined = dedupeAliases([...entityAliases, ...matched]);
      records.push({ record: mapped, matchedAliases: combined });
    }
    return { status: "ok", hits: records };
  }

  async #discover(
    operation: import("../runtime/types.ts").RuntimeOperation,
    query: BookQuery,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly ids: readonly string[];
        readonly matched: readonly {
          readonly id: string;
          readonly aliases: readonly {
            readonly text: string;
            readonly language?: string;
          }[];
        }[];
      }
    | { readonly kind: "no_record" }
    | { readonly kind: "failed"; readonly failure: SourceFailure }
    | { readonly kind: "cancelled" }
  > {
    const run = async (
      language: string,
    ): Promise<
      | {
          readonly kind: "ok";
          readonly ids: string[];
          readonly matched: {
            readonly id: string;
            readonly aliases: readonly {
              readonly text: string;
              readonly language?: string;
            }[];
          }[];
        }
      | { readonly kind: "cancelled" }
      | { readonly kind: "failed"; readonly failure: SourceFailure }
      | { readonly kind: "no_record" }
    > => {
      const outcome = await operation.execute(
        searchPlan(query.title, language),
      );
      if (outcome.kind === "cancelled") return { kind: "cancelled" };
      if (outcome.kind === "source_failure") {
        return { kind: "failed", failure: outcome.failure };
      }
      if (outcome.kind === "no_record") return { kind: "no_record" };
      const value = outcome.data as {
        readonly results: readonly WdSearchResult[];
      };
      const ids: string[] = [];
      const matched: {
        readonly id: string;
        readonly aliases: readonly {
          readonly text: string;
          readonly language?: string;
        }[];
      }[] = [];
      for (const result of value.results.slice(0, WD_SEARCH_LIMIT)) {
        ids.push(result.id);
        matched.push({ id: result.id, aliases: searchMatchedAliases(result) });
      }
      return { kind: "ok", ids, matched };
    };

    const first = await run(WD_SEARCH_LANGUAGE);
    if (first.kind !== "ok") return first;
    if (first.ids.length > 0) {
      return { kind: "ok", ids: first.ids, matched: first.matched };
    }
    if (containsTraditional(query.title)) {
      const retry = await run(WD_SEARCH_LANGUAGE_HANT);
      if (retry.kind !== "ok") return retry;
      return { kind: "ok", ids: retry.ids, matched: retry.matched };
    }
    return { kind: "no_record" };
  }

  // -------------------------------------------------------------------------
  // Entity reads (wbgetentities batch)
  // -------------------------------------------------------------------------

  async #readEntities(
    operation: import("../runtime/types.ts").RuntimeOperation,
    ids: readonly string[],
  ): Promise<
    | {
        readonly kind: "ok";
        readonly entities: readonly WdEntity[];
        readonly finalUrl: string;
        readonly fetchedAt: string;
        readonly stale: boolean;
      }
    | { readonly kind: "no_record" }
    | { readonly kind: "failed"; readonly failure: SourceFailure }
    | { readonly kind: "cancelled" }
  > {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { kind: "no_record" };
    const outcome = await operation.execute(entityReadPlan(unique));
    if (outcome.kind === "cancelled") return { kind: "cancelled" };
    if (outcome.kind === "source_failure") {
      return { kind: "failed", failure: outcome.failure };
    }
    if (outcome.kind === "no_record") return { kind: "no_record" };
    const value = outcome.data as {
      readonly entities: readonly WdEntity[];
    };
    return {
      kind: "ok",
      entities: value.entities,
      finalUrl: outcome.meta.finalUrl,
      fetchedAt: outcome.meta.fetchedAt,
      stale: outcome.meta.stale,
    };
  }

  // -------------------------------------------------------------------------
  // Record reads (wikidata:item or ISBN via shape 3 / CirrusSearch)
  // -------------------------------------------------------------------------

  async fetch(
    reference: ExternalReference,
    requestOptions: RequestOptions,
  ): Promise<SourceFetchOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    if (reference.namespace === "wikidata:item") {
      const operation = this.#runtime.beginOperation({
        mode: this.#mode,
        signal: requestOptions.signal,
      });
      const read = await this.#readEntities(operation, [reference.value]);
      if (read.kind === "cancelled") return { status: "cancelled" };
      if (read.kind === "no_record") return { status: "no_record" };
      if (read.kind === "failed") {
        return { status: "failed", failure: read.failure };
      }
      const context = {
        sourceRecordUrl: read.finalUrl,
        fetchedAt: read.fetchedAt,
        stale: read.stale,
      };
      const records = read.entities
        .map((entity) => mapEntity(entity, context))
        .filter((record): record is SourceRecord => record !== undefined)
        .map((record) => withRequestedReference(record, reference));
      if (records.length === 0) return { status: "no_record" };
      return { status: "ok", records };
    }
    if (reference.namespace === "isbn") {
      return await this.#fetchByIsbn(reference, requestOptions);
    }
    return { status: "no_record" };
  }

  async #fetchByIsbn(
    reference: ExternalReference,
    requestOptions: RequestOptions,
  ): Promise<SourceFetchOutcome> {
    const operation = this.#runtime.beginOperation({
      mode: this.#mode,
      signal: requestOptions.signal,
    });
    const ids = await this.#findByIsbn(operation, reference.value);
    if (ids.kind === "cancelled") return { status: "cancelled" };
    if (ids.kind === "failed") {
      return { status: "failed", failure: ids.failure };
    }
    if (ids.ids.length === 0) return { status: "no_record" };
    const read = await this.#readEntities(operation, ids.ids);
    if (read.kind === "cancelled") return { status: "cancelled" };
    if (read.kind === "no_record") return { status: "no_record" };
    if (read.kind === "failed") {
      return { status: "failed", failure: read.failure };
    }
    const context = {
      sourceRecordUrl: read.finalUrl,
      fetchedAt: read.fetchedAt,
      stale: read.stale,
    };
    const records = read.entities
      .map((entity) => mapEntity(entity, context))
      .filter((record): record is SourceRecord => record !== undefined)
      .map((record) => withRequestedReference(record, reference));
    if (records.length === 0) return { status: "no_record" };
    return { status: "ok", records };
  }

  async #findByIsbn(
    operation: import("../runtime/types.ts").RuntimeOperation,
    isbn: string,
  ): Promise<
    | { readonly kind: "ok"; readonly ids: readonly string[] }
    | { readonly kind: "failed"; readonly failure: SourceFailure }
    | { readonly kind: "cancelled" }
  > {
    // Shape 3 SPARQL first; CirrusSearch `haswbstatement` is the fallback.
    const sparqlOutcome = await operation.execute(isbnSparqlPlan(isbn));
    if (sparqlOutcome.kind === "cancelled") return { kind: "cancelled" };
    if (sparqlOutcome.kind === "ok") {
      const ids = editionIdsFromRows(
        (sparqlOutcome.data as WdSparqlValue).rows,
      );
      if (ids.length > 0) return { kind: "ok", ids };
    }
    const cirrusOutcome = await operation.execute(isbnCirrusPlan(isbn));
    if (cirrusOutcome.kind === "cancelled") return { kind: "cancelled" };
    if (cirrusOutcome.kind === "source_failure") {
      return { kind: "failed", failure: cirrusOutcome.failure };
    }
    if (cirrusOutcome.kind === "no_record") return { kind: "ok", ids: [] };
    const value = cirrusOutcome.data as { readonly ids: readonly string[] };
    return { kind: "ok", ids: value.ids };
  }

  // -------------------------------------------------------------------------
  // Edition expansion (Shape 2 SPARQL with P747/entity-read fallback)
  // -------------------------------------------------------------------------

  async expandEditions(
    workReference: ExternalReference,
    requestOptions: RequestOptions,
  ): Promise<SourceExpansionOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    if (workReference.namespace !== "wikidata:item") {
      return { status: "ok", records: [], warnings: [] };
    }
    const operation = this.#runtime.beginOperation({
      mode: this.#mode,
      signal: requestOptions.signal,
    });

    const outcome = await operation.execute(
      editionsSparqlPlan(workReference.value),
    );
    if (outcome.kind === "cancelled") return { status: "cancelled" };
    if (outcome.kind === "source_failure") {
      return await this.#fallbackEditionExpansion(
        workReference,
        outcome.failure,
        operation,
      );
    }
    if (outcome.kind === "no_record") {
      return { status: "ok", records: [], warnings: [] };
    }
    const rows = (outcome.data as WdSparqlValue).rows;
    const context = {
      sourceRecordUrl: outcome.meta.finalUrl,
      fetchedAt: outcome.meta.fetchedAt,
      stale: outcome.meta.stale,
    };
    const records: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const parsed = parseEditionRow(row, workReference);
      if (parsed === undefined) continue;
      if (seen.has(parsed.editionId)) continue;
      seen.add(parsed.editionId);
      records.push(mapSparqlEditionRow(parsed, context));
    }
    return { status: "ok", records, warnings: [] };
  }

  async #fallbackEditionExpansion(
    workReference: ExternalReference,
    cause: SourceFailure,
    operation: import("../runtime/types.ts").RuntimeOperation,
  ): Promise<SourceExpansionOutcome> {
    // Read the confirmed Work to learn its P747 inverse Edition index.
    const workRead = await this.#readEntities(operation, [workReference.value]);
    if (workRead.kind === "cancelled") return { status: "cancelled" };
    if (workRead.kind === "no_record") {
      return { status: "ok", records: [], warnings: [failureToWarning(cause)] };
    }
    if (workRead.kind === "failed") {
      return { status: "failed", failure: workRead.failure };
    }
    const work = workRead.entities.find(
      (entity) => entity.id === workReference.value,
    );
    const p747 =
      work === undefined
        ? []
        : work.claims
            .filter(
              (claim) =>
                claim.property === "P747" && claim.rank !== "deprecated",
            )
            .map((claim) =>
              claim.value.kind === "item" ? claim.value.id : undefined,
            )
            .filter((id): id is string => id !== undefined);
    const warnings: SourceWarning[] = [
      failureToWarning(cause),
      ...(p747.length === 0
        ? [
            {
              source: "wikidata" as const,
              code: "unavailable" as const,
              references: [workReference],
              details: { reason: "p747_incomplete" },
            },
          ]
        : []),
    ];
    if (p747.length === 0) {
      return { status: "ok", records: [], warnings };
    }
    const editionRead = await this.#readEntities(operation, p747);
    if (editionRead.kind === "cancelled") return { status: "cancelled" };
    if (editionRead.kind === "no_record") {
      return { status: "ok", records: [], warnings };
    }
    if (editionRead.kind === "failed") {
      return { status: "failed", failure: editionRead.failure };
    }
    const context = {
      sourceRecordUrl: editionRead.finalUrl,
      fetchedAt: editionRead.fetchedAt,
      stale: editionRead.stale,
    };
    const records = editionRead.entities
      .map((entity) => mapEntity(entity, context))
      .filter((record): record is SourceRecord => record !== undefined);
    return { status: "ok", records, warnings };
  }
}

// ---------------------------------------------------------------------------
// Plan builders
// ---------------------------------------------------------------------------

function searchPlan(title: string, language: string): RequestPlan<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("search", title);
  url.searchParams.set("language", language);
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", String(WD_SEARCH_LIMIT));
  return {
    method: "GET",
    url: url.href,
    cacheClass: "search",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeSearchEnvelope(env),
  };
}

function entityReadPlan(ids: readonly string[]): RequestPlan<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("ids", ids.join("|"));
  url.searchParams.set("redirects", "yes");
  url.searchParams.set("languages", LABEL_LANGUAGES.join("|"));
  url.searchParams.set("props", "labels|aliases|claims");
  return {
    method: "GET",
    url: url.href,
    cacheClass: "detail",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeEntitiesEnvelope(env),
  };
}

function editionsSparqlPlan(workQid: string): RequestPlan<unknown> {
  return {
    method: "GET",
    url: sparqlUrl(shape2EditionsQuery(workQid)),
    cacheClass: "detail",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeSparqlEnvelope(env),
  };
}

function isbnSparqlPlan(isbn: string): RequestPlan<unknown> {
  return {
    method: "GET",
    url: sparqlUrl(shape3IsbnQuery(isbn)),
    cacheClass: "search",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeSparqlEnvelope(env),
  };
}

function isbnCirrusPlan(isbn: string): RequestPlan<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("srsearch", `haswbstatement:P212=${isbn}`);
  url.searchParams.set("srnamespace", "0");
  url.searchParams.set("srlimit", "5");
  return {
    method: "GET",
    url: url.href,
    cacheClass: "search",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeCirrusSearchEnvelope(env),
  };
}

// ---------------------------------------------------------------------------
// Row / helper parsing
// ---------------------------------------------------------------------------

function editionIdsFromRows(rows: readonly WdSparqlRow[]): readonly string[] {
  const out: string[] = [];
  for (const row of rows) {
    const id = sparqlEntityId(row.bindings["e"]);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseEditionRow(
  row: WdSparqlRow,
  workReference: ExternalReference,
): SparqlEditionRow | undefined {
  const editionId = sparqlEntityId(row.bindings["e"]);
  if (editionId === undefined) return undefined;
  const title = row.bindings["title"]?.value?.trim();
  if (title === undefined || title === "") return undefined;
  const language = row.bindings["title"]?.language;
  const isbn = row.bindings["isbn"]?.value?.trim();
  const parsed: SparqlEditionRow = {
    editionId,
    workReference,
    title,
    ...(language !== undefined && language !== "und" ? { language } : {}),
    ...(isbn !== undefined && isbn !== "" ? { isbn } : {}),
  };
  return parsed;
}

function withRequestedReference(
  record: SourceRecord,
  requested: ExternalReference,
): SourceRecord {
  const alreadyPresent = record.refs.some(
    (reference) =>
      reference.namespace === requested.namespace &&
      reference.value === requested.value,
  );
  if (alreadyPresent) return record;
  return { ...record, refs: [requested, ...record.refs] };
}

function failureToWarning(failure: SourceFailure): SourceWarning {
  return {
    source: failure.source,
    code: failure.code,
    references: failure.references,
    ...(failure.details !== undefined ? { details: failure.details } : {}),
  };
}

function dedupeAliases(
  aliases: readonly { readonly text: string; readonly language?: string }[],
): readonly { readonly text: string; readonly language?: string }[] {
  const out: { readonly text: string; readonly language?: string }[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const key = `${alias.language ?? ""}\u0000${alias.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}
