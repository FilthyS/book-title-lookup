import { assertEquals } from "@std/assert";
import {
  type CacheKey,
  type CanonicalRequestIdentity,
  computeCacheKey,
  digestForIdentity,
} from "./key.ts";
import {
  bodyBytesOf,
  bodyTextOf,
  createEnvelope,
  decodeBodyBytes,
  type EncodedBody,
  FRESHNESS_TTL_MS,
  parseEnvelope,
  type RawResponseEnvelopeV1,
  serializeEnvelope,
  summarizeEntry,
  validateEnvelopeForRead,
} from "./envelope.ts";

const utf8 = new TextEncoder();

const URL = "https://openlibrary.org/works/OL274505W.json?fields=title";

async function makeKey(digest?: string): Promise<CacheKey> {
  const identity: CanonicalRequestIdentity = {
    provider: "openlibrary",
    method: "GET",
    url: URL,
  };
  return {
    algorithm: "sha256",
    digest: digest ?? (await digestForIdentity(identity)),
    identity,
  };
}

const DECODER_VERSIONS = { openlibrary: 1, wikidata: 1 } as const;

async function validEnvelope(
  options: {
    readonly digest?: string;
    readonly decoderSchemaVersion?: number;
    readonly status?: number;
    readonly fetchedAt?: string;
    readonly freshnessClass?: "search" | "detail" | "negative";
    readonly body?: Uint8Array;
  } = {},
): Promise<RawResponseEnvelopeV1> {
  const key = await makeKey(options.digest);
  return createEnvelope({
    key,
    decoderSchemaVersion: options.decoderSchemaVersion ?? 1,
    status: options.status ?? 200,
    contentType: "application/json",
    body: options.body ?? utf8.encode("{}"),
    freshnessClass: options.freshnessClass ?? "search",
    negative: false,
    fetchedAt: options.fetchedAt ?? "2026-09-05T12:34:56.789Z",
  });
}

async function validate(
  envelope: RawResponseEnvelopeV1,
  expectedDigest?: string,
) {
  return await validateEnvelopeForRead(envelope, {
    expectedDigest: expectedDigest ?? (await makeKey()).digest,
    decoderSchemaVersions: DECODER_VERSIONS,
  });
}

Deno.test("cache/envelope freshUntil is decided at write by freshness class", async () => {
  const fetchedAt = "2026-09-05T12:34:56.789Z";
  const key = await makeKey();
  const search = createEnvelope({
    key,
    decoderSchemaVersion: 1,
    status: 200,
    contentType: "application/json",
    body: utf8.encode("{}"),
    freshnessClass: "search",
    negative: false,
    fetchedAt,
  });
  const detail = createEnvelope({
    key,
    decoderSchemaVersion: 1,
    status: 200,
    contentType: "application/json",
    body: utf8.encode("{}"),
    freshnessClass: "detail",
    negative: false,
    fetchedAt,
  });
  const negative = createEnvelope({
    key,
    decoderSchemaVersion: 1,
    status: 200,
    contentType: "application/json",
    body: utf8.encode("{}"),
    freshnessClass: "negative",
    negative: false,
    fetchedAt,
  });
  assertEquals(FRESHNESS_TTL_MS.search, 24 * 60 * 60 * 1000);
  assertEquals(FRESHNESS_TTL_MS.detail, 7 * 24 * 60 * 60 * 1000);
  assertEquals(FRESHNESS_TTL_MS.negative, 60 * 60 * 1000);
  assertEquals(search.freshness.freshUntil, "2026-09-06T12:34:56.789Z");
  assertEquals(detail.freshness.freshUntil, "2026-09-12T12:34:56.789Z");
  assertEquals(negative.freshness.freshUntil, "2026-09-05T13:34:56.789Z");
});

Deno.test("cache/envelope utf8 body round-trips and stays raw", async () => {
  const payload = utf8.encode('{"docs":[]}');
  const envelope = await validEnvelope({ body: payload });
  assertEquals(envelope.response.body, {
    encoding: "utf8",
    text: '{"docs":[]}',
  });
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assertEquals(parsed.ok, true);
  if (parsed.ok) {
    const roundTrip = parsed.envelope;
    assertEquals(roundTrip.freshness.freshUntil, envelope.freshness.freshUntil);
    assertEquals(bodyBytesOf(roundTrip.response.body), payload);
    assertEquals(bodyTextOf(roundTrip.response.body), '{"docs":[]}');
  }
});

