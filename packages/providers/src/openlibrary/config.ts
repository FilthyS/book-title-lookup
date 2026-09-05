/**
 * Open Library runtime policy and identity constants (issue #8 per-source
 * policy table, research #1 etiquette, issue #10 D7 decoder discipline).
 *
 * Providers never read environment variables: the composition root passes a
 * finished User-Agent and the runtime configuration. The decoder schema
 * version lives here so cache writes, cache reads, and the CLI permission
 * surface all share one stamp.
 */

import type { RuntimeConfig } from "../runtime/types.ts";
import {
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MIN_SPACING_MS,
  DEFAULT_SOURCE_BUDGET_MS,
} from "../runtime/types.ts";

/** Exact Open Library host allowlist. */
export const OL_HOSTS: readonly string[] = ["openlibrary.org"];

/** Current decoder/schema version for Open Library responses. */
export const OL_DECODER_SCHEMA_VERSION = 1;

/** Decoder schema versions for every provider, keyed for cache reads. The
 *  Wikidata value is reserved for ticket #18; Open Library is live. */
export const PROVIDER_DECODER_SCHEMA_VERSIONS = {
  openlibrary: OL_DECODER_SCHEMA_VERSION,
  wikidata: 1,
} as const;

/** Project URL used in the identified User-Agent. */
export const OL_PROJECT_URL = "https://github.com/FilthyS/book-title-lookup";

/** Open Library identified-client etiquette defaults (research #1). */
export const OL_MAX_CONCURRENT_REQUESTS = DEFAULT_MAX_CONCURRENT;
export const OL_MIN_SPACING_MS = DEFAULT_MIN_SPACING_MS;
export const OL_MAX_RETRIES = DEFAULT_MAX_RETRIES;
export const OL_SOURCE_BUDGET_MS = DEFAULT_SOURCE_BUDGET_MS;
export const OL_MAX_REDIRECTS = DEFAULT_MAX_REDIRECTS;

/** Editions expansion paging defaults (research #1 / issue #8 risks). */
export const OL_EDITIONS_PAGE_SIZE = 50;
export const OL_EDITIONS_MAX_PAGES = 10;

/** Build the identified User-Agent. Contact is optional; the application
 *  name, version, and project URL are always present. */
export function formatUserAgent(options: {
  readonly version: string;
  readonly contact?: string;
}): string {
  const base = `book-title-lookup/${options.version} (+${OL_PROJECT_URL}`;
  if (options.contact !== undefined && options.contact.trim() !== "") {
    return `${base}; ${options.contact.trim()})`;
  }
  return `${base})`;
}

export interface OpenLibraryRuntimeOptions {
  /** Version stamp from the composition root (0.1.0 in source builds). */
  readonly version: string;
  /** Configured contact (from BOOK_TITLE_CONTACT / config file). */
  readonly contact?: string;
  /** Injectable transport for fixture harnesses; defaults to fetch. */
  readonly fetch?: typeof fetch;
}

/** Build the deep runtime config for Open Library. */
export function openLibraryRuntimeConfig(
  options: OpenLibraryRuntimeOptions,
): RuntimeConfig {
  return {
    provider: "openlibrary",
    userAgent: formatUserAgent({
      version: options.version,
      contact: options.contact,
    }),
    hosts: OL_HOSTS,
    decoderSchemaVersion: OL_DECODER_SCHEMA_VERSION,
    maxConcurrent: OL_MAX_CONCURRENT_REQUESTS,
    minSpacingMs: OL_MIN_SPACING_MS,
    maxRetries: OL_MAX_RETRIES,
    baseBackoffMs: DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    sourceBudgetMs: OL_SOURCE_BUDGET_MS,
    maxRedirects: OL_MAX_REDIRECTS,
    fetch: options.fetch ?? fetch,
  };
}
