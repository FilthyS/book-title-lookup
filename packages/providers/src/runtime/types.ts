/**
 * Provider runtime request plans, envelopes, and typed outcomes
 * (issue #8 sections 2, 3, and 6).
 *
 * Source clients never call fetch directly. They build a typed plan and hand
 * it to the ProviderRuntime, which owns HTTP execution, redirect resolution,
 * host allowlisting, per-source rate limiting and concurrency, bounded retry
 * with jitter, Retry-After, per-source deadline budgeting, cancellation
 * propagation, raw-response capture, cache consultation and write-through,
 * and transport failure classification.
 */

import type { SourceFailure, SourceWarning } from "../../../core/src/domain.ts";
import type {
  FreshnessClass,
  RawResponseEnvelopeV1,
} from "../cache/envelope.ts";
import type { CacheKey } from "../cache/key.ts";

export type { FreshnessClass };

/** The source this runtime instance speaks for (cache keys and failures). */
export type RuntimeProviderId = "openlibrary" | "wikidata";

export interface RuntimeConfig {
  readonly provider: RuntimeProviderId;
  /** Identified User-Agent supplied by the composition root. */
  readonly userAgent: string;
  /** Exact host allowlist (no suffix globbing). */
  readonly hosts: readonly string[];
  /** Provider decoder/schema version stamped into cached envelopes. */
  readonly decoderSchemaVersion: number;
  readonly maxConcurrent: number;
  readonly minSpacingMs: number;
  /** Additional attempts beyond the first (default 2). */
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly sourceBudgetMs: number;
  readonly maxRedirects: number;
  /** Injectable transport, defaults to globalThis.fetch. */
  readonly fetch: typeof fetch;
}

/** Freshness classes a request can declare (issue #10 section 9). */
export type PlanCacheClass = Extract<FreshnessClass, "search" | "detail">;

/** A typed request plan. `url` is fully resolved and canonicalized so it can
 *  serve as the cache identity and the wire URL. */
export interface RequestPlan<D> {
  readonly method: "GET"; // The MVP transport is GET-only.
  readonly url: string;
  /** Absent => never cache this request or its redirect hops. */
  readonly cacheClass?: PlanCacheClass;
  readonly decoder: (
    envelope: TransportEnvelope,
  ) => DecodeResult<D> | Promise<DecodeResult<D>>;
}

/** The raw response surface a decoder sees: status, content type, strict
 *  UTF-8 body bytes, and the final URL after redirect resolution. */
export interface TransportEnvelope {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: Uint8Array;
  readonly finalUrl: string;
}

export type DecodeResult<D> =
  | { readonly kind: "data"; readonly value: D; readonly negative?: boolean }
  /** A definitive absence (404/410 not-found body, empty no-result set). */
  | { readonly kind: "no_record" }
  | { readonly kind: "malformed"; readonly detail: string };

/** Metadata attached to a successful or absent outcome. */
export interface ResponseMeta {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status?: number;
  readonly contentType: string | null;
  /** ISO-8601 UTC instant at which the terminal response was fetched. */
  readonly fetchedAt: string;
  readonly servedFromCache: boolean;
  readonly stale: boolean;
  readonly redirects: readonly {
    readonly from: string;
    readonly to: string;
  }[];
  readonly warnings: readonly SourceWarning[];
}

export type RunOutcome<D> =
  | { readonly kind: "ok"; readonly data: D; readonly meta: ResponseMeta }
  | { readonly kind: "no_record"; readonly meta: ResponseMeta }
  | { readonly kind: "source_failure"; readonly failure: SourceFailure }
  | { readonly kind: "cancelled" };

/** Options for one execute call. */
export interface RuntimeRequestOptions {
  readonly signal?: AbortSignal;
  /** Offline mode never fetches: it serves cached entries only. */
  readonly mode?: "online" | "offline";
  /** Per-call budget override; defaults to config.sourceBudgetMs. */
  readonly sourceBudgetMs?: number;
}

/**
 * A source operation can execute several plans against one shared deadline,
 * for example a merged-key redirect or paged Edition expansion.
 */
export interface RuntimeOperation {
  execute<D>(plan: RequestPlan<D>): Promise<RunOutcome<D>>;
}

/** The opaque cache seam the runtime consults. */
export interface RuntimeCachePort {
  read(key: CacheKey, options: {
    readonly mode: "online" | "offline";
    readonly signal?: AbortSignal;
  }): Promise<CacheReadOutcomeForRuntime>;
  write(
    key: CacheKey,
    envelope: RawResponseEnvelopeV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CacheWriteOutcomeForRuntime>;
}

export type CacheReadOutcomeForRuntime =
  | { readonly status: "hit_fresh"; readonly envelope: RawResponseEnvelopeV1 }
  | {
    readonly status: "hit_stale";
    readonly envelope: RawResponseEnvelopeV1;
    readonly staleSince: string;
  }
  | { readonly status: "miss" }
  | { readonly status: "corrupt"; readonly quarantinedTo?: string }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheWriteOutcomeForRuntime =
  | { readonly status: "stored" }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type RuntimeRequestMode = "online" | "offline";

/** Policy defaults beside the runtime (issue #8 per-source policy table). */
export const DEFAULT_MAX_CONCURRENT = 2;
export const DEFAULT_MIN_SPACING_MS = 350;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BASE_BACKOFF_MS = 200;
export const DEFAULT_MAX_BACKOFF_MS = 2_000;
export const DEFAULT_SOURCE_BUDGET_MS = 8_000;
export const DEFAULT_MAX_REDIRECTS = 5;
