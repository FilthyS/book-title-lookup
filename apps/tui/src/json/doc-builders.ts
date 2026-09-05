/**
 * JSON document builders for the issue #32 maintenance surface.
 *
 * Every builder returns an object whose key order is the exact order listed
 * in issue #12 sections 8.4/8.5 (plus 8.1 cancelled shapes), so the compact
 * serializer never reorders a document. `schemaVersion` is always first.
 */

import type { ResolvedSettings } from "../settings/resolver.ts";
import type {
  CacheEntrySummary,
} from "../../../../packages/providers/src/cache/store.ts";
import type {
  RawResponseEnvelopeV1,
} from "../../../../packages/providers/src/cache/envelope.ts";
import { CLI_JSON_SCHEMA_VERSION } from "./serialize.ts";

export interface ConfigShowDocument {
  readonly schemaVersion: "cli-json.v1";
  readonly command: "config";
  readonly operation: "show";
  readonly status: "ok";
  readonly settings: {
    readonly configRoot: string;
    readonly cacheRoot: string;
    readonly offline: boolean;
    readonly logLevel: string;
    readonly contact?: string;
  };
  readonly sources: {
    readonly offline: string;
    readonly logLevel: string;
    readonly contact: string;
    readonly cacheRoot: string;
  };
}

export interface CacheListDocument {
  readonly schemaVersion: "cli-json.v1";
  readonly command: "cache";
  readonly operation: "list";
  readonly status: "ok";
  readonly entries: readonly CacheEntrySummary[];
}

export interface CacheShowDocument {
  readonly schemaVersion: "cli-json.v1";
  readonly command: "cache";
  readonly operation: "show";
  readonly status: "ok";
  readonly digest: string;
  readonly entry: object;
}

export interface CacheClearDocument {
  readonly schemaVersion: "cli-json.v1";
  readonly command: "cache";
  readonly operation: "clear";
  readonly status: "ok";
  readonly removedEntries: number;
  readonly removedBytes: number;
}

export type CacheOperation = "list" | "show" | "clear";

export interface CancelledDocument {
  readonly schemaVersion: "cli-json.v1";
  readonly command: "cache" | "config";
  readonly operation?: CacheOperation;
  readonly status: "cancelled";
}

export function configShowDocument(
  settings: ResolvedSettings,
): ConfigShowDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "config",
    operation: "show",
    status: "ok",
    settings: {
      configRoot: settings.configRoot,
      cacheRoot: settings.cacheRoot,
      offline: settings.offline,
      logLevel: settings.logLevel,
      ...(settings.contact !== undefined ? { contact: settings.contact } : {}),
    },
    sources: {
      offline: settings.sources.offline,
      logLevel: settings.sources.logLevel,
      contact: settings.sources.contact,
      cacheRoot: settings.sources.cacheRoot,
    },
  };
}

export function cacheListDocument(
  entries: readonly CacheEntrySummary[],
): CacheListDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "cache",
    operation: "list",
    status: "ok",
    entries: entries.map((entry) => ({
      digest: entry.digest,
      provider: entry.provider,
      url: entry.url,
      status: entry.status,
      freshnessClass: entry.freshnessClass,
      state: entry.state,
      fetchedAt: entry.fetchedAt,
      freshUntil: entry.freshUntil,
      byteLength: entry.byteLength,
    })),
  };
}

export function cacheShowDocument(
  digest: string,
  envelope: RawResponseEnvelopeV1,
  includeBody: boolean,
): CacheShowDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "cache",
    operation: "show",
    status: "ok",
    digest,
    entry: cacheShowEntryForDocument(envelope, includeBody),
  };
}

/**
 * Rebuild the stored envelope with the issue #10 key order so `--debug`
 * controls body inclusion without ever leaking the raw body by default.
 */
export function cacheShowEntryForDocument(
  envelope: RawResponseEnvelopeV1,
  includeBody: boolean,
): object {
  return {
    envelopeVersion: envelope.envelopeVersion,
    key: {
      algorithm: envelope.key.algorithm,
      digest: envelope.key.digest,
    },
    request: {
      provider: envelope.request.provider,
      method: envelope.request.method,
      url: envelope.request.url,
      decoderSchemaVersion: envelope.request.decoderSchemaVersion,
    },
    response: responseForDocument(envelope.response, includeBody),
    freshness: {
      freshnessClass: envelope.freshness.freshnessClass,
      negative: envelope.freshness.negative,
      fetchedAt: envelope.freshness.fetchedAt,
      freshUntil: envelope.freshness.freshUntil,
    },
  };
}

function responseForDocument(
  response: RawResponseEnvelopeV1["response"],
  includeBody: boolean,
): object {
  return {
    status: response.status,
    ...(response.contentType !== undefined
      ? { contentType: response.contentType }
      : {}),
    ...(response.location !== undefined ? { location: response.location } : {}),
    ...(response.etag !== undefined ? { etag: response.etag } : {}),
    ...(response.lastModified !== undefined
      ? { lastModified: response.lastModified }
      : {}),
    ...(includeBody ? { body: response.body } : {}),
  };
}

export function cacheClearDocument(
  removedEntries: number,
  removedBytes: number,
): CacheClearDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "cache",
    operation: "clear",
    status: "ok",
    removedEntries,
    removedBytes,
  };
}

export function cacheCancelledDocument(
  operation: CacheOperation,
): CancelledDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "cache",
    operation,
    status: "cancelled",
  };
}

export function configCancelledDocument(): CancelledDocument {
  return {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "config",
    operation: "show",
    status: "cancelled",
  };
}
