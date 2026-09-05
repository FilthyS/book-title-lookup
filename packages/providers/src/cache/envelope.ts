/**
 * Raw HTTP response envelope (issue #10 sections 7.3 and 11).
 *
 * One file is one versioned JSON entry. Bodies are stored raw as UTF-8 text
 * when they decode as UTF-8, otherwise as base64, so an HTML 404 or any
 * non-UTF-8 payload round-trips without pretending all HTTP is text. Only the
 * allowlisted headers content-type/location/etag/last-modified are promoted.
 * Staleness is never persisted: it is derived at read time from the clock.
 */

import { type CacheKey, type ProviderId, sha256HexUtf8 } from "./key.ts";
import { addMillis, epochMsOf, type Instant, isValidInstant } from "./clock.ts";
export type { Instant } from "./clock.ts";

export type FreshnessClass = "search" | "detail" | "negative";

export type EncodedBody =
  | { readonly encoding: "utf8"; readonly text: string }
  | { readonly encoding: "base64"; readonly base64: string };

export interface RawResponseEnvelopeV1 {
  readonly envelopeVersion: 1;
  readonly key: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly request: {
    readonly provider: ProviderId;
    readonly method: "GET";
    readonly url: string;
    readonly decoderSchemaVersion: number;
  };
  readonly response: {
    readonly status: number;
    readonly contentType?: string;
    readonly location?: string;
    readonly etag?: string;
    readonly lastModified?: string;
    readonly body: EncodedBody;
  };
  readonly freshness: {
    readonly freshnessClass: FreshnessClass;
    readonly negative: boolean;
    readonly fetchedAt: Instant;
    readonly freshUntil: Instant;
  };
}

export const FRESHNESS_TTL_MS: Readonly<Record<FreshnessClass, number>> = {
  search: 24 * 60 * 60 * 1000,
  detail: 7 * 24 * 60 * 60 * 1000,
  negative: 60 * 60 * 1000,
};

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function encodeBodyBytes(body: Uint8Array): EncodedBody {
  try {
    const text = UTF8_DECODER.decode(body);
    return { encoding: "utf8", text };
  } catch {
    // Not valid UTF-8; preserve the exact bytes.
    return { encoding: "base64", base64: bytesToBase64(body) };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeBodyBytes(body: EncodedBody): Uint8Array {
  if (body.encoding === "utf8") {
    return new TextEncoder().encode(body.text);
  }
  return base64ToBytes(body.base64);
}

/** Human/display text for a cached body under `--debug`. */
export function bodyTextOf(body: EncodedBody): string {
  if (body.encoding === "utf8") return body.text;
  return body.base64;
}

export function bodyBytesOf(body: EncodedBody): Uint8Array {
  return decodeBodyBytes(body);
}

export interface EnvelopeInput {
  readonly key: CacheKey;
  readonly decoderSchemaVersion: number;
  readonly status: number;
  readonly contentType?: string;
  readonly location?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly body: Uint8Array;
  readonly freshnessClass: FreshnessClass;
  readonly negative: boolean;
  readonly fetchedAt: Instant;
}

/** Build a well-ordered v1 envelope; freshness is decided at write time. */
export function createEnvelope(input: EnvelopeInput): RawResponseEnvelopeV1 {
  if (!isValidInstant(input.fetchedAt)) {
    throw new RangeError(`invalid fetchedAt: ${input.fetchedAt}`);
  }
  const response: RawResponseEnvelopeV1["response"] = {
    status: input.status,
    ...(input.contentType !== undefined
      ? { contentType: input.contentType }
      : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.etag !== undefined ? { etag: input.etag } : {}),
    ...(input.lastModified !== undefined
      ? { lastModified: input.lastModified }
      : {}),
    body: encodeBodyBytes(input.body),
  };

  return {
    envelopeVersion: 1,
    key: {
      algorithm: "sha256",
      digest: input.key.digest,
    },
    request: {
      provider: input.key.identity.provider,
      method: input.key.identity.method,
      url: input.key.identity.url,
      decoderSchemaVersion: input.decoderSchemaVersion,
    },
    response,
    freshness: {
      freshnessClass: input.freshnessClass,
      negative: input.negative,
      fetchedAt: input.fetchedAt,
      freshUntil: addMillis(
        input.fetchedAt,
        FRESHNESS_TTL_MS[input.freshnessClass],
      ),
    },
  };
}

export function serializeEnvelope(envelope: RawResponseEnvelopeV1): string {
  return JSON.stringify(envelope);
}

export type EnvelopeParseResult =
  | { readonly ok: true; readonly envelope: RawResponseEnvelopeV1 }
  | { readonly ok: false; readonly reason: string };

export function parseEnvelope(json: string): EnvelopeParseResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, reason: "unparseable_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object" };
  }
  const envelope = value as Partial<RawResponseEnvelopeV1>;
  if (envelope.envelopeVersion !== 1) {
    return { ok: false, reason: "unsupported_envelope_version" };
  }
  const body = envelope.response?.body;
  if (!isEncodedBody(body)) {
    return { ok: false, reason: "invalid_body" };
  }
  if (!isEncodedBodyDecodable(body)) {
    return { ok: false, reason: "undecodable_body" };
  }
  if (
    typeof envelope.key?.algorithm !== "string" ||
    typeof envelope.key?.digest !== "string" ||
    typeof envelope.request?.provider !== "string" ||
    envelope.request?.method !== "GET" ||
    typeof envelope.request?.url !== "string" ||
    typeof envelope.request?.decoderSchemaVersion !== "number"
  ) {
    return { ok: false, reason: "invalid_request_shape" };
  }
  const freshness = envelope.freshness;
  if (
    !freshness ||
    (freshness.freshnessClass !== "search" &&
      freshness.freshnessClass !== "detail" &&
      freshness.freshnessClass !== "negative") ||
    typeof freshness.negative !== "boolean" ||
    !isValidInstant(freshness.fetchedAt) ||
    !isValidInstant(freshness.freshUntil) ||
    epochMsOf(freshness.freshUntil) < epochMsOf(freshness.fetchedAt)
  ) {
    return { ok: false, reason: "inconsistent_freshness" };
  }
  return {
    ok: true,
    envelope: value as RawResponseEnvelopeV1,
  };
}

