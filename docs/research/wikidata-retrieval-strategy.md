# Wikidata Retrieval Strategy

Type: research
Status: findings for issue #2
Blocked by: none

## Purpose

This report answers issue #2: which combination of Wikidata entity search,
entity reads, and fixed low-complexity SPARQL queries supplies useful Work and
Edition evidence within interactive latency and public-service constraints,
while keeping labels and aliases separate from title attestations.

The evidence is primary Wikimedia/Wikidata documentation plus small, read-only,
live probes. No production code, writes, or external-service mutations were
made. Probe and retrieval date is **2026-09-05**.

## Baseline documents

The report assumes the project baseline:

- `CONTEXT.md` domain language, especially Work, Edition, Attested Title,
  Title Attestation, Search Alias, and Evidence Level.
- `docs/product-spec.md`, in particular the accepted attestations and the
  acceptance corpus.
- `docs/architecture.md` source request policy, cache, and deadline rules.
- `docs/data-sources.md` Wikidata access strategy.

## Findings summary

1. Use `wbsearchentities` for interactive label/alias discovery. It is the
   only low-latency path that understands human titles in one language.
   Search results are clues, never attestations.
2. Use batch Action API entity reads (`wbgetentities`, or per-entity
   `Special:EntityData` JSON) as the source of authoritative claims, ranks,
   qualifiers, references, labels, and aliases. Action API and EntityData
   return the same entity document shape.
3. Use only a small number of fixed, ID-bound SPARQL shapes on WDQS for
   relationship traversal that a Work entity does not contain directly:
   editions of a confirmed Work, and ISBN lookup. Never interpolate arbitrary
   user text into SPARQL or CirrusSearch beyond encoded bound values.
4. Treat WDQS as an optional, non-interactive-quality supplement with client
   caching and strict deadlines, per Wikimedia's own guidance.
5. Editions are `instance of` (P31) `version, edition or translation`
   (Q3331189) or one of its subclasses; Works are other instances under
   "work" (Q386724), commonly `literary work` (Q7725634) or `written work`
   (Q47461344). Labels/aliases/descriptions on either are Search Aliases.
6. A qualifying Wikidata Edition attests a title only through a language-
   tagged `title` (P1476) statement with rank other than deprecated. This
   keeps labels and aliases as clues and never lets them become Title
   Attestations on their own.

## Work versus Edition model

Wikidata follows a FRBR-like three-level model for books (WikiProject Books):

| Level | Typical P31 values | Notes |
| --- | --- | --- |
| Work | `work` Q386724 or more specific subclasses such as `literary work` Q7725634, `written work` Q47461344, `novel` Q8261 | Not an edition. P1476 titles are Work-level title evidence. |
| Edition / translation | `version, edition or translation` Q3331189; also `print edition` Q59466300 (a subclass of Q3331189); sometimes additionally `translation` Q7553 | P31 Q3331189 (or subclass) plus P629 edition-of is the Edition signal. |
| Exemplar | `individual copy of a book` Q53731850 | Outside the book-title MVP. |

Observed corpus classes on 2026-09-05:

| Work | P31 values observed | Editions via P629 |
| --- | --- | --- |
| Q25338 The Little Prince | Q7725634 literary work | 30 distinct |
| Q178869 One Hundred Years of Solitude | Q7725634 literary work | 5 |
| Q208460 Nineteen Eighty-Four | Q7725634 literary work | 24 |
| Q751348 Norwegian Wood | Q7725634 literary work | 7 |
| Q151919 To Live | Q47461344 written work | 1 |
| Q109996684 Clean Code | Q47461344 written work | 1 observed (Q112416172); coverage sparse |

Caveats observed:

- `translation` (Q7553) is modeled as an activity/concept, not as a subclass
  of Q3331189, yet some Edition items carry both `P31 = Q7553` and
  `P31 = Q3331189` (for example Q50476449).
- Some derived works incorrectly or confusingly use P629, such as a film item
  (P31 = Q11424) that also points to the source Work. Classify with P31 and
  keep the exception out of default results instead of trusting P629 alone.
