/**
 * Response-cache port (issue #10 section 8) and shared outcome types.
 *
 * Callers — provider HTTP fetchers, the offline gateway, and CLI cache
 * commands — depend only on this port. The MVP implementation is the private
 * FileEntryStore; a future SQLite implementation provides the same surface.
 */

import type { CacheKey, ProviderId } from "./key.ts";
import type {
  FreshnessClass,
  Instant,
  RawResponseEnvelopeV1,
} from "./envelope.ts";

export type { CacheKey, ProviderId } from "./key.ts";
export type {
  FreshnessClass,
  Instant,
  RawResponseEnvelopeV1,
} from "./envelope.ts";

export type CacheMode = "online" | "offline";

export interface CacheReadOptions {
  readonly mode: CacheMode;
  readonly signal?: AbortSignal;
}

export type CacheReadOutcome =
  | { readonly status: "hit_fresh"; readonly envelope: RawResponseEnvelopeV1 }
  | {
      readonly status: "hit_stale";
      readonly envelope: RawResponseEnvelopeV1;
      readonly staleSince: Instant;
    }
  | { readonly status: "miss" }
  | { readonly status: "corrupt"; readonly quarantinedTo?: string }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheWriteOutcome =
  | { readonly status: "stored" }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheMutationOutcome =
  | { readonly status: "ok" }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export interface CacheEntrySummary {
  readonly digest: string;
  readonly provider: ProviderId;
  readonly url: string;
  readonly status: number;
  readonly freshnessClass: FreshnessClass;
  readonly state: "fresh" | "stale";
  readonly fetchedAt: Instant;
  readonly freshUntil: Instant;
  readonly byteLength: number;
}

export type CacheListOutcome =
  | { readonly status: "ok"; readonly entries: readonly CacheEntrySummary[] }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheShowOutcome =
  | { readonly status: "ok"; readonly entry: RawResponseEnvelopeV1 }
  | { readonly status: "not_found"; readonly digest: string }
  | { readonly status: "corrupt"; readonly quarantinedTo?: string }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheClearOutcome =
  | {
      readonly status: "ok";
      readonly removedEntries: number;
      readonly removedBytes: number;
    }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheReclaimOutcome =
  | { readonly status: "ok"; readonly removedTemps: number }
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" }
  | { readonly status: "cancelled" };

export type CacheRemoveOutcome = CacheMutationOutcome;

export interface ResponseCache {
  read(key: CacheKey, options: CacheReadOptions): Promise<CacheReadOutcome>;
  write(
    key: CacheKey,
    envelope: RawResponseEnvelopeV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CacheWriteOutcome>;
  list(options?: { readonly signal?: AbortSignal }): Promise<CacheListOutcome>;
  show(
    digest: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CacheShowOutcome>;
  remove(
    digest: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CacheRemoveOutcome>;
  clear(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CacheClearOutcome>;
  reclaim(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CacheReclaimOutcome>;
}
