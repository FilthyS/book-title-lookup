/**
 * Federated composition (issue #6 seam, issue #8 package shape, ticket #18
 * two-source extension).
 *
 * The real catalog service is Core's CatalogService composed over one or more
 * evidence sources. Ticket #17 composes Open Library alone; ticket #18 adds
 * Wikidata and the two-source composition where fan-out, per-source budgets,
 * partial-failure warnings, and deterministic order are owned by
 * CatalogService (which runs sources in canonical OL-then-WD order and
 * clusters shared Work identity through Wikidata P648). This module only
 * constructs the composed catalog from finished runtime configs.
 */

import { CatalogService } from "../../../core/src/catalog/service.ts";
import type { BookTitleCatalog } from "../../../core/src/module.ts";
import type { ProviderRuntime } from "../runtime/runtime.ts";
import { OpenLibrarySource } from "../openlibrary/source.ts";
import { WikidataSource } from "../wikidata/source.ts";

export interface OpenLibraryCompositionOptions {
  readonly runtime: ProviderRuntime;
  readonly offline?: boolean;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

/** Build the real Open Library-composed catalog service. */
export function createOpenLibraryCatalog(
  options: OpenLibraryCompositionOptions,
): BookTitleCatalog {
  const source = new OpenLibrarySource(options.runtime, {
    offline: options.offline === true,
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
  });
  return new CatalogService([source]);
}

export interface WikidataCompositionOptions {
  readonly runtime: ProviderRuntime;
  readonly offline?: boolean;
}

/** Build the real Wikidata-composed catalog service (single source). */
export function createWikidataCatalog(
  options: WikidataCompositionOptions,
): BookTitleCatalog {
  const source = new WikidataSource(options.runtime, {
    offline: options.offline === true,
  });
  return new CatalogService([source]);
}

export interface TwoSourceCompositionOptions {
  readonly openLibrary: OpenLibraryCompositionOptions;
  readonly wikidata: WikidataCompositionOptions;
}

/**
 * Build the real two-source catalog service (Open Library then Wikidata).
 * Core's CatalogService fans search/resolve/expand out over both sources with
 * one shared request deadline each, aggregates partial failures into
 * warnings, and reconciles cross-source Work identity (Wikidata P648 ->
 * Open Library Work key) deterministically.
 */
export function createTwoSourceCatalog(
  options: TwoSourceCompositionOptions,
): BookTitleCatalog {
  const ol = options.openLibrary;
  const wd = options.wikidata;
  const openLibrary = new OpenLibrarySource(ol.runtime, {
    offline: ol.offline === true,
    ...(ol.pageSize !== undefined ? { pageSize: ol.pageSize } : {}),
    ...(ol.maxPages !== undefined ? { maxPages: ol.maxPages } : {}),
  });
  const wikidata = new WikidataSource(wd.runtime, {
    offline: wd.offline === true,
  });
  return new CatalogService([openLibrary, wikidata]);
}
