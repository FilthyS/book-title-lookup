/**
 * Tolerant Wikidata endpoint decoders (research #2, issue #8 section 6).
 *
 * Decoders cover three response families that all arrive as JSON:
 *   - Action API `wbsearchentities` search envelopes;
 *   - Action API `wbgetentities` / `Special:EntityData` entity documents
 *     (the same per-entity shape), preserving claims, ranks, qualifiers,
 *     references, labels, aliases, and language tags;
 *   - WDQS SPARQL JSON result documents (fixed shapes 2 and 3).
 *
 * Required invariants are minimal (an entity id, a search result id, a row
 * binding); unknown fields and non-core facts degrade to absent. Raw upstream
 * JSON never crosses into Core; only the typed values below do.
 */

import type { DecodeResult, TransportEnvelope } from "../runtime/types.ts";
import { parseJsonEnvelope } from "../decode/json.ts";
import { asOptionalString, asRecord, asStringArray } from "../decode/struct.ts";

// ---------------------------------------------------------------------------
// wbsearchentities search envelope
// ---------------------------------------------------------------------------

export interface WdSearchResult {
  readonly id: string;
  readonly label?: string;
  readonly aliases: readonly string[];
  /** The `match` block records the matched text and its language. */
  readonly matchedText?: string;
  readonly matchedLanguage?: string;
}

export interface WdSearchValue {
  readonly results: readonly WdSearchResult[];
}

function parseSearchResult(raw: unknown): WdSearchResult | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const id = asOptionalString(record.id);
  if (id === undefined || !/^Q[0-9]+$/.test(id)) return undefined;
  const match = asRecord(record.match);
  return {
    id,
    ...(asOptionalString(record.label) !== undefined
      ? { label: asOptionalString(record.label) }
      : {}),
    aliases: asStringArray(record.aliases) ?? [],
    ...(match !== undefined && asOptionalString(match.text) !== undefined
      ? { matchedText: asOptionalString(match.text) }
      : {}),
    ...(match !== undefined && asOptionalString(match.language) !== undefined
      ? { matchedLanguage: asOptionalString(match.language) }
      : {}),
  };
}

/** Decode a `wbsearchentities` envelope. Empty search list is a negative. */
export function decodeSearchEnvelope(
  env: TransportEnvelope,
): DecodeResult<WdSearchValue> {
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "search body is not an object" };
  }
  if (asOptionalString(root.error) !== undefined) {
    return { kind: "malformed", detail: "search returned an error" };
  }
  if (!Array.isArray(root.search)) {
    return { kind: "malformed", detail: "search body lacks search array" };
  }
  const results: WdSearchResult[] = [];
  for (const raw of root.search) {
    const result = parseSearchResult(raw);
    if (result !== undefined) results.push(result);
  }
  return {
    kind: "data",
    value: { results },
    negative: results.length === 0,
  };
}

// ---------------------------------------------------------------------------
// wbgetentities / EntityData entity documents
// ---------------------------------------------------------------------------

export type WdRank = "preferred" | "normal" | "deprecated";

export type WdValue =
  | { readonly kind: "item"; readonly id: string }
  | {
      readonly kind: "monolingual";
      readonly text: string;
      readonly language: string;
    }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "time"; readonly time: string }
  | { readonly kind: "quantity"; readonly amount: string }
  /** somevalue/novalue or an unrecognized value shape. */
  | { readonly kind: "unknown" };

export interface WdQualifier {
  readonly property: string;
  readonly value: WdValue;
}

export interface WdStatement {
  readonly property: string;
  /** Statement id when present (e.g. `Q151919$...`). */
  readonly id?: string;
  readonly rank: WdRank;
  readonly value: WdValue;
  readonly qualifiers: readonly WdQualifier[];
  /** Reference groups exist but their internal snaks are not decoded here;
   *  preservation is at the group level. */
  readonly references: number;
}

export interface WdMonolingualText {
  readonly language: string;
  readonly text: string;
}

export interface WdEntity {
  readonly id: string;
  /** Entity type: `item` for books. Redirect entries have other types. */
  readonly type: string;
  readonly labels: readonly WdMonolingualText[];
  readonly aliases: readonly WdMonolingualText[];
  readonly claims: readonly WdStatement[];
}

export interface WdEntitiesValue {
  /** Keyed by entity id, preserving order. Redirect entries are skipped. */
  readonly entities: readonly WdEntity[];
}

