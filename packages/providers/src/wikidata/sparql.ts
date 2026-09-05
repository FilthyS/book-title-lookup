/**
 * Fixed low-complexity Wikidata SPARQL shapes (research #2 section "Fixed
 * low-complexity SPARQL shapes"). Only bound values ever change — a confirmed
 * Work QID or a normalized ISBN — and user text is never spliced into a
 * query. All shapes bind a Work or a fixed value set first so none scans the
 * graph; each is small and constant-complexity.
 */

/** WDQS endpoint (GET, format=json). */
export const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";

/** Shape 2 edition expansion caps the result set (largest corpus set ~30). */
export const SPARQL_EDITION_LIMIT = 200;

/** Shape 3 ISBN lookup cap (research #2 uses one or a handful). */
export const SPARQL_ISBN_LIMIT = 20;

/**
 * Shape 2 — enumerate Editions of a confirmed Work with edition title text,
 * its language tag, an optional P407 qualifier language, and ISBN.
 */
export function shape2EditionsQuery(workQid: string): string {
  return [
    "SELECT DISTINCT ?e ?eLabel ?title ?langLabel ?isbn WHERE {",
    `  VALUES ?work { wd:${workQid} }`,
    "  ?e wdt:P629 ?work .",
    "  ?e wdt:P31/wdt:P279* wd:Q3331189 .",
    "  ?e p:P1476 ?st .",
    "  ?st ps:P1476 ?title .",
    "  OPTIONAL { ?st pq:P407 ?lang . }",
    "  OPTIONAL { ?e wdt:P212 ?isbn . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,zh,ja,fr". }',
    "}",
    `LIMIT ${SPARQL_EDITION_LIMIT}`,
  ].join("\n");
}

/**
 * Shape 3 — ISBN to Edition/Work lookup. The ISBN is a bound literal so
 * complexity stays constant and no literal scan is needed.
 */
export function shape3IsbnQuery(isbn: string): string {
  return [
    "SELECT ?e ?eLabel WHERE {",
    `  VALUES ?isbn { "${encodeURIComponent(isbn)}" }`,
    "  ?e wdt:P212 ?isbn .",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,zh". }',
    "}",
    `LIMIT ${SPARQL_ISBN_LIMIT}`,
  ].join("\n");
}

/** Build a WDQS endpoint URL for a fixed query. */
export function sparqlUrl(query: string): string {
  const url = new URL(WDQS_ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);
  return url.href;
}
