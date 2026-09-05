/**
 * Acceptance-corpus fixtures for the issue #7 corpus scenarios and the issue
 * #12/#13 fixture-backed CLI runs.
 *
 * Every value here is a fixed snapshot (fetched 2026-09-05). Live catalog
 * values are never test assertions; these records are. The corpus is plain
 * TypeScript data so the module-level fake and Core tests share the same
 * fixed inputs without filesystem access at runtime.
 */

import type { ExternalReference, SourceFailure } from "../../packages/core/src/domain.ts";
import type { SourceRecord, Claim } from "../../packages/core/src/evidence.ts";

export const FIXED_AT = "2026-09-05T12:34:56.789Z";

export function ref(
  namespace: ExternalReference["namespace"],
  value: string,
): ExternalReference {
  return { namespace, value };
}

export const OL_WORK = ref("openlibrary:work", "OL274505W");
export const OL_ED_ES = ref("openlibrary:edition", "OL274507M");
export const OL_ED_ZH_LATIN = ref("openlibrary:edition", "OL59138652M");
export const OL_ED_ZH_DETACHED = ref("openlibrary:edition", "OL43416865M");
export const OL_ISO_WORK = ref("openlibrary:work", "OL43416865W");
export const WD_Q178869 = ref("wikidata:item", "Q178869");

export const OL_XWZ_WORK = ref("openlibrary:work", "OL10263W");
export const OL_XWZ_ED_YUE = ref("openlibrary:edition", "OL49205424M");
export const OL_XWZ_ED_UND = ref("openlibrary:edition", "OL49205423M");
export const OL_XWZ_ISO_WORK = ref("openlibrary:work", "OL49205421W");
export const OL_XWZ_ED_ISO = ref("openlibrary:edition", "OL49205422M");

export const WD_HZ_WORK = ref("wikidata:item", "Q151919");
export const WD_HZ_ED_EN = ref("wikidata:item", "Q125131191");
export const WD_HZ_ED_ZH = ref("wikidata:item", "Q1100000001");

export const ISBN_PRINCIPAL = "9780140328721";
export const ISBN_DUP = "9787544253994";

interface RecordInput {
  readonly source: "openlibrary" | "wikidata";
  readonly url: string;
  readonly kind: SourceRecord["kind"];
  readonly refs: readonly ExternalReference[];
  readonly claims: readonly Claim[];
  readonly stale?: boolean;
}

function record(input: RecordInput): SourceRecord {
  return {
    source: input.source,
    sourceRecordUrl: input.url,
    fetchedAt: FIXED_AT,
    stale: input.stale ?? false,
    kind: input.kind,
    refs: input.refs,
    claims: input.claims,
  };
}

// ---------------------------------------------------------------------------
// 百年孤独 records
// ---------------------------------------------------------------------------

/** Principal Work: OL274505W (Cien años de soledad, es). */
export const OL274505W_WORK: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/works/OL274505W.json",
  kind: "work",
  refs: [OL_WORK],
  claims: [
    { type: "title", text: "Cien años de soledad", language: "es" },
    { type: "content-language", language: "es" },
    { type: "author", name: "Gabriel García Márquez" },
    { type: "publication-year", year: 1967 },
  ],
});

/** Wikidata identity for the principal Work (P648 -> OL274505W). */
export const Q178869_WORK: SourceRecord = record({
  source: "wikidata",
  url: "https://www.wikidata.org/wiki/Special:EntityData/Q178869.json",
  kind: "work",
  refs: [WD_Q178869],
  claims: [
    { type: "class", value: "wikidata:property:Q7725634" },
    {
      type: "title",
      text: "Cien años de soledad",
      language: "es",
      statementId: "Q178869-1",
      rank: "normal",
    },
    { type: "content-language", language: "es" },
    { type: "identifier", namespace: "openlibrary:work", value: "OL274505W" },
    { type: "author", name: "Gabriel García Márquez" },
  ],
});

/** Spanish qualifying Edition of the principal Work. */
export const OL274507M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL274507M.json",
  kind: "edition",
  refs: [OL_ED_ES],
  claims: [
    { type: "title", text: "Cien años de soledad", language: "es" },
    { type: "content-language", language: "es" },
    { type: "work-link", reference: OL_WORK },
    { type: "publisher", name: "Sudamericana" },
    { type: "publication-year", year: 1967 },
    { type: "identifier", namespace: "isbn", value: ISBN_PRINCIPAL },
  ],
});

/** Chinese romanized qualifying Edition of the principal Work. */
export const OL59138652M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL59138652M.json",
  kind: "edition",
  refs: [OL_ED_ZH_LATIN],
  claims: [
    { type: "title", text: "Bai nian gu du", language: "zh" },
    { type: "content-language", language: "zh" },
    { type: "work-link", reference: OL_WORK },
    { type: "publisher", name: "Shanghai yi wen" },
    { type: "publication-year", year: 1984 },
  ],
});

/** Detached Chinese Edition surfaced under the principal Work during title
 *  expansion. Its direct Work relation points at the isolated Work. */
export const OL43416865M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL43416865M.json",
  kind: "edition",
  refs: [OL_ED_ZH_DETACHED],
  claims: [
    { type: "title", text: "百年孤独", language: "zh" },
    { type: "content-language", language: "zh" },
    { type: "work-link", reference: OL_ISO_WORK },
    { type: "translated-from", language: "es" },
    {
      type: "original-title",
      text: "Cien años de soledad",
      language: "es",
      kind: "translation_of",
    },
    { type: "author", name: "Gabriel García Márquez" },
    { type: "publisher", name: "Yi lin chu ban she" },
    { type: "publication-year", year: 2011 },
  ],
});

