/**
 * Shared raw Wikidata HTTP response fixtures (research #2 fixtures F1-F7;
 * issue #8 contract harness). Every fixture is a fixed snapshot modeled on
 * read-only probes retrieved 2026-09-05; live catalog values are never test
 * assertions. Bodies are the raw JSON documents decoders consume for
 * `wbsearchentities`, `wbgetentities`, and the fixed WDQS SPARQL shapes.
 */

export const WD_FIXED_AT = "2026-09-05T12:34:56.789Z";

// ---------------------------------------------------------------------------
// Claim / statement builders (wbgetentities JSON shape)
// ---------------------------------------------------------------------------

function itemSnak(
  property: string,
  id: string,
): Record<string, unknown> {
  return {
    snaktype: "value",
    property,
    datavalue: {
      value: { "entity-type": "item", id },
      type: "wikibase-entityid",
    },
    datatype: "wikibase-item",
  };
}

function monolingualSnak(
  property: string,
  text: string,
  language: string,
): Record<string, unknown> {
  return {
    snaktype: "value",
    property,
    datavalue: { value: { text, language }, type: "monolingualtext" },
    datatype: "monolingualtext",
  };
}

function stringSnak(
  property: string,
  value: string,
  datatype = "external-id",
): Record<string, unknown> {
  return {
    snaktype: "value",
    property,
    datavalue: { value, type: "string" },
    datatype,
  };
}

function timeSnak(
  property: string,
  time: string,
): Record<string, unknown> {
  return {
    snaktype: "value",
    property,
    datavalue: {
      value: {
        time,
        timezone: 0,
        before: 0,
        after: 0,
        precision: 9,
        calendarmodel: "http://www.wikidata.org/entity/Q1985727",
      },
      type: "time",
    },
    datatype: "time",
  };
}

interface QualifierInput {
  readonly property: string;
  readonly snak: Record<string, unknown>;
}

function statement(
  mainsnak: Record<string, unknown>,
  rank: "preferred" | "normal" | "deprecated",
  id: string,
  qualifiers: readonly QualifierInput[] = [],
  withReferences = false,
): Record<string, unknown> {
  const qualifierMap: Record<string, unknown[]> = {};
  for (const qualifier of qualifiers) {
    const property = qualifier.snak.property as string;
    const bucket = qualifierMap[property] ?? [];
    bucket.push(qualifier.snak);
    qualifierMap[property] = bucket;
  }
  return {
    mainsnak,
    type: "statement",
    id,
    rank,
    qualifiers: qualifierMap,
    references: withReferences
      ? [{
        hash: "referencehash",
        snaks: { P854: [stringSnak("P854", "https://example.com/source")] },
      }]
      : [],
  };
}

function itemClaim(
  property: string,
  id: string,
  rank: "preferred" | "normal" | "deprecated",
  statementId: string,
): Record<string, unknown> {
  return statement(itemSnak(property, id), rank, statementId);
}

function monolingualClaim(
  property: string,
  text: string,
  language: string,
  rank: "preferred" | "normal" | "deprecated",
  statementId: string,
  qualifiers: readonly QualifierInput[] = [],
  withReferences = false,
): Record<string, unknown> {
  return statement(
    monolingualSnak(property, text, language),
    rank,
    statementId,
    qualifiers,
    withReferences,
  );
}

function stringClaim(
  property: string,
  value: string,
  rank: "preferred" | "normal" | "deprecated",
  statementId: string,
): Record<string, unknown> {
  return statement(stringSnak(property, value), rank, statementId);
}

function qualifier(
  property: string,
  snak: Record<string, unknown>,
): QualifierInput {
  return { property, snak };
}

function itemQualifier(property: string, id: string): QualifierInput {
  return qualifier(property, itemSnak(property, id));
}

function entityDocument(
  id: string,
  claims: readonly Record<string, unknown>[],
  labels: Readonly<Record<string, string>>,
  aliases: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
  const labelMap: Record<string, unknown> = {};
  for (const [language, text] of Object.entries(labels)) {
    labelMap[language] = { language, value: text };
  }
  const aliasMap: Record<string, unknown> = {};
  for (const [language, text] of Object.entries(aliases)) {
    aliasMap[language] = [{ language, value: text }];
  }
  const claimMap: Record<string, unknown[]> = {};
  for (const claim of claims) {
    const property = (claim.mainsnak as Record<string, unknown>).property as
      string;
    const bucket = claimMap[property] ?? [];
    bucket.push(claim);
    claimMap[property] = bucket;
  }
  return {
    id,
    type: "item",
    labels: labelMap,
    aliases: aliasMap,
    descriptions: {},
    claims: claimMap,
  };
}