function isEncodedBody(value: unknown): value is EncodedBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as EncodedBody;
  if (body.encoding === "utf8" && typeof body.text === "string") return true;
  if (body.encoding === "base64" && typeof body.base64 === "string") {
    return true;
  }
  return false;
}

function isEncodedBodyDecodable(body: EncodedBody): boolean {
  try {
    if (body.encoding === "utf8") {
      new TextEncoder().encode(body.text);
    } else {
      base64ToBytes(body.base64);
    }
    return true;
  } catch {
    return false;
  }
}

export interface EnvelopeValidationOptions {
  readonly expectedDigest: string;
  readonly decoderSchemaVersions: Readonly<Record<ProviderId, number>>;
}

export type EnvelopeValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Verification performed on every read before anything is returned (issue #10
 * section 11). Any failure is corruption: quarantine and treat as a miss.
 */
export async function validateEnvelopeForRead(
  envelope: RawResponseEnvelopeV1,
  options: EnvelopeValidationOptions,
): Promise<EnvelopeValidationResult> {
  if (envelope.envelopeVersion !== 1) {
    return { ok: false, reason: "unsupported_envelope_version" };
  }
  if (
    envelope.key.algorithm !== "sha256" ||
    envelope.key.digest !== options.expectedDigest
  ) {
    return { ok: false, reason: "digest_mismatch" };
  }
  const current = options.decoderSchemaVersions[envelope.request.provider];
  if (
    current === undefined || envelope.request.decoderSchemaVersion !== current
  ) {
    return { ok: false, reason: "decoder_schema_version" };
  }
  const rehashed = await hashDigestOf(envelope);
  if (rehashed !== options.expectedDigest) {
    return { ok: false, reason: "digest_mismatch" };
  }
  const freshness = envelope.freshness;
  if (
    (freshness.freshnessClass !== "search" &&
      freshness.freshnessClass !== "detail" &&
      freshness.freshnessClass !== "negative") ||
    typeof freshness.negative !== "boolean" ||
    !isValidInstant(freshness.fetchedAt) ||
    !isValidInstant(freshness.freshUntil) ||
    epochMsOf(freshness.freshUntil) < epochMsOf(freshness.fetchedAt)
  ) {
    return { ok: false, reason: "inconsistent_freshness" };
  }
  if (!isEncodedBodyDecodable(envelope.response.body)) {
    return { ok: false, reason: "undecodable_body" };
  }
  return { ok: true };
}

async function hashDigestOf(envelope: RawResponseEnvelopeV1): Promise<string> {
  return await sha256HexUtf8(
    JSON.stringify({
      provider: envelope.request.provider,
      method: envelope.request.method,
      url: envelope.request.url,
    }),
  );
}

export interface EntrySummary {
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

export function summarizeEntry(
  envelope: RawResponseEnvelopeV1,
  now: Instant,
): EntrySummary {
  const stale = epochMsOf(now) >= epochMsOf(envelope.freshness.freshUntil);
  const bodyBytes = bodyBytesOf(envelope.response.body);
  return {
    digest: envelope.key.digest,
    provider: envelope.request.provider,
    url: envelope.request.url,
    status: envelope.response.status,
    freshnessClass: envelope.freshness.freshnessClass,
    state: stale ? "stale" : "fresh",
    fetchedAt: envelope.freshness.fetchedAt,
    freshUntil: envelope.freshness.freshUntil,
    byteLength: bodyBytes.byteLength,
  };
}