/** The isolated Work that the detached Chinese Edition directly names. */
export const OL43416865W_WORK: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/works/OL43416865W.json",
  kind: "work",
  refs: [OL_ISO_WORK],
  claims: [
    { type: "title", text: "百年孤独", language: "zh" },
    { type: "content-language", language: "zh" },
    {
      type: "original-title",
      text: "Cien años de soledad",
      language: "es",
      kind: "work_titles",
    },
    { type: "author", name: "Gabriel García Márquez" },
    { type: "publication-year", year: 2011 },
  ],
});

// ---------------------------------------------------------------------------
// 小王子 records
// ---------------------------------------------------------------------------

/** Principal Work for 小王子. */
export const OL10263W_WORK: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/works/OL10263W.json",
  kind: "work",
  refs: [OL_XWZ_WORK],
  claims: [
    { type: "title", text: "小王子", language: "zh" },
    { type: "content-language", language: "zh" },
    { type: "author", name: "Antoine de Saint-Exupéry" },
    { type: "publication-year", year: 1943 },
  ],
});

/** Cantonese (yue) Edition attached to the principal Work. */
export const OL49205424M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL49205424M.json",
  kind: "edition",
  refs: [OL_XWZ_ED_YUE],
  claims: [
    { type: "title", text: "小王子 香港粵拼版", language: "yue" },
    { type: "content-language", language: "yue" },
    { type: "work-link", reference: OL_XWZ_WORK },
    { type: "identifier", namespace: "isbn", value: ISBN_DUP },
  ],
});

/** Script-less Edition attached to the principal Work (und title). */
export const OL49205423M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL49205423M.json",
  kind: "edition",
  refs: [OL_XWZ_ED_UND],
  claims: [
    { type: "title", text: "小王子" },
    { type: "work-link", reference: OL_XWZ_WORK },
  ],
});

/** An isolated Work for the duplicate-ISBN fixture. */
export const OL49205421W_WORK: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/works/OL49205421W.json",
  kind: "work",
  refs: [OL_XWZ_ISO_WORK],
  claims: [
    { type: "title", text: "小王子", language: "zh" },
    { type: "content-language", language: "zh" },
    { type: "author", name: "Antoine de Saint-Exupéry" },
  ],
});

/** Edition on the isolated Work sharing the duplicated ISBN. */
export const OL49205422M_EDITION: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/books/OL49205422M.json",
  kind: "edition",
  refs: [OL_XWZ_ED_ISO],
  claims: [
    { type: "title", text: "小王子" },
    { type: "work-link", reference: OL_XWZ_ISO_WORK },
    { type: "identifier", namespace: "isbn", value: ISBN_DUP },
  ],
});

// ---------------------------------------------------------------------------
// 活着 records
// ---------------------------------------------------------------------------

/** Wikidata Work Q151919 (活着 / To Live) with Chinese original title. */
export const Q151919_WORK: SourceRecord = record({
  source: "wikidata",
  url: "https://www.wikidata.org/wiki/Special:EntityData/Q151919.json",
  kind: "work",
  refs: [WD_HZ_WORK],
  claims: [
    { type: "class", value: "wikidata:property:Q7725634" },
    {
      type: "title",
      text: "活着",
      language: "zh",
      statementId: "Q151919-1",
      rank: "normal",
    },
    { type: "content-language", language: "zh" },
    { type: "author", name: "余华" },
  ],
});

/** English Edition of 活着 (To Live). */
export const Q125131191_EDITION: SourceRecord = record({
  source: "wikidata",
  url: "https://www.wikidata.org/wiki/Special:EntityData/Q125131191.json",
  kind: "edition",
  refs: [WD_HZ_ED_EN],
  claims: [
    {
      type: "title",
      text: "To Live",
      language: "en",
      statementId: "Q125131191-1",
      rank: "normal",
    },
    { type: "content-language", language: "en" },
    { type: "work-link", reference: WD_HZ_WORK },
  ],
});

/** Chinese Edition of 活着. */
export const Q1100000001_EDITION: SourceRecord = record({
  source: "wikidata",
  url: "https://www.wikidata.org/wiki/Special:EntityData/Q1100000001.json",
  kind: "edition",
  refs: [WD_HZ_ED_ZH],
  claims: [
    {
      type: "title",
      text: "活着",
      language: "zh",
      statementId: "Q1100000001-1",
      rank: "normal",
    },
    { type: "content-language", language: "zh" },
    { type: "work-link", reference: WD_HZ_WORK },
  ],
});

// ---------------------------------------------------------------------------
// Generic records for fixture-only outcomes
// ---------------------------------------------------------------------------

export const OLFAIL_WORK_REF = ref("openlibrary:work", "OLFAILS999W");

/** A Work whose editions expansion always fails (T8 fixture). */
export const OLFAIL_EXPAND_WORK: SourceRecord = record({
  source: "openlibrary",
  url: "https://openlibrary.org/works/OLFAILS999W.json",
  kind: "work",
  refs: [OLFAIL_WORK_REF],
  claims: [
    { type: "title", text: "Failing editions fixture", language: "en" },
    { type: "content-language", language: "en" },
  ],
});

export function unavailableFailure(
  source: "openlibrary" | "wikidata",
): SourceFailure {
  return {
    source,
    code: "unavailable",
    references: [],
    details: { requestIdentity: `${source}://fixture` },
  };
}

export function timeoutFailure(source: "openlibrary" | "wikidata"): SourceFailure {
  return {
    source,
    code: "timeout",
    references: [],
    details: { requestIdentity: `${source}://fixture` },
  };
}