// ---------------------------------------------------------------------------
// F1 — Work Q151919 (活着) with clean claims
// ---------------------------------------------------------------------------

export const Q151919_DOC = entityDocument(
  "Q151919",
  [
    itemClaim("P31", "Q47461344", "normal", "Q151919$P31-1"),
    monolingualClaim("P1476", "活着", "zh", "normal", "Q151919$P1476-1"),
    monolingualClaim("P1476", "To Live", "en", "normal", "Q151919$P1476-2"),
    itemClaim("P407", "Q7850", "normal", "Q151919$P407-1"),
    stringClaim("P648", "OL12181913W", "normal", "Q151919$P648-1"),
    statement(timeSnak("P577", "+1960-00-00T00:00:00Z"), "normal", "Q151919$P577-1"),
    // P747 gives the Edition index used when the fixed Shape 2 WDQS query
    // fails: the source falls back to reading these Edition entities.
    itemClaim("P747", "Q125131191", "normal", "Q151919$P747-1"),
    itemClaim("P747", "Q1100000001", "normal", "Q151919$P747-2"),
  ],
  { zh: "活着", en: "To Live" },
);

// ---------------------------------------------------------------------------
// F2 — Edition Q125131191 (en "To Live") with a full Title Attestation
// ---------------------------------------------------------------------------

export const Q125131191_DOC = entityDocument(
  "Q125131191",
  [
    itemClaim("P31", "Q3331189", "normal", "Q125131191$P31-1"),
    itemClaim("P629", "Q151919", "normal", "Q125131191$P629-1"),
    monolingualClaim(
      "P1476",
      "To Live",
      "en",
      "normal",
      "Q125131191$P1476-1",
      [itemQualifier("P407", "Q1860")],
      true,
    ),
    itemClaim("P407", "Q1860", "normal", "Q125131191$P407-1"),
    stringClaim("P212", "9780385421987", "normal", "Q125131191$P212-1"),
    statement(timeSnak("P577", "+1993-00-00T00:00:00Z"), "normal", "Q125131191$P577-1"),
  ],
  { en: "To Live" },
);

// ---------------------------------------------------------------------------
// Chinese edition Q1100000001 (zh 活着)
// ---------------------------------------------------------------------------

export const Q1100000001_DOC = entityDocument(
  "Q1100000001",
  [
    itemClaim("P31", "Q3331189", "normal", "Q1100000001$P31-1"),
    itemClaim("P629", "Q151919", "normal", "Q1100000001$P629-1"),
    monolingualClaim(
      "P1476",
      "活着",
      "zh",
      "normal",
      "Q1100000001$P1476-1",
      [],
      true,
    ),
    itemClaim("P407", "Q7850", "normal", "Q1100000001$P407-1"),
  ],
  { zh: "活着" },
);

// ---------------------------------------------------------------------------
// F3 — Edition Q69966015 with only a label title (no P1476)
// ---------------------------------------------------------------------------

export const Q69966015_DOC = entityDocument(
  "Q69966015",
  [
    itemClaim("P31", "Q3331189", "normal", "Q69966015$P31-1"),
    itemClaim("P629", "Q751348", "normal", "Q69966015$P629-1"),
    stringClaim("P212", "9787532733657", "normal", "Q69966015$P212-1"),
  ],
  { zh: "挪威的森林" },
);

// ---------------------------------------------------------------------------
// F5 — classification set (Work Q25338 + a translation-tagged Edition)
// ---------------------------------------------------------------------------

export const Q25338_DOC = entityDocument(
  "Q25338",
  [
    itemClaim("P31", "Q7725634", "normal", "Q25338$P31-1"),
    monolingualClaim("P1476", "Le Petit Prince", "fr", "normal", "Q25338$P1476-1"),
  ],
  { zh: "小王子", fr: "Le Petit Prince" },
);

/** Q178869 (Cien años de soledad) as a Work carrying its P648 Open Library
 *  identity. Reached by the zh-Hant discovery retry for a traditional-script
 *  query; its P648 maps cross-source to Open Library work OL274505W. */
export const Q178869_DOC = entityDocument(
  "Q178869",
  [
    itemClaim("P31", "Q7725634", "normal", "Q178869$P31-1"),
    monolingualClaim(
      "P1476",
      "Cien años de soledad",
      "es",
      "normal",
      "Q178869$P1476-1",
    ),
    itemClaim("P407", "Q1321", "normal", "Q178869$P407-1"),
    stringClaim("P648", "OL274505W", "normal", "Q178869$P648-1"),
  ],
  { es: "Cien años de soledad", "zh-hant": "百年孤寂", zh: "百年孤独" },
);

