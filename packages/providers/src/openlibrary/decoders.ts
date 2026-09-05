/**
 * Tolerant Open Library endpoint decoders (research #1, issue #8 section 6).
 *
 * Decoders require only the identity and type invariants an endpoint must
 * satisfy, ignore unknown fields, and never let raw upstream JSON cross into
 * Core. Required invariants: Search docs must carry a Work `key`; Work and
 * Edition records must carry `key` and a `type.key` of `/type/work`,
 * `/type/edition`, or `/type/redirect`; Editions entries must carry a key and
 * `/type/edition`. Everything else is tolerant: absent, null, or
 * wrong-typed non-core facts degrade to absent.
 */

import type { DecodeResult, TransportEnvelope } from "../runtime/types.ts";
import { parseJsonEnvelope } from "../decode/json.ts";
import {
  asNumber,
  asOptionalString,
  asRecord,
  asStringArray,
  keysOfRefArray,
  typeKeyOfRecord,
} from "../decode/struct.ts";

// ---------------------------------------------------------------------------
// Endpoint value shapes
// ---------------------------------------------------------------------------

export interface OlSearchDoc {
  readonly key: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly authorNames: readonly string[];
  readonly authorKeys: readonly string[];
  readonly firstPublishYear?: number;
  readonly editionCount?: number;
  readonly editionKeys: readonly string[];
  readonly languages: readonly string[];
  readonly alternativeTitles: readonly string[];
}

export interface OlSearchResultValue {
  readonly numFound: number;
  readonly docs: readonly OlSearchDoc[];
}

export type OlRecordKind = "work" | "edition";

export interface OlRecordValue {
  readonly key: string;
  readonly kind: OlRecordKind;
  readonly title?: string;
  readonly subtitle?: string;
  readonly works: readonly string[];
  readonly languages: readonly string[];
  readonly translatedFrom: readonly string[];
  readonly translationOf?: string;
  readonly workTitles: readonly string[];
  readonly otherTitles: readonly string[];
  readonly authorKeys: readonly string[];
  readonly isbn10: readonly string[];
  readonly isbn13: readonly string[];
  readonly publishDate?: string;
  readonly publishers: readonly string[];
  readonly numberOfPages?: number;
}

export interface OlRedirectValue {
  readonly kind: "redirect";
  readonly key: string;
  readonly location: string;
}

export type OlRecordData = OlRecordValue | OlRedirectValue;

export interface OlEditionEntry extends OlRecordValue {}

export interface OlEditionsPageValue {
  readonly size: number;
  readonly entries: readonly OlEditionEntry[];
  /** Path of the next page link, e.g. `/works/OL1W/editions.json?offset=2`. */
  readonly nextPath?: string;
}

// ---------------------------------------------------------------------------
// Search decode
// ---------------------------------------------------------------------------

function parseSearchDoc(raw: unknown): OlSearchDoc | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const key = asOptionalString(record.key);
  if (key === undefined || key.trim() === "") return undefined;
  const doc: OlSearchDoc = {
    key,
    ...(asOptionalString(record.title) !== undefined
      ? { title: asOptionalString(record.title) }
      : {}),
    ...(asOptionalString(record.subtitle) !== undefined
      ? { subtitle: asOptionalString(record.subtitle) }
      : {}),
    authorNames: asStringArray(record.author_name) ?? [],
    authorKeys: asStringArray(record.author_key) ?? [],
    ...(asNumber(record.first_publish_year) !== undefined
      ? { firstPublishYear: asNumber(record.first_publish_year) }
      : {}),
    ...(asNumber(record.edition_count) !== undefined
      ? { editionCount: asNumber(record.edition_count) }
      : {}),
    editionKeys: asStringArray(record.edition_key) ?? [],
    languages: asStringArray(record.language) ?? [],
    alternativeTitles: [
      ...(asStringArray(record.alternative_title) ?? []),
      ...(asStringArray(record.alternative_subtitle) ?? []),
    ],
  };
  return doc;
}

