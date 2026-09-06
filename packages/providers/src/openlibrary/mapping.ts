/**
 * Open Library -> Core SourceRecord mapping (issue #7 mapping rules, research
 * #1 "Fields by concern"). Mapping preserves provenance and turns decoded
 * endpoint facts into the Core evidence vocabulary; raw upstream JSON never
 * crosses this boundary.
 *
 * Mapping rules:
 * - Edition title/subtitle on an Edition connected by works[].key become
 *   edition-level title/subtitle claims (attestation candidates).
 * - Edition `languages` become content-language claims only when recorded.
 * - `translation_of`, `work_titles`, and `other_titles` become
 *   `original-title` clue claims (never attestations).
 * - `translated_from` becomes translated-from clues.
 * - ISBNs become identifier claims normalized with `canonicalizeIsbn`.
 * - Work search docs carry author names; Work/Edition record JSON carries
 *   author keys only and therefore contributes no author-name claim here.
 */

import type { Claim, SourceRecord } from "../../../core/src/evidence.ts";
import type {
  ExternalReference,
  ExternalReferenceNamespace,
} from "../../../core/src/domain.ts";
import {
  canonicalizeIsbn,
  canonicalizeLang,
} from "../../../core/src/normalize.ts";
import type { OlEditionEntry, OlRecordValue, OlSearchDoc } from "./decoders.ts";

export interface MapSourceContext {
  readonly sourceRecordUrl: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
}

function reference(
  ns: ExternalReferenceNamespace,
  value: string,
): ExternalReference {
  return { namespace: ns, value };
}

function recordKeyValue(key: string): string {
  const lastSlash = key.lastIndexOf("/");
  return lastSlash === -1 ? key : key.slice(lastSlash + 1);
}

function marcLanguageClaims(keys: readonly string[]): Claim[] {
  const out: Claim[] = [];
  for (const key of keys) {
    const code = recordKeyValue(key);
    const language = canonicalizeLang(code);
    if (language === "und" || language === "mul") continue;
    out.push({ type: "content-language", language });
  }
  return out;
}

function marcCodeClaims(keys: readonly string[]): Claim[] {
  const out: Claim[] = [];
  for (const key of keys) {
    const language = canonicalizeLang(recordKeyValue(key));
    if (language !== "und" && language !== "mul") {
      out.push({ type: "content-language", language });
    }
  }
  return out;
}

/** Content-language claims from a Work search doc's MARC `language` array. */
function searchLanguageClaims(codes: readonly string[]): Claim[] {
  const out: Claim[] = [];
  for (const code of codes) {
    const language = canonicalizeLang(code);
    if (language !== "und" && language !== "mul") {
      out.push({ type: "content-language", language });
    }
  }
  return out;
}

function isbnClaims(
  isbn10: readonly string[],
  isbn13: readonly string[],
): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const value = canonicalizeIsbn(raw);
    if (value === "" || seen.has(value)) return;
    seen.add(value);
    out.push({ type: "identifier", namespace: "isbn", value });
  };
  for (const raw of isbn10) push(raw);
  for (const raw of isbn13) push(raw);
  return out;
}

function originalTitleClaims(record: OlRecordValue): Claim[] {
  const out: Claim[] = [];
  if (
    record.translationOf !== undefined &&
    record.translationOf.trim() !== ""
  ) {
    out.push({
      type: "original-title",
      text: record.translationOf.trim(),
      language: "und",
      kind: "translation_of",
    });
  }
  for (const text of record.workTitles) {
    if (text.trim() !== "") {
      out.push({
        type: "original-title",
        text: text.trim(),
        language: "und",
        kind: "work_titles",
      });
    }
  }
  for (const text of record.otherTitles) {
    if (text.trim() !== "") {
      out.push({
        type: "original-title",
        text: text.trim(),
        language: "und",
        kind: "other_titles",
      });
    }
  }
  return out;
}

function translatedFromClaims(keys: readonly string[]): Claim[] {
  const out: Claim[] = [];
  for (const key of keys) {
    const language = canonicalizeLang(recordKeyValue(key));
    if (language !== "und" && language !== "mul") {
      out.push({ type: "translated-from", language });
    }
  }
  return out;
}