/** A translation-tagged Edition (P31 Q7553 plus a P31 edition subclass). */
export const Q50476449_DOC = entityDocument(
  "Q50476449",
  [
    itemClaim("P31", "Q3331189", "normal", "Q50476449$P31-1"),
    itemClaim("P31", "Q7553", "normal", "Q50476449$P31-2"),
    itemClaim("P629", "Q25338", "normal", "Q50476449$P629-1"),
  ],
  { zh: "小王子 譯本" },
);

// ---------------------------------------------------------------------------
// F6 — Deprecated identifier pair Q208460 P648
// ---------------------------------------------------------------------------

export const Q208460_DOC = entityDocument(
  "Q208460",
  [
    itemClaim("P31", "Q7725634", "normal", "Q208460$P31-1"),
    monolingualClaim("P1476", "Nineteen Eighty-Four", "en", "normal", "Q208460$P1476-1"),
    stringClaim("P648", "OL1168091W", "deprecated", "Q208460$P648-1"),
    stringClaim("P648", "OL1168083W", "normal", "Q208460$P648-2"),
  ],
  { en: "Nineteen Eighty-Four" },
);

// ---------------------------------------------------------------------------
// Envelope builders
// ---------------------------------------------------------------------------

/** wbsearchentities response from a result list. */
export function searchEnvelope(
  results: readonly {
    readonly id: string;
    readonly label?: string;
    readonly aliases?: readonly string[];
    readonly matchText?: string;
    readonly matchLanguage?: string;
  }[],
): string {
  return JSON.stringify({
    search: results.map((result) => ({
      id: result.id,
      ...(result.label !== undefined ? { label: result.label } : {}),
      aliases: result.aliases ?? [],
      ...(result.matchText !== undefined || result.matchLanguage !== undefined
        ? {
          match: {
            type: "label",
            language: result.matchLanguage ?? "zh",
            text: result.matchText ?? result.label ?? "",
          },
        }
        : {}),
    })),
    searchinfo: { search: "" },
    "search-continue": 0,
    success: 1,
  });
}

/** wbgetentities response from an ordered entity map. */
export function entitiesEnvelope(
  entities: readonly Record<string, unknown>[],
): string {
  const map: Record<string, unknown> = {};
  for (const entity of entities) {
    map[entity.id as string] = entity;
  }
  return JSON.stringify({ entities: map, success: 1 });
}

