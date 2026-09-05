# Open Library Evidence Surface

Research ticket: [GitHub issue #1 — Establish the Open Library evidence
surface](https://github.com/FilthyS/book-title-lookup/issues/1)

Scope: how Open Library endpoints, fields, redirects, relationships, and
failure behavior can support Work discovery, direct and indirect resolution,
Edition expansion, language classification, and accepted title attestations
for the Book Title Lookup MVP across the acceptance corpus.

This report separates **documented** statements (Open Library documentation)
from **observed** statements (read-only live API probes on the retrieval date)
and **inference** (conclusions the project draws from the combination). Live
records change as the community edits the catalog; every example below is a
snapshot, not a permanent test assertion.

## Retrieval date and method

- Documentation pages and source snapshots were retrieved on **2026-09-05**
  (probe timestamps in `America/New_York`, UTC−04:00).
- Live probes were executed on **2026-09-05**, spaced at least 1.3–1.4 s
  apart, one connection at a time, with an identified `User-Agent`
  (`book-title-lookup/0.1` plus a project contact). All probes were
  read-only GET requests to `https://openlibrary.org/...`.
- No requests were written back to Open Library, and nothing on GitHub was
  mutated.
- Responses were decoded strictly as UTF-8 from raw bytes. This matters:
  Open Library serves JSON with `Content-Type: application/json` and no
  `charset`; naive clients that assume Latin-1 corrupt non-ASCII titles.

Documentation consulted:

| Document | URL | Page last edited |
| --- | --- | --- |
| Open Library APIs (usage, rate limits) | <https://openlibrary.org/developers/api> | 2026-05-05 |
| Search API | <https://openlibrary.org/dev/docs/api/search> | 2025-05-07 |
| Books API (Works/Editions/ISBN/Legacy) | <https://openlibrary.org/dev/docs/api/books> | 2025-05-06 |
| Search tips (language codes) | <https://openlibrary.org/search/howto> | 2026-05-14 |
| Works and Editions field guide | <https://openlibrary.org/about/work_edition> | 2020-07-09 |
| Data dumps | <https://openlibrary.org/developers/dumps> | 2025-06-10 |
| Solr schema source snapshot | <https://github.com/internetarchive/openlibrary/blob/b4afa14b0981ae1785c26c71908af99b879fa975/openlibrary/plugins/worksearch/schemes/works.py> | pinned commit |
| `robots.txt` | <https://openlibrary.org/robots.txt> | 2026-09-05 |

The reference commit in the schema link above is the exact snapshot cited by
the Search API documentation; Open Library documents that the schema "is not
guaranteed to be stable".

## Documented guarantees

Open Library's own documentation promises:

- Public JSON, YAML, and RDF/XML representations are available by appending
  `.json` / `.yml` / `.rdf` to an Open Library identifier URL.
- Search returns **Works by default**, while Edition-level fields may be
  requested per document and through the `editions` subfield (only one edition
  per Work is returned today; pagination of that subfield is not yet
  implemented).
- Search supports `q`, fielded queries (`title:`, `author:`, `isbn:`,
  `language:`), `fields`, `sort`, `offset`/`limit`, `page`/`limit`, and a
  `lang` preference parameter.
- `lang` (two-letter ISO 639-1) only influences ranking and never excludes
  results; `language:<code>` in the query excludes Works without an Edition in
  that language.
- Language codes in search and Edition records are three-letter MARC-style
  codes (`eng`, `fre`, `spa`, `chi`, `jpn`, `mul`, `und`, ...), with
  `language:` search fields using the same codes.
- `/works/{key}/editions.json` returns a Work's Editions.
- `/isbn/{isbn}` redirects to the matching Edition page; `.json` may be added.
- The legacy Book API accepts `bibkeys=ISBN:...,OCLC:...,LCCN:...,OLID:...`
  with `jscmd=data`, but it is deprecated ("may be phased out in the future")
  and is not recommended.
- Data dumps are the sanctioned way to obtain bulk data; APIs are for
  low-volume, real-time, human-facing use.
- Unidentified clients are limited to about one request per second and
  identified clients (User-Agent with application name plus contact email) to
  about three requests per second.
- API users should cache responses and must not scrape HTML, distribute
  traffic across five or more IPs, harvest in bulk, make hundreds of
  single-book requests (use `search.json` for batch results), or build
  high-traffic backends.

The rate-limit and "Do Not" language are policy guidance, not a machine-readable
contract; no documented rate-limit HTTP header names exist.

## Observed response contracts

All bodies below are from the 2026-09-05 probes. Response JSON is UTF-8.

### Search API (`/search.json`)

Observed envelope shape (ASCII field names verbatim):

```json
{
  "numFound": 77140,
  "start": 0,
  "numFoundExact": true,
  "num_found": 77140,
  "documentation_url": "https://openlibrary.org/dev/docs/api/search",
  "q": "1984",
  "offset": null,
  "docs": []
}
```

- Both `numFound` and `num_found` are present; they are the same number.
- `numFoundExact` reports whether the count is exact.
- `q` echoes the decoded query; `offset` is echoed (`null` unless `offset` was
  supplied).
- Every `docs[]` item is a Work key (`/works/OL...W`) unless Edition subfields
  are requested.
- Unknown entries in `fields` are silently ignored; only known fields are
  returned (probe `fields=key,title,bogus_field` returned 200 with `key` and
  `title`).
- `limit=500` returned 500 documents with no error. Very large responses are
  expensive; the project should keep limits small.
- Pagination: `page=2&limit=2` and `offset=2&limit=2` returned the identical
  two documents beginning at `start: 2`. In other words `page` starts at 1 and
  behaves as `start = (page − 1) × limit`. (Documented and observed agree.)
- Empty result is a **200** with `numFound: 0` and an empty `docs` array
  (probe of a nonsense phrase), not a 404.
- Query `q=活着` (a two-character Chinese title) returned **422** with a JSON
  validation error: `Value error, Query too short, must be at least 3
  characters`, while the fielded query `title=活着` returned 200. This minimum
  `q` length is **not documented**; it is an observed constraint.
- Works returned by a title search frequently carry the matching title only in
  an alternative field. Example: searching `小王子` returned eleven Works; the
  last-ranked result was the principal Work `OL10263W` whose recorded title is
  `Le petit prince`.

### Record APIs (`/works/...`, `/books/...`)

- `/works/OL45804W.json` returned 200 `application/json` with a Work record.
- `/books/OL7353617M.json` returned 200 `application/json` with an Edition
  record.
- `/works/OL45804W/Fantastic_Mr._Fox.json` (key plus slug plus `.json`)
  returned **404** `{"error":"notfound"}`. The documented and working form is
  the canonical bare key plus `.json`; do not append slugs.
- `/works/OL0000000000W.json` and `/books/OL0000000000M.json` returned **404**
  with body `{"error":"notfound","key":"/works/OL0000000000W"}`. A missing
  record is a JSON 404, not an HTML page.
- `/works/{key}/editions.json` returned:

```json
{
  "links": { "self": "/works/OL45804W/editions.json",
             "work": "/works/OL45804W",
             "next": "/works/OL45804W/editions.json?offset=50" },
  "size": 161,
  "entries": [ ... ]
}
```

  Observed defaults: 50 entries per page. Explicit `offset=50&limit=50`
  returned the next 50 entries and a `next` link of
  `/works/OL45804W/editions.json?limit=50&offset=100`.

### ISBN route and redirects

- `GET /isbn/9780140328721` (no redirect follow) → **302 Found**,
  `Location: https://openlibrary.org/books/OL7353617M`.
- `GET /isbn/9780140328721.json` → **302 Found**,
  `Location: https://openlibrary.org/books/OL7353617M.json`.
- `GET /isbn/9789887553434.json` → **302 Found**,
  `Location: https://openlibrary.org/books/OL49205424M.json`.
- Unknown ISBN → **404** with an **HTML** error page (30 KB), not JSON. This is
  the one observed 404 whose body is HTML; the decoder must key off content
  type and status, not assume JSON.
- Merged keys redirect at the HTML layer: `GET /works/OL45883W` (a merged Work)
  → **301 Moved Permanently**, `Location: https://openlibrary.org/works/OL45804W`.
- The same merged key as JSON, `GET /works/OL45883W.json`, returned **200** with
  the redirect record itself:

```json
{
  "location": "/works/OL45804W",
  "key": "/works/OL45883W",
  "type": { "key": "/type/redirect" },
  ...
}
```

  Therefore the JSON layer does **not** follow redirects for merged records;
  clients must detect `type.key == "/type/redirect"` and resolve `location`
  themselves, preserving both the requested and canonical keys. This matches
  the architecture note "Open Library redirects are followed while preserving
  both requested and canonical references" and places redirect handling in the
  provider HTTP layer.
- One observed Work record (`/works/OL45804W.json`) also carried a `location`
  field pointing at `/works/OL45883W` while the other key was a
  `/type/redirect` pointing back; this is community-maintained merge residue.
  A client should treat `location` on a `/type/redirect` as authoritative and
  ignore it on `/type/work` records.

## Fields by concern

### Search document fields (observed plus pinned schema)

Stable, useful search fields observed in `docs[]`:

| Field | Type | Meaning / notes |
| --- | --- | --- |
| `key` | string | Work key `/works/OL...W` |
| `title`, `subtitle` | string | Work-level title; matching Chinese titles can live on the Work title |
| `author_name`, `author_key` | arrays | Authors in display order; duplicates can appear |
| `first_publish_year` | number | Earliest publication year facet |
| `edition_count` | number | Number of Editions attached to the Work |
| `edition_key` | array | Edition keys of the Work (see caveat below) |
| `language` | array | MARC three-letter codes aggregated from Editions; absent when unknown |
| `cover_edition_key`, `cover_i` | string/number | Cover shortcuts |
| `ia`, `has_fulltext`, `ebook_access`, `public_scan_b` | mixed | Internet Archive availability, present by default |
| `author_alternative_name`, `alternative_title`, `alternative_subtitle` | arrays | Search aliases (mapped from MARC `other_titles` etc.) |

The pinned schema lists many more fetchable fields (`lccn`, `oclc`, `isbn`,
`publisher`, `publish_year`, `subject`, `person`, `place`, `time`, ratings,
reading-log counts, `ddc`, `lcc`, facets).

Caveat about `edition_key`: in the 2026-09-05 probes, `edition_key` contained
the full Edition set of the Work both with and without a `language:chi`
constraint (56 keys for `OL2625457W` in both queries). Treat `edition_key` as
"Edition keys of the Work", not as the language-filtered subset, unless future
evidence shows otherwise.

### Work record fields (observed)

`/works/{key}.json` returned: `key`, `type` (`/type/work`), `title`,
`authors` (`[{type:/type/author_role, author:{key}}]`), `description`,
`first_sentence`, `first_publish_date`, `subjects`, `subject_places`,
`subject_people`, `subject_times`, `covers`, `excerpts`, `links`, `genres`,
`revision`/`latest_revision`, `created`, `last_modified`.

Notably **absent** in every observed Work record: Edition keys, ISBNs,
languages, `work_titles`, and `translation_of`. Work records contain no
in-language title attestation machinery. Editions must be expanded to find
titles and languages.

### Edition record fields (observed)

`/books/{key}.json` returned a superset of the fields below depending on how
complete the record is:

| Field | Meaning |
| --- | --- |
| `key`, `type` (`/type/edition`) | identity |
| `title`, `subtitle`, `full_title` | recorded title; subtitle may be empty |
| `works` | array `[{key: /works/OL...W}]`; the direct Work link(s) |
| `languages` | array `[{key: /languages/chi}]`; present only when recorded |
| `translation_of` | original-title string when a translation records it |
| `translated_from` | array `[{key: /languages/spa}]` |
| `work_titles` | array of MARC 240-style work titles |
| `other_titles` | array of additional recorded titles |
| `authors` | array of author `{key}` links |
| `contributors` | array with roles such as `Translator` |
| `by_statement` | transcribed statement of responsibility |
| `publish_date`, `publish_country`, `publish_places`, `publishers` | publication metadata |
| `isbn_10`, `isbn_13`, `lccn`, `oclc_numbers`, `local_id` | identifiers |
| `series`, `edition_name`, `pagination`, `number_of_pages`, `physical_format` | edition characteristics |
| `notes`, `description`, `source_records` | free text / provenance |
| `covers`, `ocaid`, `classifications`, `identifiers` | media and classification |
| `revision`/`latest_revision`, `created`, `last_modified` | revision metadata |

Fields are not uniformly present. In the 2026-09-05 probes many Edition
records omit `languages`, `translation_of`, `translated_from`, `work_titles`,
or even `authors`.

## Language semantics

Documented:

- `lang` query parameter (ISO 639-1, e.g. `lang=fr`) re-ranks and never
  excludes.
- `language:<marc>` in `q` excludes Works that lack an Edition in that
  language. Examples in docs use `fre`; the Search Tips page lists MARC-style
  codes (`jpn`, `mul`, `und`, ...).
- Edition records carry `languages` as `/languages/<code>` references.

Observed:

- A Work's search `language` array aggregates codes across its Editions.
  `OL10263W` (Le petit prince) lists `chi`, `yue`, `eng`, `fre`, and many
  others; `OL274505W` (Cien años de soledad) lists `chi` among 16 codes.
- `q=小王子 language:chi` returned exactly one Work: the principal
  `OL10263W`. The eleven one-Edition Works returned by `q=小王子` without the
  language filter all disappeared, because their single Editions have **no**
  recorded `languages` field. The language filter is therefore only as good as
  the Edition language metadata; it will hide perfectly relevant records whose
  language was never recorded.
- The same query shape, `q=挪威的森林 language:chi`, returned the single
  aggregate Work `OL2625457W`.
- Edition-level `languages` distinguish languages a naive script reader would
  conflate. ISBN `9789887553434` resolves to an Edition whose record title is
  `小王子 香港粵拼版` with `languages: [/languages/yue]` (Cantonese), a
  `translation_of` of `The Little Prince`, and a Jyutping subtitle. Script
  detection alone would have mislabeled it; the recorded language says `yue`.
- Many Chinese-language Editions record their title in romanization instead of
  Chinese characters (`Bai nian gu du` with `languages: chi`), or describe the
  language in the title string (`Norwegian Wood (in Traditional Chinese, 2
  vols)`), so character-set sniffing cannot be the attestation language.

Implication for the product model: a Chinese-character title is not itself
Title Language evidence. When an Edition lacks a `languages` array the title's
Content Language is unknown, exactly as `docs/product-spec.md` says it should
be treated.

## Work and Edition links, direct and indirect resolution

- Direct relation: an Edition's `works[].key` names its Work. `GET
  /books/{key}.json` and `GET /works/{key}/editions.json` make the relation
  navigable in both directions, and `/isbn/{isbn}.json` (302) plus the legacy
  `bibkeys=OLID:...` (deprecated) let an identifier reach an Edition.
- The direct relation is **not** infallible identity.

The acceptance-corpus case `百年孤独` reproduces the split documented in
`docs/data-sources.md`:

- `q=百年孤独` returned only two one-Edition Works: `OL31608032W`
  (`百年孤独(精)`, edition `OL43283217M`) and `OL43416865W`
  (`百年孤独`, edition `OL59138652M`).
- Edition `OL59138652M` records `title: 百年孤独`,
  `languages: [chi]`, `translated_from: [spa]`,
  `work_titles: ["Cien años de soledad"]`, `other_titles: ["Bai nian gu du"]`,
  a Chinese translator author list, and `works: [{key: /works/OL43416865W}]`.
  The Work `OL43416865W` has exactly one Edition and was created
  2025-05-19.
- The principal Work for the book, `OL274505W` (`Cien años de soledad`,
  208 Editions, languages include `chi`), was **not** in the Chinese-title
  search results at all. It is found by searching the original title
  (`q=Cien años de soledad`, first hit `OL274505W`) or, given the Edition
  clues, by searching `work_titles`/author of the isolated record.
- Under the principal Work, the first editions page includes a chi-language
  Edition, `OL35346764M`, whose `title` is the romanization `Bai nian gu du`
  with subtitle `Cien años de soledad` and `translation_of` absent but
  `work_titles: ["Cien años de soledad"]`. The same Chinese book therefore has
  editions under both an isolated one-Edition Work and the principal Work, and
  the Chinese title text is not uniformly recorded on either.

Direct resolution by ISBN also needs reconciliation:

- ISBN `9789887553434` exists on Edition `OL49205422M` (`title: 小王子`,
  attached to the one-Edition Work `OL36417231W`, no `languages`) **and** on
  Edition `OL49205424M` (`title: 小王子 香港粵拼版`, attached to the principal
  Work `OL10263W`, `languages: [yue]`). The ISBN route redirected to the
  second record. The product's automatic-resolve rule "a unique ISBN
  identifies an Edition and its Work" is therefore only safe when the ISBN
  maps to a single Edition; duplicates like this one must surface as a
  reconciliation decision (issue #7).

Indirect resolution design evidence: the isolated Edition records carry
`work_titles`, `translated_from`, author keys, and (sometimes) `translation_of`
that let a provider form a second query against the original title plus
author. Because author keys are also duplicated across the catalog (the
isolated `OL59138652M` lists author `OL15389184A` while the principal Work
lists `OL27363A`, both for García Márquez), indirect resolution needs
author-name and identifier reconciliation rather than exact-key matching.

## Accepted evidence for title attestation

Mapping Open Library records onto the domain rules in `CONTEXT.md` and
`docs/product-spec.md`:

- **Edition title and subtitle** (`title`, `subtitle`, `full_title`) on an
  Edition connected to the Resolved Work are edition-level attestations
  (Verified candidates).
- **Edition `languages`** provide Content Language when exactly one is
  recorded, or an ambiguous multi-language case when several are recorded.
  Missing `languages` means unknown.
- **Edition `works[].key`** is the direct Work–Edition relation.
- **`translation_of`, `work_titles`, `other_titles`, `notes`, `by_statement`,
  `contributors`, search `alternative_title` matches** are bibliographic clues
  — evidence for a second search and for Probable candidates, not themselves
  edition-title attestations of the target language. A Work-level title is
  work-level evidence only, never Verified edition evidence, as the product
  spec requires.
- **ISBN and OLID links** are strong identifiers for direct resolution and for
  Verified classification when unique; duplicate ISBNs degrade this to
  Probable/Ambiguous until resolved.

## Rate and failure behavior

Documented (Open Library APIs page):

- Default ≈1 request/second for unidentified clients; ≈3 requests/second for
  identified clients (User-Agent with application name and contact email).
- Bulk use and scraping are disallowed; monthly dumps exist for bulk needs.
- Violations may trigger aggressive rate limiting or blocking.
- No documented `Retry-After` or rate-limit header names.

Observed on 2026-09-05:

- All requests sent ≥1.3 s apart with an identified User-Agent succeeded at
  200/3xx except intentionally invalid probes (404, 422). No 429 response and
  no `Retry-After`, `X-RateLimit-*`, or equivalent headers were observed.
- 404 JSON for missing Work/Edition keys; 404 HTML for unknown ISBN; 422 JSON
  for too-short `q`; 200 JSON for empty search.
- Unknown `fields` entries are silently ignored (decoder should not fail on
  response fields it does not know).

The project's source-request policy in `docs/architecture.md` already matches
the documented behavior: identifiable User-Agent with contact, ≤2 concurrent
provider requests, bounded retry honoring `Retry-After`, no retry of ordinary
4xx, per-source deadline. Research confirms these are implementable as
documented, with no secret token or quota screen involved for low-volume use.

## Representative acceptance-corpus probes (2026-09-05)

| Query | Request (exact GET, 2026-09-05) | Result |
| --- | --- | --- |
| `百年孤独` | `/search.json?q=%E7%99%BE%E5%B9%B4%E5%AD%A4%E7%8B%AC&fields=key,title,subtitle,author_name,author_key,first_publish_year,edition_count,language,edition_key&limit=10` | 2 detached one-Edition Works; principal `OL274505W` absent |
| original-title fallback | `/search.json?q=Cien%20a%C3%B1os%20de%20soledad&fields=key,title,author_name,first_publish_year,edition_count,language&limit=3` | principal Work `OL274505W`, 208 Editions |
| `小王子` | `/search.json?q=%E5%B0%8F%E7%8E%8B%E5%AD%90&fields=key,title,author_name,first_publish_year,edition_count&limit=10` | 11 Works; isolated Chinese Works first, principal `OL10263W` last |
| `小王子` + chi filter | `/search.json?q=%E5%B0%8F%E7%8E%8B%E5%AD%90%20language%3Achi&fields=key,title,author_name,edition_count,language,edition_key&limit=10` | only principal `OL10263W` (688 Editions) |
| `1984` | `/search.json?q=1984&fields=key,title,author_name,first_publish_year,edition_count,language&limit=10` | 77,140 hits; relevant Orwell Works buried among year/other matches |
| `1984` chi filter | `/search.json?q=1984%20language%3Achi&fields=key,title,language,edition_key,edition_count&limit=5` | 1,515 hits; principal `OL1168083W` plus other chi-edition Works |
| `挪威的森林` | `/search.json?q=%E6%8C%AA%E5%A8%81%E7%9A%84%E6%A3%AE%E6%9E%97&fields=key,title,subtitle,author_name,author_key,first_publish_year,edition_count,language,edition_key,cover_edition_key&limit=5` | principal `OL2625457W` first (56 Editions) |
| chi editions under principal | `/works/OL2625457W/editions.json` | `挪威的森林` chi Editions plus romanized/Traditional-Chinese titles |
| `活着` (fielded title) | `/search.json?title=%E6%B4%BB%E7%9D%80&fields=key,title,author_name,author_key,first_publish_year,edition_count,language&limit=10` | 4 Works; two 余华 one-Edition Works, a chi film-work, an eng notes record |
| `活着` (q) | `/search.json?q=%E6%B4%BB%E7%9D%80` | **422** "Query too short, must be at least 3 characters" |
| `To Live Yu Hua` | `/search.json?q=To%20Live%20Yu%20Hua&fields=key,title,author_name,author_key,first_publish_year,edition_count,language&limit=8` | multiple unrelated; two Yu Hua English Works `OL15861449W`, `OL8036242W` separate from Chinese-title Works |
| `代码整洁之道` (title/q) | `/search.json?title=%E4%BB%A3%E7%A0%81%E6%95%B4%E6%B4%81%E4%B9%8B%E9%81%93&fields=key,title,subtitle,author_name,first_publish_year,edition_count,language&limit=10` and `q=...&limit=5` | 0 hits; no Open Library record uses this Chinese title |
| nonexistent phrase | `/search.json?q=zzqxqwnonexistentphrasebooknotfound` | 200, `numFound: 0` |
| direct ISBN | `/isbn/9789887553434.json` | 302 → `/books/OL49205424M.json` (Cantonese Edition on principal Work) |
| missing Work/Edition | `/works/OL0000000000W.json`, `/books/OL0000000000M.json` | 404 `{"error":"notfound"}` |
| missing ISBN | `/isbn/9787536692938.json` | 404 HTML page |
| pagination | `/search.json?title=1984&fields=key,title,author_name,first_publish_year,edition_count&limit=2&page=2` vs `offset=2` | identical results, `start: 2` |
| Editions pagination | `/works/OL45804W/editions.json`, `/works/OL45804W/editions.json?offset=50&limit=50` | 50 entries/page with `next` links; `size` 161 |

## Fixture guidance

Open Library records are live and change; every count and key above can move.
Automated tests should use minimized fixed fixtures modeled on these probe
responses, including the awkward cases:

1. detached translated Edition (`OL59138652M` / Work `OL43416865W`) with
   `work_titles`, `translated_from`, and a direct Work link that is not the
   principal Work;
2. principal-Work chi Edition recorded in romanization (`OL35346764M`);
3. isolated Chinese Edition with no `languages` (`OL49205422M`), and the
   duplicate-ISBN companion Edition on the principal Work with `languages:
   yue` (`OL49205424M`);
4. same-title/same-author detached pairs (`OL25129388W` and `OL20903102W`
   for `活着`);
5. many-languages aggregate Work (`OL10263W`, `OL2625457W`, `OL274505W`);
6. noisy short title search (`1984` → 77,140 hits);
7. zero-result search (`numFound: 0`, 200);
8. 422 too-short `q` body and the working `title=` alternative;
9. 404 JSON for missing keys; 404 HTML for unknown ISBN; 302 Location for
   ISBN and merged-key HTML redirects; `/type/redirect` JSON record with
   `location`.

Fixture files should keep the source record URL, fetched-at timestamp, status,
and content type so the provider contract tests can assert both happy paths
and failure classification without live traffic.

## Recommendations

1. Use `/search.json` with **fielded parameters** (`title=`, `author=`,
   `isbn=`, and optional `language:`) for candidate discovery rather than
   bare `q` where possible: it avoids the undocumented 3-character `q`
   minimum (short Chinese titles like `活着`), reduces noise, and keeps
   ranking explainable. Preserve the raw decoded query for cache keys and
   debugging.
2. Do not trust Work search ranking to put the aggregate Work first.
   `小王子` ranked the principal Work last of eleven and `百年孤独` omitted
   it entirely. Present candidates and let the user confirm; run an
   indirect-resolution second search on original-title/author clues for
   one-Edition Works before declaring a Work missing.
3. Expand attestations from the confirmed Work via
   `/works/{key}/editions.json`, paging with `offset`/`limit` (default
   50/page) and caching each page. Never treat `edition_key` from search as
   the language-filtered subset.
4. Resolve identifiers through `/isbn/{isbn}.json` (or a supported OLID path),
   following the 302 to the Edition, then read `works[].key`. Keep requested
   and canonical references. Handle duplicate ISBNs as ambiguous rather than
   auto-resolving.
5. Decode records tolerantly: `languages`, `translation_of`, `work_titles`,
   `other_titles`, authors, and even `title` can be absent. Content Language
   is unknown when `languages` is missing; do not infer from script. Do not
   treat `work_titles`/`other_titles` as attestations.
6. Implement redirect handling in the provider HTTP layer for `/type/redirect`
   records and 3xx `Location` headers, preserving provenance for the report
   "requested and canonical" requirement.
7. Treat `q=... language:chi` as a *secondary* aggregate-Work finder and
   verification tool, never as the primary title search: it silently drops
   records without language metadata.
8. Send an identified User-Agent with a real contact, keep concurrency ≤2 and
   spacing ≥1 request/second per instance for unidentified use, honor
   `Retry-After`, never retry 4xx, and prefer JSON endpoints over HTML.
9. Do not build the MVP on the deprecated legacy Book API; use Works,
   Editions, and `/isbn` routes.
10. Record retrieval dates and record keys next to any live numbers quoted in
    user-facing evidence; counts and relationships will change.

## Unknowns and risks

- **`q` minimum length**: the 3-character minimum is undocumented; it may be
  enforced by validation rather than Solr, and could change. The fielded
  `title=` path is the mitigation.
- **Editions ordering**: `/works/{key}/editions.json` entry ordering is not
  documented; first-page contents in probes were not language/date sorted.
  Reaching a specific language (e.g., a `chi` edition among 688 Little Prince
  Editions) may require paging or an edition-level query and cannot be assumed
  cheap.
- **`edition_key` semantics**: observed as the full Edition set regardless of
  `language:` filter; unverified whether any query can return a filtered
  subset.
- **Rate limiting internals**: no machine-readable rate headers were observed;
  enforcement may be silent or headerless. Safe defaults (identification,
  spacing, caching, bounded retries) are the only defense.
- **Redirect completeness**: only one Work redirect and one ISBN redirect were
  probed; Edition and author redirects follow the same record model but were
  not exhaustively sampled.
- **Duplicate records**: identical ISBNs and duplicated author keys are common;
  there is no API promise of record uniqueness per ISBN.
- **Schema stability**: Open Library warns the Solr schema is not stable;
  response field additions and removals should not break the decoder.

## Conclusions for downstream tickets

### Issue #6 — catalog module interface

Open Library supplies two navigable entity kinds (Work and Edition), a
search-to-Work entry point, identifier-to-Edition entry points, and a
Work→Editions expansion point. The deep catalog interface should therefore
express four source-neutral operations — `search` (yielding Work Candidates),
`resolve` by strong identifier or explicit reference, `expand` a Work to its
Editions, and `attest`/title extraction from Editions — with the Open Library
client mapping to: `search.json` (fielded), `/isbn/{isbn}.json` plus
`/works|/books/{key}.json`, and `/works/{key}/editions.json`. The interface
must return not-found, partial, redirected (requested vs canonical), and
duplicate-identifier states rather than a single "book", because the live
catalog exhibits all of them.

### Issue #7 — evidence reconciliation and recommendation

- An Edition connected to the Resolved Work by `works[].key` attests its
  `title`/`subtitle`; everything else is clue-level.
- A one-Edition Work whose Edition has `work_titles`, `translated_from`,
  author, or `translation_of` clues is the canonical indirect-resolution
  trigger; resulting candidates are Probable until confirmed.
- ISBN identity is not unique; duplicate ISBNs across Editions must be a
  reconciliation warning and reduce Evidence Level.
- `languages` metadata drives Content Language; absence means unknown and must
  not be inferred from characters or script.
- Recommendation ordering must not use search rank as evidence: rank placed
  principal Works last or omitted them in probes.

### Issue #8 — provider decoding and HTTP seams

The decoder needs a tolerant schema with required identity (`key`, `type`)
plus optional known fields; unknown fields and unknown `fields` requests must
not fail. The HTTP seam must expose status-aware outcomes: 200 JSON, 404 JSON
(missing key) vs 404 HTML (missing ISBN), 422 validation JSON, 3xx with
`Location`, and `/type/redirect` records that require a second fetch.
Identification, spacing, retry, `Retry-After`, and content-type detection
belong in the Open Library module; raw upstream JSON never crosses the
provider boundary.

### Issue #10 — cache and configuration seam

Cache keys must include the full normalized request URL because search results
depend on `fields`, `limit`, `offset`/`page`, and the Editions endpoint depends
on `offset`/`limit` per page. Cache the raw status, content type, body, and
`Location` for redirects; a 302 to a canonical Edition key is worth caching as
an identifier-resolution map. Follow the product freshness defaults (search 24
hours, detail 7 days, negative 1 hour) and mark stale entries; the volume and
volatility evidence supports those defaults. Offline mode needs previously
cached editions pages to reconstruct title groups because Work records contain
no title/language evidence themselves.