/** Best-effort decode of one mainsnak datavalue into a WdValue. The input
 *  is the whole `{ value, type, datatype }` datavalue record (or absent for
 *  somevalue/novalue snaks, which decode to `unknown`). */
function decodeValue(datavalue: unknown): WdValue {
  const data = asRecord(datavalue);
  if (data === undefined) return { kind: "unknown" };
  const value = data.value;
  const valueObject = asRecord(value);
  if (valueObject !== undefined) {
    const id = asOptionalString(valueObject.id);
    if (id !== undefined) return { kind: "item", id };
    const text = asOptionalString(valueObject.text);
    if (text !== undefined) {
      const language = asOptionalString(valueObject.language) ?? "und";
      return { kind: "monolingual", text, language };
    }
    const time = asOptionalString(valueObject.time);
    if (time !== undefined) return { kind: "time", time };
    const amount = asOptionalString(valueObject.amount);
    if (amount !== undefined) return { kind: "quantity", amount };
  }
  if (typeof value === "string") return { kind: "string", value };
  const snakType = asOptionalString(data.type);
  if (snakType === "somevalue" || snakType === "novalue") {
    return { kind: "unknown" };
  }
  return { kind: "unknown" };
}

function decodeQualifier(raw: unknown): WdQualifier | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const property = asOptionalString(record.property);
  if (property === undefined) return undefined;
  const datavalue = asRecord(record.datavalue);
  if (datavalue === undefined) return undefined;
  return { property, value: decodeValue(datavalue) };
}

function decodeStatement(
  property: string,
  raw: unknown,
): WdStatement | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const rank = asOptionalString(record.rank);
  if (rank !== "preferred" && rank !== "normal" && rank !== "deprecated") {
    return undefined;
  }
  const mainsnak = asRecord(record.mainsnak);
  const datavalue = asRecord(mainsnak?.datavalue);
  const qualifiers = asRecord(record.qualifiers);
  const qualifierList: WdQualifier[] = [];
  if (qualifiers !== undefined) {
    for (const entries of Object.values(qualifiers)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const decoded = decodeQualifier(entry);
        if (decoded !== undefined) qualifierList.push(decoded);
      }
    }
  }
  const referenceEntries = record.references;
  const referenceCount = Array.isArray(referenceEntries)
    ? referenceEntries.length
    : 0;
  return {
    property,
    ...(asOptionalString(record.id) !== undefined
      ? { id: asOptionalString(record.id) }
      : {}),
    rank,
    value:
      datavalue === undefined ? { kind: "unknown" } : decodeValue(datavalue),
    qualifiers: qualifierList,
    references: referenceCount,
  };
}

function decodeMonolingualMap(raw: unknown): readonly WdMonolingualText[] {
  const map = asRecord(raw);
  if (map === undefined) return [];
  const out: WdMonolingualText[] = [];
  for (const [language, valueRaw] of Object.entries(map)) {
    const valueRecord = asRecord(valueRaw);
    if (valueRecord === undefined) continue;
    const text = asOptionalString(valueRecord.value);
    if (text === undefined) continue;
    const tag = asOptionalString(valueRecord.language) ?? language;
    out.push({ language: tag, text });
  }
  return out;
}

function parseEntity(raw: unknown): WdEntity | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const id = asOptionalString(record.id);
  if (id === undefined || !/^Q[0-9]+$/.test(id)) return undefined;
  const type = asOptionalString(record.type) ?? "item";
  const claims: WdStatement[] = [];
  const claimsMap = asRecord(record.claims);
  if (claimsMap !== undefined) {
    for (const [property, entries] of Object.entries(claimsMap)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const statement = decodeStatement(property, entry);
        if (statement !== undefined) claims.push(statement);
      }
    }
  }
  return {
    id,
    type,
    labels: decodeMonolingualMap(record.labels),
    aliases: decodeMonolingualMap(record.aliases),
    claims,
  };
}

/**
 * Decode a `wbgetentities`/`EntityData` envelope. The entity map is read by
 * id; redirects (entities of type other than `item`) are dropped, mirroring
 * the runtime's redirect semantics. An absent `entities` object or a
 * `success: 0` body is not found.
 */