/** WDQS SPARQL JSON from edition rows for Shape 2 / Shape 3. */
export function sparqlEditionsEnvelope(
  rows: readonly {
    readonly editionId: string;
    readonly title?: string;
    readonly language?: string;
    readonly isbn?: string;
  }[],
): string {
  return JSON.stringify({
    head: { vars: ["e", "eLabel", "title", "langLabel", "isbn"] },
    results: {
      bindings: rows.map((row) => {
        const binding: Record<string, unknown> = {
          e: {
            type: "uri",
            value: `http://www.wikidata.org/entity/${row.editionId}`,
          },
        };
        if (row.title !== undefined) {
          binding.title = {
            type: "literal",
            value: row.title,
            ...(row.language !== undefined ? { "xml:lang": row.language } : {}),
          };
        }
        if (row.isbn !== undefined) {
          binding.isbn = { type: "literal", value: row.isbn };
        }
        return binding;
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Discovery doc lookups used by fixture matching
// ---------------------------------------------------------------------------

/** Entity documents keyed by QID. */
export const WD_ENTITY_DOCS: Readonly<Record<string, Record<string, unknown>>> =
  {
    Q151919: Q151919_DOC,
    Q125131191: Q125131191_DOC,
    Q1100000001: Q1100000001_DOC,
    Q69966015: Q69966015_DOC,
    Q25338: Q25338_DOC,
    Q50476449: Q50476449_DOC,
    Q208460: Q208460_DOC,
    Q178869: Q178869_DOC,
  };

/** zh discovery results per title (research #2 acceptance-corpus probes). */
export const WD_ZH_SEARCH: Readonly<Record<string, string>> = {
  "活着": searchEnvelope([
    { id: "Q151919", label: "活着", matchText: "活着", matchLanguage: "zh" },
  ]),
  "小王子": searchEnvelope([
    { id: "Q25338", label: "小王子", matchText: "小王子", matchLanguage: "zh" },
  ]),
  // A traditional-script title finds nothing in zh; discovery falls back to
  // the zh-Hant retry (research #2 step 1). The empty result is a definitive
  // zh negative so the hant retry is what produces the candidate.
  "百年孤寂": searchEnvelope([]),
  // An ascii/nonexistent query returns no hits in zh (and triggers no hant
  // retry because it carries no traditional markers).
  "zzqxqwnonexistentphrasebooknotfound": searchEnvelope([]),
};

/** zh-Hant discovery results per title. */
export const WD_HANT_SEARCH: Readonly<Record<string, string>> = {
  "百年孤寂": searchEnvelope([
    {
      id: "Q178869",
      label: "百年孤寂",
      aliases: ["百年孤独"],
      matchText: "百年孤寂",
      matchLanguage: "zh-Hant",
    },
  ]),
};

/** Shape 2 edition rows for a confirmed Work QID. */
export const WD_SHAPE2_ROWS: Readonly<
  Record<string, readonly {
    readonly editionId: string;
    readonly title: string;
    readonly language: string;
    readonly isbn?: string;
  }[]>
> = {
  Q151919: [
    { editionId: "Q125131191", title: "To Live", language: "en" },
    { editionId: "Q1100000001", title: "活着", language: "zh" },
  ],
};

/** Shape 3 ISBN -> edition rows (edition qid only). */
export const WD_SHAPE3_ROWS: Readonly<
  Record<string, readonly { readonly editionId: string }[]>
> = {
  "9780385421987": [{ editionId: "Q125131191" }],
};

export interface WikidataFixtures {
  readonly zhSearch: Readonly<Record<string, string>>;
  readonly hantSearch: Readonly<Record<string, string>>;
  readonly entityDocs: Readonly<Record<string, Record<string, unknown>>>;
  readonly shape2Rows: Readonly<
    Record<string, readonly {
      readonly editionId: string;
      readonly title: string;
      readonly language: string;
      readonly isbn?: string;
    }[]>
  >;
  readonly shape3Rows: Readonly<
    Record<string, readonly { readonly editionId: string }[]>
  >;
}

const DEFAULT_FIXTURES: WikidataFixtures = {
  zhSearch: WD_ZH_SEARCH,
  hantSearch: WD_HANT_SEARCH,
  entityDocs: WD_ENTITY_DOCS,
  shape2Rows: WD_SHAPE2_ROWS,
  shape3Rows: WD_SHAPE3_ROWS,
};

function decodeParams(url: URL): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) out[key] = value;
  return out;
}

/**
 * Map an absolute request URL to a fixture response, or undefined when no
 * fixture matches. Callers pass a query override object for the WDQS SPARQL
 * endpoint (whose `query` parameter is decoded to a bound Work/ISBN).
 */
export function findWikidataFixture(
  url: string,
  overrides: Partial<WikidataFixtures> = {},
): { readonly status: number; readonly body: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const opts: WikidataFixtures = { ...DEFAULT_FIXTURES, ...overrides };
  const params = decodeParams(parsed);

  if (parsed.hostname === "query.wikidata.org") {
    const query = params["query"] ?? "";
    const workMatch = /VALUES \?work \{ wd:(Q[0-9]+) \}/.exec(query);
    if (workMatch !== null) {
      const rows = opts.shape2Rows[workMatch[1]];
      if (rows === undefined) return undefined;
      return { status: 200, body: sparqlEditionsEnvelope(rows) };
    }
    const isbnMatch = /VALUES \?isbn \{ "([0-9]+)" \}/.exec(query);
    if (isbnMatch !== null) {
      const rows = opts.shape3Rows[isbnMatch[1]];
      if (rows === undefined) return undefined;
      return { status: 200, body: sparqlEditionsEnvelope(rows ?? []) };
    }
    return undefined;
  }

  if (parsed.hostname !== "www.wikidata.org") return undefined;
  if (params["action"] === "wbsearchentities") {
    const search = params["search"] ?? "";
    const language = params["language"] ?? "zh";
    const isHant = language.toLowerCase() === "zh-hant";
    const body = isHant ? opts.hantSearch[search] : opts.zhSearch[search];
    if (body === undefined) return undefined;
    return { status: 200, body };
  }
  if (params["action"] === "wbgetentities") {
    const ids = (params["ids"] ?? "").split("|");
    const docs = ids
      .map((id) => opts.entityDocs[id])
      .filter((doc): doc is Record<string, unknown> => doc !== undefined);
    if (docs.length === 0) return undefined;
    return { status: 200, body: entitiesEnvelope(docs) };
  }
  if (params["action"] === "query" && params["list"] === "search") {
    const isbn = /haswbstatement:P212=([0-9]+)/.exec(params["srsearch"] ?? "");
    if (isbn === null) return undefined;
    const rows = opts.shape3Rows[isbn[1]];
    if (rows === undefined) return undefined;
    return {
      status: 200,
      body: JSON.stringify({
        query: {
          search: rows.map((row) => ({ ns: 0, title: row.editionId })),
        },
      }),
    };
  }
  return undefined;
}
