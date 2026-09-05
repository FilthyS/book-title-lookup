# Data-Source Evaluation

## Decision Summary

The MVP uses Open Library as its primary bibliographic source and Wikidata as a
supplementary identity and edition source. Google Books is a later, optional
adapter requiring user-supplied credentials. WorldCat is not an MVP source
because its production APIs are not generally available to an independent
open-source tool.

No source is treated as globally canonical. The product preserves provenance,
reconciles evidence, and reports conflicts.

## Open Library

### Strengths

- Open, public API suitable for low-volume human-facing discovery.
- Explicit Work and Edition records.
- Search can return both Work- and Edition-level fields.
- Editions can expose language, ISBN, publisher, date, original work title, and
  translated-from language.
- Large multilingual catalog and downloadable data dumps.

### Constraints

- Work grouping is incomplete and can contain duplicate or isolated Works.
- Language and relationship metadata are frequently missing.
- Search preference parameters influence ranking but do not guarantee a
  language filter.
- API usage should be cached and identified with a useful `User-Agent`.
- The documented default limit is one request per second for unidentified
  clients and three requests per second for identified clients.
- The API is not intended as a high-traffic third-party backend.

### Observed Resolution Case

On the date of initial design research, searching Open Library for `百年孤独`
returned a Chinese Edition under a Work with only one Edition. That Edition
record included:

- title `百年孤独`;
- Content Language `chi`;
- `work_titles` containing `Cien años de soledad`;
- translated-from language `spa`;
- an Open Library Work relation pointing to the isolated Work.

Searching the original title with Gabriel García Márquez found a different Work
with more than two hundred Editions and many languages.

This case establishes two requirements:

1. a direct upstream Work relationship is evidence but not infallible;
2. original-title and author clues may discover a stronger candidate, but
   indirect resolution must remain explainable and require confirmation.

Counts and records will change as the community edits the catalog, so this is a
design example rather than a permanent test assertion.

### Official References

- [Open Library APIs](https://openlibrary.org/developers/api)
- [Open Library Search API](https://openlibrary.org/dev/docs/api/search)
- [Open Library data licensing](https://openlibrary.org/developers/licensing)
- [Open Library data dumps](https://openlibrary.org/developers/dumps)

## Wikidata

### Strengths

- CC0 structured data.
- Multilingual entity search, labels, aliases, and descriptions.
- A documented two-level book model distinguishing Works from Editions or
  translations.
- Properties for edition-of relationships, titles, languages, authors,
  translators, publication dates, publishers, and external identifiers.
- Useful cross-catalog identifiers for identity reconciliation.

### Constraints

- Labels and aliases name entities but do not prove publication under those
  names.
- Edition coverage is sparse relative to notable Work coverage.
- Book modeling practices are community conventions and records may not follow
  them consistently.
- The public SPARQL service has intentionally limited availability and variable
  response times.
- Clients must identify themselves, limit query complexity, cache responses,
  and respect 429 responses.

### Access Strategy

Use entity search and direct entity reads for interactive discovery. Use only
fixed, low-complexity SPARQL queries where relationship traversal cannot be
performed reasonably through entity statements.

Never interpolate arbitrary user SPARQL. User text is passed only as encoded
search input or bound values in fixed request construction.

Wikidata labels and aliases are Search Aliases. A title property on a qualifying
Edition can become a Title Attestation when its language and Work relationship
are sufficiently clear.

### Official References

- [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access/en)
- [WikiProject Books data model](https://www.wikidata.org/wiki/Wikidata:WikiProject_Books/Book_data_model)
- [Wikidata Query Service technical interactions](https://wikitech.wikimedia.org/wiki/Wikidata_Query_Service/Technical_interactions)

## Google Books

### Potential Value

- Broad Volume search.
- ISBN and other industry identifiers.
- Useful fallback publication metadata for editions missing elsewhere.

### Why It Is Deferred

- Public requests require an API key or OAuth credential.
- The primary entity is a Volume rather than a reliable cross-language Work.
- Work-level reconciliation remains the application's responsibility.
- It adds credential configuration and another quota/failure model before the
  open-source pipeline is validated.

The future adapter is optional and disabled without an explicit user key.

### Official Reference

- [Google Books API usage](https://developers.google.com/books/docs/v1/using)

## WorldCat

WorldCat offers broad library catalog coverage, but current production search
APIs require qualifying institutional subscriptions or commercial
arrangements. It is therefore unsuitable as a default dependency for a freely
installable personal tool.

### Official References

- [WorldCat Search API](https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html)
- [OCLC API eligibility](https://www.oclc.org/developer/support/eligibility.en.html)

## Revisit Triggers

Re-evaluate this source mix when:

- Open Library cannot meet acceptance-corpus recall after indirect resolution;
- Wikidata availability materially harms interactive latency;
- users request a credentialed high-coverage mode;
- an open library catalog provides stronger Work–Edition relationships;
- traffic grows beyond low-volume interactive use;
- the product begins supporting batch lookup.

