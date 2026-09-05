/**
 * Open Library EvidenceSource (issue #1 workflows, issue #8 source workflows).
 *
 * The OL adapter implements Core's internal evidence port over the deep
 * ProviderRuntime. It owns candidate discovery (`/search.json` fielded),
 * Work/Edition/ISBN record reads with `/type/redirect` handling, and paged
 * `/works/{key}/editions.json` expansion. All endpoint HTTP plans flow
 * through the runtime, which owns cache, retry, rate, deadline, and redirect
 * policy; no OL code calls fetch directly.
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
  decodeEditionsPageEnvelope,
  decodeRecordEnvelope,
  decodeSearchEnvelope,
  type OlEditionEntry,
  type OlRecordData,
  type OlRecordValue,
  type OlRedirectValue,
  type OlSearchResultValue,
} from "./decoders.ts";
import {
  mapEditionEntry,
  mapOlRecord,
  mapSearchDoc,
  matchedAliasesOf,
} from "./mapping.ts";
import { OL_EDITIONS_MAX_PAGES, OL_EDITIONS_PAGE_SIZE } from "./config.ts";

const SEARCH_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "author_key",
  "first_publish_year",
  "edition_count",
  "edition_key",
  "language",
  "alternative_title",
  "alternative_subtitle",
];
const SEARCH_LIMIT = 20;
const MAX_RECORD_REDIRECTS = 4;
const BASE_URL = "https://openlibrary.org";

export interface OpenLibrarySourceOptions {
  /** Offline mode never fetches; it serves cached envelopes only. */
  readonly offline?: boolean;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export class OpenLibrarySource implements EvidenceSource {
  readonly source = "openlibrary" as const;
  readonly #runtime: ProviderRuntime;
  readonly #mode: RuntimeRequestMode;
  readonly #pageSize: number;
  readonly #maxPages: number;

  constructor(
    runtime: ProviderRuntime,
    options: OpenLibrarySourceOptions = {},
  ) {
    this.#runtime = runtime;
    this.#mode = options.offline === true ? "offline" : "online";
    this.#pageSize = options.pageSize ?? OL_EDITIONS_PAGE_SIZE;
    this.#maxPages = options.maxPages ?? OL_EDITIONS_MAX_PAGES;
  }

  // -------------------------------------------------------------------------
  // Candidate discovery
  // -------------------------------------------------------------------------

  async search(
    query: BookQuery,
    requestOptions: RequestOptions,
  ): Promise<SourceSearchOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    const plan = searchPlan(query);
    const outcome = await this.#runtime.execute(plan, {
      mode: this.#mode,
      signal: requestOptions.signal,
    });
    if (outcome.kind === "cancelled") return { status: "cancelled" };
    if (outcome.kind === "source_failure") {
      return { status: "failed", failure: outcome.failure };
    }
    if (outcome.kind === "no_record") return { status: "no_record" };
    const value = outcome.data as OlSearchResultValue;
    const context = {
      sourceRecordUrl: outcome.meta.finalUrl,
      fetchedAt: outcome.meta.fetchedAt,
      stale: outcome.meta.stale,
    };
    return {
      status: "ok",
      hits: value.docs.map((doc) => ({
        record: mapSearchDoc(doc, context),
        matchedAliases: matchedAliasesOf(doc),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Record reads (Work, Edition, ISBN) with JSON redirect handling
  // -------------------------------------------------------------------------

  async fetch(
    reference: ExternalReference,
    requestOptions: RequestOptions,
  ): Promise<SourceFetchOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    const initial = initialRecordPlan(reference);
    if (initial === undefined) return { status: "no_record" };
    let url = initial.url;
    const seen = new Set<string>([url]);
    for (let hop = 0; hop <= MAX_RECORD_REDIRECTS; hop++) {
      const plan: RequestPlan<OlRecordData> = {
        method: "GET",
        url,
        cacheClass: "detail",
        decoder: decodeRecordEnvelope,
      };
      const outcome = await this.#runtime.execute(plan, {
        mode: this.#mode,
        signal: requestOptions.signal,
      });
      if (outcome.kind === "cancelled") return { status: "cancelled" };
      if (outcome.kind === "source_failure") {
        return { status: "failed", failure: outcome.failure };
      }
      if (outcome.kind === "no_record") return { status: "no_record" };
      const data = outcome.data as OlRecordData;
      if (data.kind === "redirect") {
        const next = canonicalUrlOfRedirect(data);
        if (next === undefined || seen.has(next)) {
          return {
            status: "failed",
            failure: failureFromData("decode", {
              url,
              reason: "redirect_record_invalid",
            }),
          };
        }
        seen.add(next);
        url = next;
        continue;
      }
      const context = {
        sourceRecordUrl: outcome.meta.finalUrl,
        fetchedAt: outcome.meta.fetchedAt,
        stale: outcome.meta.stale,
      };
      return {
        status: "ok",
        records: [mapOlRecord(data as OlRecordValue, context)],
      };
    }
    return {
      status: "failed",
      failure: failureFromData("decode", {
        url,
        reason: "record_redirect_limit",
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Edition expansion
  // -------------------------------------------------------------------------

  async expandEditions(
    workReference: ExternalReference,
    requestOptions: RequestOptions,
  ): Promise<SourceExpansionOutcome> {
    if (requestOptions.signal?.aborted) {
      return { status: "cancelled" };
    }
    if (workReference.namespace !== "openlibrary:work") {
      // Not an Open Library Work identity; nothing to expand here.
      return { status: "ok", records: [], warnings: [] };
    }
    const records: SourceRecord[] = [];
    const warnings: SourceWarning[] = [];
    let offset = 0;
    for (let page = 0; page < this.#maxPages; page++) {
      const plan = editionsPagePlan(workReference, offset, this.#pageSize);
      const outcome = await this.#runtime.execute(plan, {
        mode: this.#mode,
        signal: requestOptions.signal,
      });
      if (outcome.kind === "cancelled") return { status: "cancelled" };
      if (outcome.kind === "no_record") break;
      if (outcome.kind === "source_failure") {
        const failure = outcome.failure;
        if (records.length === 0 && page === 0) {
          return { status: "failed", failure };
        }
        warnings.push(failureToWarning(failure));
        break;
      }
      const value = outcome.data as {
        size: number;
        entries: readonly OlEditionEntry[];
        nextPath?: string;
      };
      const context = {
        sourceRecordUrl: outcome.meta.finalUrl,
        fetchedAt: outcome.meta.fetchedAt,
        stale: outcome.meta.stale,
      };
      records.push(
        ...value.entries.map((entry) => mapEditionEntry(entry, context)),
      );
      if (value.nextPath === undefined) break;
      const reachedSize = records.length >= value.size;
      const reachedCap = page >= this.#maxPages - 1;
      if (reachedSize || reachedCap) {
        warnings.push({
          source: "openlibrary",
          code: "partial_expansion",
          references: [workReference],
          details: { reason: reachedCap ? "page_cap" : "pagination_bound" },
        });
        break;
      }
      offset += this.#pageSize;
    }
    return { status: "ok", records, warnings };
  }
}

// ---------------------------------------------------------------------------
// Plan builders
// ---------------------------------------------------------------------------

function searchPlan(query: BookQuery): RequestPlan<OlSearchResultValue> {
  const url = new URL(`${BASE_URL}/search.json`);
  url.searchParams.set("title", query.title);
  if (query.author !== undefined && query.author.trim() !== "") {
    url.searchParams.set("author", query.author);
  }
  if (query.isbn !== undefined && query.isbn.trim() !== "") {
    url.searchParams.set("isbn", query.isbn);
  }
  url.searchParams.set("fields", SEARCH_FIELDS.join(","));
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  return {
    method: "GET",
    url: url.href,
    cacheClass: "search",
    decoder: decodeSearchEnvelope,
  };
}

function initialRecordPlan(
  reference: ExternalReference,
): { readonly url: string } | undefined {
  switch (reference.namespace) {
    case "openlibrary:work":
      return { url: `${BASE_URL}/works/${reference.value}.json` };
    case "openlibrary:edition":
      return { url: `${BASE_URL}/books/${reference.value}.json` };
    case "isbn":
      return { url: `${BASE_URL}/isbn/${reference.value}.json` };
    default:
      return undefined;
  }
}

function editionsPagePlan(
  workReference: ExternalReference,
  offset: number,
  limit: number,
): RequestPlan<unknown> {
  const url = new URL(
    `${BASE_URL}/works/${workReference.value}/editions.json`,
  );
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  return {
    method: "GET",
    url: url.href,
    cacheClass: "detail",
    decoder: (env: TransportEnvelope): DecodeResult<unknown> =>
      decodeEditionsPageEnvelope(env),
  };
}

function canonicalUrlOfRedirect(redirect: OlRedirectValue): string | undefined {
  if (!redirect.location.startsWith("/")) return undefined;
  return `${BASE_URL}${redirect.location}.json`;
}

// ---------------------------------------------------------------------------
// Failure/warning mapping
// ---------------------------------------------------------------------------

function failureFromData(
  code: SourceFailure["code"],
  details: Readonly<Record<string, string>>,
): SourceFailure {
  return { source: "openlibrary", code, references: [], details };
}

function failureToWarning(failure: SourceFailure): SourceWarning {
  return {
    source: failure.source,
    code: failure.code,
    references: failure.references,
    ...(failure.details !== undefined ? { details: failure.details } : {}),
  };
}
