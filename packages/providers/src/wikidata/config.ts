/**
 * Wikidata runtime policy and identity constants (issue #8 per-source policy
 * table for Wikidata, research #2, issue #10 D7 decoder discipline).
 *
 * Wikidata requests are serialized at low rate per Wikimedia guidance, so the
 * operative concurrency bound is 1 with no artificial spacing. The exact host
 * allowlist covers the Action API/EntityData host (`www.wikidata.org`, with
 * `wikidata.org` for the Linked Data redirect target) and WDQS
 * (`query.wikidata.org`). Providers never read environment variables; the
 * composition root passes a finished User-Agent and runtime configuration.
 */

import type { RuntimeConfig } from "../runtime/types.ts";
import {
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MIN_SPACING_MS,
  DEFAULT_SOURCE_BUDGET_MS,
} from "../runtime/types.ts";
import { formatUserAgent } from "../openlibrary/config.ts";

/** Exact Wikidata host allowlist (no suffix globbing). */
export const WD_HOSTS: readonly string[] = [
  "wikidata.org",
  "www.wikidata.org",
  "query.wikidata.org",
];

/** Current decoder/schema version for Wikidata responses. */
export const WD_DECODER_SCHEMA_VERSION = 1;

/** Wikidata identified-client etiquette defaults (research #2). */
export const WD_MAX_CONCURRENT_REQUESTS = 1;
export const WD_MIN_SPACING_MS = DEFAULT_MIN_SPACING_MS;
export const WD_MAX_RETRIES = DEFAULT_MAX_RETRIES;
export const WD_SOURCE_BUDGET_MS = DEFAULT_SOURCE_BUDGET_MS;
export const WD_MAX_REDIRECTS = DEFAULT_MAX_REDIRECTS;

/** Search discovery limits (research #2 pagination). */
export const WD_SEARCH_LIMIT = 20;
export const WD_SEARCH_LANGUAGE = "zh";
/** Traditional-script fallback language when zh returns nothing. */
export const WD_SEARCH_LANGUAGE_HANT = "zh-Hant";

/** Item-language mapping for P407 content/title language item claims. */
export const WD_LANGUAGE_ITEMS: Readonly<Record<string, string>> = {
  Q1860: "en", // English
  Q7850: "zh", // Chinese
  Q7275: "yue", // Cantonese (also Q1476 alias)
  Q1476: "yue",
  Q1321: "es", // Spanish
  Q150: "fr", // French
  Q188: "de", // German
  Q652: "it", // Italian
  Q5287: "ja", // Japanese
  Q5146: "pt", // Portuguese
  Q7737: "ru", // Russian
  Q9176: "ko", // Korean
  Q13955: "ar", // Arabic
};

export interface WikidataRuntimeOptions {
  /** Version stamp from the composition root (0.1.0 in source builds). */
  readonly version: string;
  /** Configured contact (from BOOK_TITLE_CONTACT / config file). */
  readonly contact?: string;
  /** Injectable transport for fixture harnesses; defaults to fetch. */
  readonly fetch?: typeof fetch;
}

/** Build the deep runtime config for Wikidata. */
export function wikidataRuntimeConfig(
  options: WikidataRuntimeOptions,
): RuntimeConfig {
  return {
    provider: "wikidata",
    userAgent: formatUserAgent({
      version: options.version,
      contact: options.contact,
    }),
    hosts: WD_HOSTS,
    decoderSchemaVersion: WD_DECODER_SCHEMA_VERSION,
    maxConcurrent: WD_MAX_CONCURRENT_REQUESTS,
    minSpacingMs: WD_MIN_SPACING_MS,
    maxRetries: WD_MAX_RETRIES,
    baseBackoffMs: DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    sourceBudgetMs: WD_SOURCE_BUDGET_MS,
    maxRedirects: WD_MAX_REDIRECTS,
    fetch: options.fetch ?? fetch,
  };
}