Deno.test("cache/envelope non-utf8 bytes store as base64 without pretending text", async () => {
  const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x41]);
  const envelope = await validEnvelope({ body: bytes });
  assertEquals(envelope.response.body.encoding, "base64");
  assertEquals(decodeBodyBytes(envelope.response.body), bytes);
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assertEquals(parsed.ok, true);
  if (parsed.ok) {
    assertEquals(decodeBodyBytes(parsed.envelope.response.body), bytes);
  }
});

Deno.test("cache/envelope preserves only the allowlisted headers", async () => {
  const key = await makeKey();
  const envelope = createEnvelope({
    key,
    decoderSchemaVersion: 1,
    status: 302,
    location: "https://openlibrary.org/books/OL274507M.json",
    etag: '"abc"',
    lastModified: "Tue, 01 Sep 2026 12:00:00 GMT",
    body: utf8.encode(""),
    freshnessClass: "detail",
    negative: false,
    fetchedAt: "2026-09-05T12:34:56.789Z",
  });
  assertEquals(
    envelope.response.location,
    "https://openlibrary.org/books/OL274507M.json",
  );
  assertEquals(envelope.response.etag, '"abc"');
  assertEquals(envelope.response.lastModified, "Tue, 01 Sep 2026 12:00:00 GMT");
  assertEquals("authorization" in envelope.response, false);
});

Deno.test("cache/envelope a valid envelope validates clean", async () => {
  const envelope = await validEnvelope();
  const result = await validate(envelope, envelope.key.digest);
  assertEquals(result, { ok: true });
});

Deno.test("cache/envelope validation rejects digest mismatch as corruption", async () => {
  const envelope = await validEnvelope();
  const result = await validate(envelope, "b".repeat(64));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "digest_mismatch");
});

Deno.test("cache/envelope validation rejects wrong decoder schema version", async () => {
  const envelope = await validEnvelope({ decoderSchemaVersion: 1 });
  const result = await validateEnvelopeForRead(envelope, {
    expectedDigest: envelope.key.digest,
    decoderSchemaVersions: { openlibrary: 2, wikidata: 1 },
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "decoder_schema_version");
});

Deno.test("cache/envelope validation rejects unsupported envelope version", async () => {
  const envelope = await validEnvelope();
  const broken = {
    ...envelope,
    envelopeVersion: 2,
  } as unknown as RawResponseEnvelopeV1;
  const result = await validate(broken, envelope.key.digest);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "unsupported_envelope_version");
});

Deno.test("cache/envelope validation rejects inconsistent freshness fields", async () => {
  const envelope = await validEnvelope();
  const broken = {
    ...envelope,
    freshness: {
      ...envelope.freshness,
      freshUntil: "2026-09-04T12:34:56.789Z", // before fetchedAt
    },
  };
  const result = await validate(broken, envelope.key.digest);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "inconsistent_freshness");
});

Deno.test("cache/envelope validation rejects undecodable base64 body", async () => {
  const envelope = await validEnvelope();
  const broken = {
    ...envelope,
    response: {
      ...envelope.response,
      body: { encoding: "base64", base64: "not!base64" } as EncodedBody,
    },
  };
  const result = await validate(broken, envelope.key.digest);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "undecodable_body");
});

Deno.test("cache/envelope parse rejects garbage and accepts valid JSON", async () => {
  assertEquals(parseEnvelope("not json").ok, false);
  const envelope = await validEnvelope();
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assertEquals(parsed.ok, true);
});

Deno.test("cache/envelope summary state is derived, never persisted stale", async () => {
  const envelope = await validEnvelope();
  assertEquals(
    summarizeEntry(envelope, "2026-09-05T18:00:00.000Z").state,
    "fresh",
  );
  assertEquals(
    summarizeEntry(envelope, "2026-09-06T13:00:00.000Z").state,
    "stale",
  );
  assertEquals(
    summarizeEntry(envelope, "2026-09-06T13:00:00.000Z").byteLength,
    2,
  );
});

Deno.test("cache/key computeCacheKey is usable to write a matching envelope", async () => {
  const key = await computeCacheKey("openlibrary", URL);
  const envelope = await validEnvelope({ digest: key.digest });
  const result = await validate(envelope, key.digest);
  assertEquals(result, { ok: true });
});