export function decodeEntitiesEnvelope(
  env: TransportEnvelope,
): DecodeResult<WdEntitiesValue> {
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "entities body is not an object" };
  }
  if (asOptionalString(root.error) !== undefined || root.success === 0) {
    return { kind: "no_record" };
  }
  const entitiesMap = asRecord(root.entities);
  if (entitiesMap === undefined) {
    return { kind: "malformed", detail: "entities body lacks entities" };
  }
  const entities: WdEntity[] = [];
  const ids = Object.keys(entitiesMap).sort();
  for (const id of ids) {
    const entity = parseEntity(entitiesMap[id]);
    if (entity !== undefined && entity.type === "item") {
      entities.push(entity);
    }
  }
  if (entities.length === 0) return { kind: "no_record" };
  return { kind: "data", value: { entities } };
}

// ---------------------------------------------------------------------------
// WDQS SPARQL JSON result documents
// ---------------------------------------------------------------------------

export interface WdSparqlBinding {
  readonly value: string;
  readonly type?: string;
  readonly language?: string;
  readonly datatype?: string;
}

export interface WdSparqlRow {
  readonly bindings: Readonly<Record<string, WdSparqlBinding>>;
}

export interface WdSparqlValue {
  readonly rows: readonly WdSparqlRow[];
}

/** Extract the QID from a WDQS entity URI binding value. */
export function sparqlEntityId(
  binding: WdSparqlBinding | undefined,
): string | undefined {
  if (binding === undefined) return undefined;
  const value = binding.value;
  const match = /\/entity\/(Q[0-9]+)$/.exec(value);
  return match === null ? undefined : match[1];
}

function parseBinding(raw: unknown): WdSparqlBinding | undefined {
  const record = asRecord(raw);
  if (record === undefined) return undefined;
  const value = asOptionalString(record.value);
  if (value === undefined) return undefined;
  return {
    value,
    ...(asOptionalString(record.type) !== undefined
      ? { type: asOptionalString(record.type) }
      : {}),
    ...(asOptionalString(record["xml:lang"]) !== undefined
      ? { language: asOptionalString(record["xml:lang"]) }
      : {}),
    ...(asOptionalString(record.datatype) !== undefined
      ? { datatype: asOptionalString(record.datatype) }
      : {}),
  };
}

/** Decode a WDQS SPARQL JSON result envelope (fixed shapes 2 and 3). */
export function decodeSparqlEnvelope(
  env: TransportEnvelope,
): DecodeResult<WdSparqlValue> {
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "sparql body is not an object" };
  }
  if (asOptionalString(root.error) !== undefined) {
    return { kind: "malformed", detail: "sparql returned an error" };
  }
  const results = asRecord(root.results);
  if (results === undefined || !Array.isArray(results.bindings)) {
    return { kind: "malformed", detail: "sparql body lacks results.bindings" };
  }
  const rows: WdSparqlRow[] = [];
  for (const raw of results.bindings) {
    const rowRecord = asRecord(raw);
    if (rowRecord === undefined) continue;
    const bindings: Record<string, WdSparqlBinding> = {};
    for (const [name, rawBinding] of Object.entries(rowRecord)) {
      const binding = parseBinding(rawBinding);
      if (binding !== undefined) bindings[name] = binding;
    }
    rows.push({ bindings });
  }
  return { kind: "data", value: { rows }, negative: rows.length === 0 };
}

// ---------------------------------------------------------------------------
// CirrusSearch (`list=search`) fallback for structured ISBN discovery
// ---------------------------------------------------------------------------

export interface WdCirrusSearchValue {
  readonly ids: readonly string[];
}

/** CirrusSearch page titles are QIDs when the search stays in namespace 0. */
export function decodeCirrusSearchEnvelope(
  env: TransportEnvelope,
): DecodeResult<WdCirrusSearchValue> {
  const parsed = parseJsonEnvelope(env);
  if (!parsed.ok) return { kind: "malformed", detail: parsed.reason };
  const root = asRecord(parsed.value);
  if (root === undefined) {
    return { kind: "malformed", detail: "cirrus body is not an object" };
  }
  const query = asRecord(root.query);
  const search = query === undefined ? undefined : query.search;
  if (!Array.isArray(search)) {
    return { kind: "malformed", detail: "cirrus body lacks query.search" };
  }
  const ids: string[] = [];
  for (const raw of search) {
    const record = asRecord(raw);
    if (record === undefined) continue;
    const title = asOptionalString(record.title);
    if (title !== undefined && /^Q[0-9]+$/.test(title)) ids.push(title);
  }
  return {
    kind: "data",
    value: { ids },
    negative: ids.length === 0,
  };
}