function yearFromPublishDate(
  publishDate: string | undefined,
): number | undefined {
  if (publishDate === undefined) return undefined;
  const trimmed = publishDate.trim();
  const plainYear = /^[0-9]{4}$/.test(trimmed);
  if (plainYear) return Number(trimmed);
  const match = trimmed.match(/(19|20)[0-9]{2}/);
  return match === null ? undefined : Number(match[0]);
}

export function recordRefsOf(record: OlRecordValue): ExternalReference[] {
  if (record.kind === "edition") {
    return [reference("openlibrary:edition", recordKeyValue(record.key))];
  }
  return [reference("openlibrary:work", recordKeyValue(record.key))];
}

/** Map a decoded Open Library Work/Edition record to a Core SourceRecord. */
export function mapOlRecord(
  record: OlRecordValue,
  context: MapSourceContext,
): SourceRecord {
  const claims: Claim[] = [];
  if (record.title !== undefined && record.title.trim() !== "") {
    claims.push({ type: "title", text: record.title.trim() });
  }
  if (record.subtitle !== undefined && record.subtitle.trim() !== "") {
    claims.push({ type: "subtitle", text: record.subtitle.trim() });
  }
  if (record.kind === "edition") {
    claims.push(...marcLanguageClaims(record.languages));
    for (const workKey of record.works) {
      claims.push({
        type: "work-link",
        reference: reference("openlibrary:work", recordKeyValue(workKey)),
      });
    }
    claims.push(...originalTitleClaims(record));
    claims.push(...translatedFromClaims(record.translatedFrom));
    claims.push(...isbnClaims(record.isbn10, record.isbn13));
    for (const publisher of record.publishers) {
      if (publisher.trim() !== "") {
        claims.push({ type: "publisher", name: publisher.trim() });
      }
    }
    const year = yearFromPublishDate(record.publishDate);
    if (year !== undefined) {
      claims.push({ type: "publication-year", year });
    }
  } else {
    claims.push(...marcCodeClaims(record.languages));
  }
  return {
    source: "openlibrary",
    sourceRecordUrl: context.sourceRecordUrl,
    fetchedAt: context.fetchedAt,
    stale: context.stale,
    kind: record.kind,
    refs: recordRefsOf(record),
    claims,
  };
}

/** Map an Editions-page entry (identical to an Edition record). */
export function mapEditionEntry(
  entry: OlEditionEntry,
  context: MapSourceContext,
): SourceRecord {
  return mapOlRecord(entry, context);
}

/** Map one `/search.json` Work doc to a Core SourceRecord (kind work). */
export function mapSearchDoc(
  doc: OlSearchDoc,
  context: MapSourceContext,
): SourceRecord {
  const claims: Claim[] = [];
  if (doc.title !== undefined && doc.title.trim() !== "") {
    claims.push({ type: "title", text: doc.title.trim() });
  }
  if (doc.subtitle !== undefined && doc.subtitle.trim() !== "") {
    claims.push({ type: "subtitle", text: doc.subtitle.trim() });
  }
  claims.push(...searchLanguageClaims(doc.languages));
  for (const name of doc.authorNames) {
    if (name.trim() !== "") {
      claims.push({ type: "author", name: name.trim() });
    }
  }
  if (doc.firstPublishYear !== undefined) {
    claims.push({ type: "publication-year", year: doc.firstPublishYear });
  }
  return {
    source: "openlibrary",
    sourceRecordUrl: context.sourceRecordUrl,
    fetchedAt: context.fetchedAt,
    stale: context.stale,
    kind: "work",
    refs: [reference("openlibrary:work", recordKeyValue(doc.key))],
    claims,
  };
}

/** Search aliases carried by a Work doc (never title attestations). */
export function matchedAliasesOf(doc: OlSearchDoc): readonly {
  readonly text: string;
  readonly language?: string;
}[] {
  const out: { readonly text: string; readonly language?: string }[] = [];
  for (const text of doc.alternativeTitles) {
    if (text.trim() !== "") {
      out.push({ text: text.trim() });
    }
  }
  return out;
}