- A Work can also be the only record for a publication ("work/edition on one
  item"), a case the Books model allows when no separate Edition item exists.
- Live entity counts change as the community edits; reproduce against fresh
  reads, not this table.

## Properties, ranks, qualifiers, and references

### Properties to decode

Edition evidence:

| Property | Meaning in this report |
| --- | --- |
| P31 | `instance of`; edition test |
| P629 | `edition or translation of`; the Edition-to-Work edge |
| P1476 | `title`; monolingual title text with its own language tag |
| P1680 | `subtitle`; commonly a qualifier of the P1476 title statement |
| P407 | `language of work or name`; content language claim on the item or a P1476 qualifier |
| P50 | `author` |
| P655 | `translator` |
| P123 | `publisher` |
| P577 | `publication date` |
| P291 | `place of publication` |
| P1104 | `number of pages` |
| P212 / P957 | ISBN-13 / ISBN-10 identifiers |
| P98, P2679, P2680, P872, P110 | editor, foreword/afterword authors, printed by, illustrator (retain for context) |

Work evidence:

| Property | Meaning in this report |
| --- | --- |
| P31 | `instance of`; Work classification |
| P1476 | `title` statements, used only as Work-level Original Title evidence per product spec |
| P407 | language claims on the Work (original-language clue, not a per-title language) |
| P50 | `author` |
| P577 | first-publication/date evidence |
| P655 | `translator` where attached at Work level |
| P747 | `has version, edition or translation`; optional partial Edition index |
| P136, P921, P155/P156 | genre, main subject, series position (disambiguation context) |
| P648 | Open Library ID, useful for cross-source reconciliation |

P364 (`original language of film or TV show`) is deprecated for written works
in favor of P407 and should not be used for book title language.

### Ranks

Each claim carries a rank: `preferred`, `normal`, or `deprecated`. Decoders
must preserve rank. Rules that follow from probes and model documentation:

- Prefer `preferred` then `normal`; ignore `deprecated` for ordinary evidence.
- The direct predicate `wdt:` exposes truthy values (best non-deprecated rank
  per property), so it is convenient for classification but hides conflicting
  statements.
- The statement predicates `p:.../ps:...` expose every statement including
  non-best and deprecated ranks. Use them when the pipeline must surface
  conflicts.
- Example: Q208460 has two Open Library ID claims, one deprecated
  (`OL1168091W`) and one normal (`OL1168083W`). A rank-blind decoder would
  silently pick the wrong external reference.

### Qualifiers

Qualifiers narrow a statement. For the title statement the relevant
qualifiers are:

- P407 as the title language qualifier;
- P1680 as the subtitle qualifier.

The language of a title statement may be recorded two ways:

1. The P1476 value is a monolingual text whose own language tag is the title
   language; in SPARQL this is `LANG(?title)`.
2. Editors may attach a P407 qualifier on the same statement naming the
   language entity; the Books data model calls for such language qualifiers.

In the 2026-09-05 corpus probes every title statement carried its language
as the monolingual text tag and none carried a P407 qualifier. The model and
the wider dataset use both encodings, so decoders should accept both. When
the title statement has no usable language, keep the evidence but mark Title
Language unknown rather than guessing from the item label or edition
language.

### References

Statements may carry reference groups (`references` with `snaks` in entity
JSON). References do not decide whether a title is attested; they are
provenance for source warnings and for later mismatch reporting, matching the
product's "claims and their original provenance" rule in architecture.md.

## API comparison

All URLs are public, read-only endpoints. Action API responses use
`format=json&formatversion=2`.

### Discovery: label/alias search

`wbsearchentities`:

- Endpoint: `https://www.wikidata.org/w/api.php`
- Purpose: structured, language-aware search over entity labels and aliases
  (plus descriptions through the separate CirrusSearch path).
- Parameters: `action=wbsearchentities`, `search`, `language`,
  `strictlanguage`, `type=item`, `limit` (0-50, default 7), `continue`
  (offset 0-10000, default 0), `props` (default `url`).
- Each result includes the QID, the matched `label`, `description`,
  `aliases`, and a `match` object recording the exact matched text, its
  language, and whether the match came from a label or an alias.
- Observed latency: 0.11-0.21 s for corpus searches.

Behavior notes:

- Matching is relevance-ranked and start-anchored over labels/aliases in the
  requested language, with fallback unless `strictlanguage` is set. A query
  in `zh` matched both `zh` and `zh-hans` values; a `zh-hant` query matched
  the traditional alias form `百年孤寂`.
- A search can return Works, Editions, films, disambiguation pages, and other
  entity types. Entity type is decided only after reading claims.
- Search is the right tool for "I have a human title"; it is not a claim or
  an attestation source.

### Discovery: full-text search with structural keywords

`list=search` (CirrusSearch) over `Special:Search`:

- Endpoint: same `w/api.php` with `action=query&list=search`.
- Purpose: Elasticsearch-backed full-text search across labels, aliases,
  descriptions, and statements.
- Wikidata keywords documented by the Data access page: `haswbstatement`,
  `inlabel`, `wbstatementquantity`, `hasdescription`, `haslabel`.
- ISBN lookup example that returned the correct single Edition
  (Q69966015) on 2026-09-05:

  ```text
  action=query&list=search&srsearch=haswbstatement:P212=978-7-5327-6554-6
  ```

  `srnamespace=0` restricts to items; results carry page titles that are QIDs
  and snippets, so the caller parses QIDs from `title`.
- Observed latency: 0.07-0.17 s.

Use this path for structured property-value discovery such as ISBN, and for
description/alias text queries that `wbsearchentities` does not cover.
Relevance ranking and snippets are Search Alias material, not evidence.

### Entity reads

Three read paths return the same underlying entity document fields
(labels, aliases, descriptions, claims with ranks/qualifiers/references,
sitelinks):

- `wbgetentities` (`action=wbgetentities`): batch reads of up to 50 IDs
  (500 for high-limit clients), supports `sites`/`titles`, `redirects=yes`
  by default, `languages`, `languagefallback`, `sitefilter`, and
  `props=info|sitelinks|aliases|labels|descriptions|claims|datatype`.
- `Special:EntityData` (Linked Data Interface): one entity per request as
  `https://www.wikidata.org/wiki/Special:EntityData/Q42.json`; content
  negotiation and `?flavor=` for RDF forms. The JSON body is the same shape
  as the `wbgetentities` per-entity object, including revision metadata.
- Wikibase REST API v1: base URL
  `https://www.wikidata.org/w/rest.php/wikibase/v1`; item route
  `/entities/items/{id}`. Response uses `statements` with explicit `rank`,
  `qualifiers`, `references`, and typed `value` objects, plus `labels`,
  `aliases`, `descriptions`. OpenAPI documentation exists. The API is still
  "under development" per the Data access page and is rate limited like the
  Action API.

Observed latency on single-item reads: `wbgetentities` 0.10-0.24 s,
`Special:EntityData` 0.12 s, REST v1 0.09 s.

Recommendation: decode the Action API/EntityData entity document for the MVP
because search results, batch reads, and single reads share one shape and one
limit model. REST v1 is documented as the future direction and already usable,
but adds a second decoder before it offers batching or entity search.

### SPARQL (WDQS)

- Endpoint: `https://query.wikidata.org/sparql`
- Formats: `format=json` or `Accept: application/sparql-results+json`.
- Use GET for small fixed queries (GET responses are server-cached, currently
  about 5 minutes); POST is not cached and is for large queries only.
- Documented service constraints include: 60 s per-query deadline; roughly
  60 s of processing per 60 s per client; 30 error queries per minute; 5
  parallel queries per IP; 429 throttling with `Retry-After`; complete
  blocking for clients without a proper User-Agent.
- Public availability target is low by design (95% SLO in the current
  technical-interactions documentation, with update lag under 10 minutes),
  and Wikimedia's own guidance discourages synchronous user-facing dependency
  on WDQS. For an external interactive tool this means: keep WDQS optional,
  cache responses client-side, use short deadlines, and degrade to partial
  results.

Use WDQS only for bounded relationship shapes; do not use it for text/fuzzy
search. `FILTER(REGEX(...))` over labels is documented as an antipattern, and
a naive `rdfs:label` prefix filter over unconstrained items times out.

### API comparison summary

| Need | Recommended path | Notes |
| --- | --- | --- |
| Chinese/other title to candidate QIDs | `wbsearchentities` | Language-aware, relevant, cheap; results are clues |
| Structured value lookup (ISBN) | fixed SPARQL VALUES, or `list=search haswbstatement` | Both probe-verified; keep one primary, one fallback |
| Candidate classification and display | `wbgetentities` batch; `Special:EntityData` for a single read | Same entity JSON shape |
| Work-to-Edition expansion | fixed SPARQL on P629 | Work P747 index is partial and duplicated |
| Provenance/full claims of chosen Editions | `wbgetentities` batch after narrowing | Preserve ranks/qualifiers/references |

## Fixed low-complexity SPARQL shapes

Only these fixed shapes are recommended, and only bound values ever change:
a confirmed Work QID or a normalized ISBN. User text is never spliced into
SPARQL.

Shape 1 - count editions of a Work (diagnostics, optional):

```sparql
SELECT (COUNT(DISTINCT ?e) AS ?n) WHERE {
  ?e wdt:P629 wd:Q25338 .
}
```

Shape 2 - enumerate Editions of a Work with edition class, title text, title
language, ISBN:

```sparql
SELECT DISTINCT ?e ?eLabel ?title ?langLabel ?isbn WHERE {
  VALUES ?work { wd:Q25338 }
  ?e wdt:P629 ?work .
  ?e wdt:P31/wdt:P279* wd:Q3331189 .
  ?e p:P1476 ?st .
  ?st ps:P1476 ?title .
  OPTIONAL { ?st pq:P407 ?lang . }
  OPTIONAL { ?e wdt:P212 ?isbn . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,zh,ja,fr". }
} LIMIT 200
```

Notes:

- `wdt:P31/wdt:P279*` admits direct and subclass Edition classes such as
  `print edition` (Q59466300). Avoid unbounded `wdt:P279+` from a broad
  class; an accidental full-hierarchy probe returned an enormous ontology
  expansion and was the slowest query measured (about 2 s).
- The result literal carries `xml:lang`; decode `LANG(?title)`.
- Filtering by language should read the monolingual text tag
  (`FILTER(LANG(?title)="zh" || STRSTARTS(LANG(?title),"zh-"))`),
  optionally cross-checked against a `pq:P407` qualifier when present; do
  not assume every title statement carries one encoding.
- The label service returns labels/aliases/descriptions in the requested
  languages with fallback; they remain display/clue data.

Shape 3 - ISBN to Edition/Work lookup:

```sparql
SELECT ?e ?eLabel WHERE {
  VALUES ?isbn { "978-7-5327-6554-6" }
  ?e wdt:P212 ?isbn .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,zh". }
}
```

Probe result: returned Q69966015. Equivalent CirrusSearch probe returned the
same item. This shape avoids literal scanning and keeps complexity constant.

Shape 4 - all-language titles with qualifier languages for a chosen small set
of Edition IDs (used after narrowing, or as an alternative to re-reading
entities):

```sparql
SELECT ?e ?title ?lang ?langLabel ?subtitle WHERE {
  VALUES ?e { wd:Q28147691 wd:Q53839866 }
  ?e p:P1476 ?st .
  ?st ps:P1476 ?title .
  OPTIONAL { ?st pq:P407 ?lang . }
  OPTIONAL { ?st pq:P1680 ?subtitle . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

An exact run of Shape 2 for Q25338 on 2026-09-05 returned 26 Edition rows
with title-language tags and ISBNs in about 0.7 s. None of these shapes scans
the whole graph; each binds a Work or a fixed set of Editions first.

## Distinguishing labels/aliases from Title Attestations

Product-spec.md lists accepted attestations for this project. For Wikidata
the mapping is:

| Wikidata data | Domain role |
| --- | --- |
| Entity label in any language | Search Alias / display clue |
| Entity aliases | Search Alias / display clue |
| Entity description | Search Alias / disambiguation clue |
| Search snippet or match text | Search Alias / disambiguation clue |
| Wikipedia sitelink title | Search Alias / disambiguation clue |
| `title` (P1476) statement on a qualifying Edition (rank not deprecated) | Title Attestation for that Edition, including its Title Language when known |
| Work `title` (P1476) statement | Work-level Original Title evidence only, never Verified Edition evidence |
| Edition's own label, even when it looks like a title | Clue; cannot attest without a P1476 statement |

Observed examples that make the distinction concrete (2026-09-05):

- Edition Q69966015 (Chinese 2014 Shanghai Translation edition of Q751348)
  has P31 = Q3331189, P629 = Q751348, ISBN, publisher, date, and a zh label
  `挪威的森林` — but no P1476 statement. Its zh label is therefore a Search
  Alias, not a Title Attestation, even though the item is clearly an Edition.
- Edition Q112416172 (Clean Code, Japanese translation, P629 to Q109996684)
  has Japanese, English, and Chinese-script labels but no P1476 statement.
  The Chinese labels are aliases/clues only.
- Edition Q125131191 (2003 Anchor English edition of Q151919) has
  P1476 = "To Live" with monolingual language `en`, P407 = English, ISBN,
  publisher, date, and reference groups. This is a clean Title Attestation
  example.
- Work Q151919 carries P1476 titles `活着` and `To Live`. Under the product
  rule these are Work-level evidence of an Original Title, not Edition
  attestations.

## Acceptance-corpus observations

Live probes for the product-spec acceptance corpus (2026-09-05). Treat as
reproducible examples, not permanent test assertions.

| Query | Search behavior observed | Wikidata anchor |
| --- | --- | --- |
| `百年孤独` (zh) | Returns the novel (Q178869) and a 2008 single (Q11285849) | Work Q178869 |
| `百年孤寂` (zh-Hant) | Finds Q178869 by traditional label/alias; also a 2024 TV series (Q124175370) | Work Q178869 |
| `小王子` (zh) | Returns the novel (Q25338), the 2015 film, the 1974 film, a TV series, an opera | Work Q25338 |
| `1984` (zh) | Matches the novel by alias `1984`; also US ad, natural number, year, Olympics | Work Q208460 |
| `挪威的森林` (zh) | Returns the novel (Q751348), a film, and the Chinese Edition Q69966015 itself | Work Q751348 |
| `活着` (zh) | Returns a 1994 film, the novel (Q151919), and other same-title items | Work Q151919 |
| `代码整洁之道` (zh) | No results: no Chinese label/alias exists on Wikidata for the Work | See below |
| `Clean Code` (en) | Work Q109996684, concept item Q1099360, an audiobook, and an Edition Q112416172 | Work Q109996684 |

Implications:

- Ambiguous and short titles require candidates plus claims, not silent
  resolution (fits #6/#7).
- Chinese-label coverage is uneven. `代码整洁之道` is absent while the Work
  and one Japanese edition exist under other labels. Open Library remains the
  primary source for such Chinese titles; Wikidata search should fall back to
  the other-language label when the requested language returns nothing.
- Edition search results are a real source of candidate clues: the `挪威的森林`
  query surfaced Edition Q69966015 whose P629 links to Work Q751348. Such an
  indirect candidate is Probable evidence until confirmed (#7).

## Latency, etiquette, limits, and failure behavior

Measured latency from the probe machine (US-East network, single requests,
identifying User-Agent):

| Path | Observed range |
| --- | --- |
| `wbsearchentities` | 0.11-0.21 s |
| `list=search` with `haswbstatement` | 0.07-0.17 s |
| `wbgetentities` (single item) | 0.10-0.24 s |
| `Special:EntityData` JSON | 0.12 s |
| REST v1 item read | 0.09 s |
| Fixed SPARQL queries above | 0.07-0.67 s |
| Unbounded subclass-path probe | ~2 s (do not ship this) |

Latency is observational, not a guarantee.

Operational constraints from primary documentation:

- User-Agent policy: requests must carry a meaningful User-Agent with contact
  information; missing/generic agents are blocked, and WDQS can block
  non-compliant clients entirely. Browser clients can use `Api-User-Agent`.
- Robot policy: send `Accept-Encoding: gzip,deflate`; keep request rate low;
  make requests in series rather than parallel. There is no hard read limit
  on the Action API but abusive rates can be blocked.
- `maxlag` is recommended for non-interactive Action API work.
- Throttling returns HTTP 429 with `Retry-After`; honor it and stop sending.
  Ignoring 429 can lead to temporary bans.
- Wikimedia sets global API rate limits for the public Wikimedia APIs in
  addition to edit-action rate limits; WDQS adds its own processing-second,
  error, and parallel-query limits.
- Ordinary 4xx responses are not retried; eligible 5xx/network failures get
  bounded retries; cancellation aborts immediately (architecture.md policy).
- The default per-source deadline of eight seconds and overall twelve seconds
  already give headroom for the measured fixed queries, but WDQS variability
  is the reason it must not be on the critical path without caching.

Partial failure guidance:

- "No record" (200 with zero results), malformed data, throttling, timeout,
  and total outage are distinct outcomes.
- When WDQS is slow or down, skip the SPARQL step and still deliver entity
  reads, Work P747-derived Edition indices, and Open Library evidence, with a
  source warning.
- When search succeeds but reads fail for one candidate, keep other
  candidates and warn; never fabricate claims from labels.

## Cacheability

Documented and observed cache behavior:

- WDQS GET query results are server-cached for a limited period (about 5
  minutes); the service explicitly recommends client-side caching for longer
  retention and for data that need not be current.
- `Special:EntityData` responses observed `cache-control: private, s-maxage=0,
  max-age=0, must-revalidate, no-transform`; they must not be treated as
  HTTP-cacheable shared responses.
- REST v1 responses observed `cache-control: no-cache` plus `ETag` and
  `Last-Modified`; the ETag echoed the entity's last revision ID
  (`W/"2081501219"` matched `lastrevid` in EntityData).
- The MVP cache already stores raw HTTP responses with source-specific TTLs
  (search 24 h, Work/Edition details 7 days, negative 1 h) and marks stale
  entries; that design matches Wikidata's requirements. Cached merged
  conclusions must stay out of the cache (architecture.md).
- Response identity for caching must include the exact normalized request,
  endpoint host, format, language parameters, and the schema/decoder version.

## Pagination

- `wbsearchentities`: `limit` (max 50) and `continue` (offset, 0-10000).
  Default limit is 7; use 20-30 for interactive candidate search and page only
  when a user requests more.
- `wbgetentities`: batch up to 50 IDs per request; batch Edition IDs in
  groups of 50.
- `list=search`: MediaWiki continuation object; `sroffset` pages results.
- SPARQL: `LIMIT` bounds results; do not use large `OFFSET` paging for
  editions. Current corpus Work-to-Edition sets fit in one request
  (largest observed 30 editions), and a hard limit such as 200 guards growth.

## Redirects

- `wbgetentities` resolves redirects by default (`redirects=yes`). With
  `redirects=no`, a redirected QID is treated like a deleted entity.
- WDQS resolves redirects in its data, so P629/P747 enumeration is already
  redirect-safe.
- The pipeline should preserve both the requested QID and the resolved QID,
  mirroring the Open Library redirect behavior documented in architecture.md.

## One recommended bounded retrieval pipeline

For a user query with Chinese title and optional author/ISBN/year, Wikidata
contributes this bounded path (Open Library remains the primary source; the
steps below define the Wikidata portion only).

1. Discovery: run `wbsearchentities` with `language=zh` (limit ~20, type
   item). If the query contains traditional characters and returned nothing,
   run one more with `language=zh-hant`. If the query is numeric/short, this
   step intentionally returns multiple same-title candidates.
2. Candidate shape: batch-read the top candidates with `wbgetentities`
   (props `info|labels|aliases|descriptions|claims|sitelinks`, targeted
   `languages`). Classify each as Work, Edition, or Other using P31:
   Edition if P31 includes Q3331189 or a subclass; Work if P31 is a Work
   class (commonly under Q386724); otherwise Other. Build Work Candidates
   from matched Works and from the Works that matched Editions point to via
   P629. Keep the matched label/alias and its language as the Search Alias
   evidence.
3. Resolution (after the user or a strong identifier confirms the Work):
   read the confirmed Work entity and capture its P31, P50, P577, P648, P1476
   (Work-level Original Title evidence), and P747 count as context.
4. Edition expansion: run the fixed Shape 2 SPARQL with the confirmed Work
   QID. If WDQS fails or times out, fall back to the Work's P747 values
   (deduplicated) and read those Editions with `wbgetentities`.
5. Attestation extraction: from Edition reads (or SPARQL rows), keep Edition
   title attestations as P1476 statements with rank not deprecated; title text
   and Title Language come from the monolingual text; P1680 qualifiers are
   subtitles; P407 gives content-language and title-language context. Labels
   and aliases of the Edition never enter the Attested Title set.
6. Identifier resolution: for a supplied ISBN, run fixed Shape 3 SPARQL
   first; fall back to CirrusSearch `haswbstatement:P212=`. The result is an
   Edition candidate whose Work must still pass classification.
7. Result assembly: keep every source record, its claims/ranks, fetched-at
   timestamp, warnings, and stale state, and pass evidence to Core per #7.
   Ambiguous Editions (for example a clear Edition with no P1476) remain
   Ambiguous evidence, not silently promoted or discarded.

This pipeline uses at most a small constant number of requests per lookup
(two searches, one candidate batch read, one optional SPARQL, one to two
target-language Edition reads), each already within interactive budgets.

## Fixtures to build for provider tests

Minimized fixtures should be derived from these observed records and marked
"as of 2026-09-05" so they are not mistaken for stable upstream assertions:

- F1 Work with clean claims: Q151919 (P31 Q47461344, P1476 titles with zh and
  en monolingual values, P50, P577, P648).
- F2 Edition with a full Title Attestation: Q125131191 (P31 Q3331189,
  P629 Q151919, P1476 "To Live"/en, P407, ISBN, publisher, reference group).
- F3 Edition with only label title: Q69966015 (P31 Q3331189, P629 Q751348,
  ISBN, no P1476, no P407) — ambiguous case.
- F4 Search result object including an alias match (Q208460 for "1984") and
  a label match, including the `match` block.
- F5 Work/edition classification set: Q25338 plus one P31 edition, one
  P31 "translation"-tagged Edition (Q50476449), and one P629-bearing film
  (Q61436438) for the non-edition exclusion test.
- F6 Deprecated identifier handling: Q208460 P648 deprecated/normal pair.
- F7 WDQS JSON result rows from Shape 2 and a 429 `Retry-After` synthetic
  response.

## Fallbacks

- WDQS unavailable -> Work P747 index plus entity reads; if that is
  incomplete, rely on Open Library edition data and warn.
- Entity reads unavailable -> keep search results as untyped candidates with
  a source warning; no claims are assumed.
- Search returns nothing for the requested language -> try a different
  language script (zh-Hans/zh-Hant) or the OL path; an absent Wikidata label
  is not a no-result for the product.
- No title statement on an otherwise valid Edition -> Ambiguous, no
  attestation.

## Explicit inputs to downstream tickets

For #6 (catalog module interface):

- The Wikidata provider exposes evidence-oriented operations, not raw HTTP:
  title candidate search, entity read by Wikidata reference, Work edition
  expansion (fixed shapes), and ISBN lookup.
- Work Candidates carry a Wikidata reference plus Search Alias evidence and a
  provisional Work/Edition/Other classification; nothing is silently
  resolved from search alone.
- A confirmed Work expands to Editions through one fixed operation whose
  absence produces partial results, not failure.

For #7 (evidence reconciliation):

- Labels/aliases/descriptions/sitelinks/snippets from Wikidata are Search
  Aliases, never Title Attestations.
- A Wikidata Title Attestation requires an Edition with P31 edition class,
  a Work connection via P629 (or an equivalent strong identifier), and a
  non-deprecated P1476 statement.
- Title Language comes from the P1476 monolingual tag or its P407 qualifier;
  edition-level P407 is content-language context. Unknown stays explicit.
- Work P1476 statements are Work-level Original Title evidence only.
- Rank handling: deprecated claims are excluded; conflicts among preferred
  and normal claims surface as warnings.

For #8 (provider decoding and HTTP seams):

- Decode one entity JSON shape (Action API/EntityData) plus the SPARQL JSON
  result shape; preserve claims, ranks, qualifiers, references, and labels.
- Requests: proper User-Agent, GET, gzip, serialized requests, `maxlag` for
  non-interactive steps, and a small per-provider concurrency budget.
- Errors: distinguish empty, malformed, 429 with `Retry-After`, timeout, and
  outage; no retry on ordinary 4xx; bounded retry otherwise; AbortSignal
  propagation.
- Fix the fixed SPARQL shapes as constants with bound-value substitution
  only; never accept user-authored SPARQL.

For #10 (cache and configuration):

- Cache raw Wikidata responses per endpoint with exact normalized request
  identity; do not rely on HTTP cache headers (`no-cache`/`private` on entity
  reads).
- Keep the product TTL policy for search, detail, and negative results; WDQS
  server caching (~5 min) is a courtesy, not a cache contract.
- REST ETag/Last-Modified may later support revalidation, but the MVP does
  not need a second decoder to benefit from caching.

## Unknowns and risks

- Edition coverage is sparse and uneven; most corpus Works have well under a
  hundred Wikidata Editions while Open Library lists hundreds of real
  Editions.
- Title encoding conventions vary: some Editions use P1476 with a language
  qualifier, others only the monolingual text, others no title statement at
  all.
- `translation` (Q7553) and other non-Q3331189 classes may accompany Edition
  items; classification heuristics need fixture coverage.
- The P747 inverse Edition index is optional and observed as partial and
  duplicated.
- WDQS is mid-migration to a new backend and public interface; documented
  limits and RDF behavior may change.
- The Wikibase REST API is under development; its current v1 item route is
  usable but batching and search parity are not yet there.
- Entity counts, labels, and claims are community-maintained and change
  without notice; examples in this report are snapshots for 2026-09-05.
- Chinese-language label coverage lags real catalogs, so Chinese editions
  often cannot be attested from Wikidata even when an Edition item exists.

## References

Primary documentation consulted on 2026-09-05:

- Wikidata:Data access
  https://www.wikidata.org/wiki/Wikidata:Data_access
- Wikidata:WikiProject Books/Book data model
  https://www.wikidata.org/wiki/Wikidata:WikiProject_Books/Book_data_model
- Wikidata Query Service/User Manual
  https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual
- Wikidata Query Service/Technical interactions
  https://wikitech.wikimedia.org/wiki/Wikidata_Query_Service/Technical_interactions
- Wikidata Query Service/Migration/Rewrite of MWAPI
  https://wikitech.wikimedia.org/wiki/Wikidata_Query_Service/Migration/Rewrite_of_MWAPI
- API:Etiquette
  https://www.mediawiki.org/wiki/API:Etiquette
- Wikidata REST API
  https://www.wikidata.org/wiki/Wikidata:REST_API
- Action API module help for `wbsearchentities` and `wbgetentities`
  (retrieved through action=help and action=paraminfo on wikidata.org)
- Help:Extension:WikibaseCirrusSearch (haswbstatement and friends)
  https://www.mediawiki.org/wiki/Help:Extension:WikibaseCirrusSearch
- Wikimedia Foundation User-Agent policy and API usage guidelines
  https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
  https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines

Entity snapshots referenced above were read from live Wikidata item and
property data on 2026-09-05: Q25338, Q178869, Q208460, Q751348, Q151919,
Q109996684, Q69966015, Q112416172, Q125131191, Q50476449, Q61436438,
Q3331189, Q59466300, Q7725634, Q47461344, Q386724.