/** `/search.json` search envelope decoder. */
export function decodeSearchEnvelope(
  env: TransportEnvelope,
): DecodeResult<OlSearchResultValue> {
  if (isHtmlNegative(env)) return { kind: "no_record" };
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "search body is not an object" };
  }
  const numFound = asNumber(root.numFound);
  if (numFound === undefined) {
    return { kind: "malformed", detail: "search body lacks numFound" };
  }
  if (!Array.isArray(root.docs)) {
    return { kind: "malformed", detail: "search body lacks docs array" };
  }
  const docs: OlSearchDoc[] = [];
  for (const raw of root.docs) {
    const doc = parseSearchDoc(raw);
    if (doc !== undefined) docs.push(doc);
  }
  return {
    kind: "data",
    value: { numFound, docs },
    negative: numFound === 0 && docs.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Record and editions decode
// ---------------------------------------------------------------------------

function isHtmlNegative(env: TransportEnvelope): boolean {
  if (env.status !== 404 && env.status !== 410) return false;
  const lower = env.contentType?.toLowerCase() ?? "";
  return lower.includes("text/html") || lower.includes("text/plain");
}

function parseRedirect(
  raw: Record<string, unknown>,
): OlRedirectValue | undefined {
  const key = asOptionalString(raw.key);
  const location = asOptionalString(raw.location);
  if (key === undefined || location === undefined) return undefined;
  return { kind: "redirect", key, location };
}

function parseRecordValue(
  raw: Record<string, unknown>,
  kind: OlRecordKind,
): OlRecordValue | undefined {
  const key = asOptionalString(raw.key);
  if (key === undefined) return undefined;
  const typeKey = typeKeyOfRecord(raw);
  if (kind === "work" && typeKey !== "/type/work") return undefined;
  if (kind === "edition" && typeKey !== "/type/edition") return undefined;
  const record: OlRecordValue = {
    key,
    kind,
    works: keysOfRefArray(raw.works) ?? [],
    languages: keysOfRefArray(raw.languages) ?? [],
    translatedFrom: keysOfRefArray(raw.translated_from) ?? [],
    workTitles: asStringArray(raw.work_titles) ?? [],
    otherTitles: asStringArray(raw.other_titles) ?? [],
    authorKeys: keysOfRefArray(raw.authors) ?? [],
    isbn10: asStringArray(raw.isbn_10) ?? [],
    isbn13: asStringArray(raw.isbn_13) ?? [],
    publishers: asStringArray(raw.publishers) ?? [],
    ...(asOptionalString(raw.title) !== undefined
      ? { title: asOptionalString(raw.title) }
      : {}),
    ...(asOptionalString(raw.subtitle) !== undefined
      ? { subtitle: asOptionalString(raw.subtitle) }
      : {}),
    ...(asOptionalString(raw.translation_of) !== undefined
      ? { translationOf: asOptionalString(raw.translation_of) }
      : {}),
    ...(asOptionalString(raw.publish_date) !== undefined
      ? { publishDate: asOptionalString(raw.publish_date) }
      : {}),
    ...(asNumber(raw.number_of_pages) !== undefined
      ? { numberOfPages: asNumber(raw.number_of_pages) }
      : {}),
  };
  return record;
}

/** `/works/{key}.json`, `/books/{key}.json`, and `/isbn/{isbn}.json`
 *  envelope decoder. Detects `/type/redirect` JSON records. */
export function decodeRecordEnvelope(
  env: TransportEnvelope,
): DecodeResult<OlRecordData> {
  if (isHtmlNegative(env)) return { kind: "no_record" };
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "record body is not an object" };
  }
  const key = asOptionalString(root.key);
  if (key === undefined) {
    return { kind: "malformed", detail: "record body lacks key" };
  }
  if (asOptionalString(root.error) !== undefined) {
    // Structured JSON not-found, e.g. {"error":"notfound"}.
    return { kind: "no_record" };
  }
  const typeKey = typeKeyOfRecord(root);
  if (typeKey === "/type/redirect") {
    const redirect = parseRedirect(root);
    if (redirect === undefined) {
      return { kind: "malformed", detail: "redirect record lacks location" };
    }
    return { kind: "data", value: redirect };
  }
  if (typeKey === "/type/work") {
    const record = parseRecordValue(root, "work");
    if (record === undefined) {
      return { kind: "malformed", detail: "work record shape invalid" };
    }
    return { kind: "data", value: record };
  }
  if (typeKey === "/type/edition") {
    const record = parseRecordValue(root, "edition");
    if (record === undefined) {
      return { kind: "malformed", detail: "edition record shape invalid" };
    }
    return { kind: "data", value: record };
  }
  return { kind: "malformed", detail: "unsupported record type" };
}

function parseEditionEntry(raw: unknown): OlEditionEntry | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  return parseRecordValue(record, "edition");
}

/** `/works/{key}/editions.json` page envelope decoder. */
export function decodeEditionsPageEnvelope(
  env: TransportEnvelope,
): DecodeResult<OlEditionsPageValue> {
  if (isHtmlNegative(env)) return { kind: "no_record" };
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "editions page is not an object" };
  }
  const size = asNumber(root.size);
  if (size === undefined || !Array.isArray(root.entries)) {
    return { kind: "malformed", detail: "editions page shape invalid" };
  }
  const entries: OlEditionEntry[] = [];
  for (const raw of root.entries) {
    const entry = parseEditionEntry(raw);
    if (entry !== undefined) entries.push(entry);
  }
  let nextPath: string | undefined;
  const links = asRecord(root.links);
  if (links !== undefined) {
    const next = asOptionalString(links.next);
    if (next !== undefined && next.trim() !== "") nextPath = next.trim();
  }
  return {
    kind: "data",
    value: { size, entries, ...(nextPath ? { nextPath } : {}) },
  };
}
