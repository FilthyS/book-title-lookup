# Product Specification

## Product Statement

Book Title Lookup identifies a written work from a title in one language and
finds evidence of titles under which that work was published in other
languages.

The MVP accepts a Chinese title and presents an English user interface. Later
interface locales will include Simplified Chinese and Japanese. Titles from
source records are always displayed in their recorded language and are never
localized as interface text.

## Product Principle

An attested title and a suggested translation are different products.

The MVP returns only titles supported by bibliographic evidence. It does not
generate machine translations when evidence is absent, and it never presents a
search alias, transliteration, or Wikipedia article name as a published title
without edition-level evidence.

## Intended Users

The initial user is a reader or researcher performing low-volume, interactive
lookups on a local computer. The project should remain suitable for open-source
distribution but is not intended to provide a high-traffic bibliographic
backend.

## MVP Goals

1. Resolve a Chinese title to the intended written work without silently
   guessing when multiple works are plausible.
2. Find titles supported by real publication records in selected target
   languages.
3. Preserve enough evidence for a user to understand and verify every result.
4. Continue with clearly marked partial results when one data source fails.
5. Support both a keyboard-first full-screen TUI and deterministic automation.
6. Run locally without an account and without mandatory API credentials.

## Non-Goals

The MVP does not provide:

- machine-generated title translations;
- user accounts, cloud synchronization, favorites, or query history;
- a public or local HTTP backend;
- a web or mobile interface;
- a public third-party provider plugin API;
- batch harvesting or bulk catalog import;
- book covers or full-text content;
- edits back to external catalogs;
- Google Books integration;
- Chinese or Japanese interface translations;
- package-manager recipes for Homebrew, Winget, or Scoop.

## Supported Bibliographic Scope

The MVP supports independently identifiable, formally published written works,
including fiction, nonfiction, technical books, textbooks, picture books, and
graphic novels.

The MVP excludes periodicals, individual articles, chapters, whole series,
unpublished web fiction, audio books, study guides, summaries, adaptations, and
screen works. Multi-volume publications are looked up by individual volume.

Complete print and electronic editions may attest titles. A revised edition
may attest a title while retaining its edition statement. A record explicitly
identified as abridged, excerpted, or summarized does not provide default title
evidence. A collection containing a work cannot use the collection title as
evidence for the contained work.

If a source does not provide enough information to classify a record safely,
the record is retained as ambiguous evidence rather than silently included or
discarded.

## Query Contract

### Inputs

- Chinese title: required
- Author or responsible creator: optional
- ISBN: optional
- Publication year: optional
- Target languages: zero, one, or many

No target language means all discovered languages. Language preferences use
BCP 47-style tags where the available evidence supports language, script, or
region distinctions, such as `zh-Hans`, `zh-Hant`, and `pt-BR`.

An explicit namespaced external reference may be passed to the `resolve`
operation. Title Language and Content Language are never inferred solely from
the characters used in a title.

### Work Disambiguation

Title-based searches return Work Candidates. They do not silently select a Work
even when the first search result appears strong.

The application may resolve automatically only when:

- a unique ISBN identifies an Edition and its Work; or
- the user supplies an unambiguous supported External Reference.

Otherwise, the user confirms a candidate using author, original title,
publication year, source, and other available evidence.

### Indirect Resolution

Catalog data may leave a translated Edition attached to an isolated or
incorrect Work. The application may use original title, author, translated-from
language, identifiers, and publication metadata to find a stronger Work
Candidate.

An indirectly resolved candidate is Probable and requires confirmation. Title
similarity alone never resolves a Work automatically.

## Title Evidence

### Accepted Attestations

The following can attest a title:

- an Edition's explicit title;
- an Edition's explicit subtitle;
- a language-tagged title property on a Wikidata edition item;
- an explicitly recorded Work title, only as work-level evidence of an
  Original Title;
- another source field explicitly tied to a publication identifier.

A Work-level Original Title may appear in the corresponding language results,
but it does not become Verified edition evidence unless an Edition also attests
it.

### Search Clues, Not Attestations

The following are search or disambiguation clues by default:

- Open Library `work_titles` and `other_titles`;
- Wikidata labels and aliases;
- Wikipedia article titles;
- search-result snippets;
- transliterations and romanizations;
- strings extracted only from notes, URLs, cover images, or OCR.

A clue becomes an Attested Title only if a separate accepted source ties that
exact title to a qualifying Edition.

## Evidence Levels

Evidence levels are explainable classifications, not numeric probabilities.

**Verified**:
The title is attached to a qualifying Edition that is connected to the Resolved
Work by a direct relation or a strong publication identifier.

**Probable**:
Multiple bibliographic clues consistently connect the title or Edition to the
Resolved Work, but no direct Work–Edition relation or equivalent strong
identifier is available.

**Ambiguous**:
The record may be relevant, but its Work identity, title language, publication
type, or relationship is not sufficiently clear.

The default result list includes Verified and Probable titles. Ambiguous
evidence is shown separately and is never selected as the recommended title.

## Title Representation and Grouping

The domain stores a main title and subtitle separately when the source does so.
It also preserves the source's display form. When a source provides only a
single title string, the application does not guess where a subtitle begins.

Grouping uses:

- explicit Title Language;
- Unicode NFC normalization;
- trimmed leading and trailing whitespace;
- collapsed internal whitespace.

Differences in case, punctuation, wording, or subtitle remain separate Title
Groups. Source spelling is preserved for display.

Within each language, the recommended Title Group is selected deterministically
using:

1. direct edition evidence;
2. a strong identifier such as ISBN;
3. support from multiple independent sources or editions;
4. completeness of publication metadata;
5. a stable lexical and external-reference tie-breaker.

Recency alone does not make a title preferred.

## Multilingual Editions

An Edition may have multiple Content Languages. An Attested Title has one
explicit Title Language or an unknown language.

When a source provides no title-level language:

- a title may inherit the sole Content Language of a monolingual Edition;
- it does not inherit one of several Content Languages from a multilingual
  Edition;
- it is not classified by script detection.

Unknown-language titles appear as ambiguous evidence. They do not satisfy a
specific target-language request.

## Outcomes

The product distinguishes:

- candidates found;
- no matching Work found;
- Work resolved and titles found;
- Work resolved but no attested title found in the requested languages;
- partial results with source warnings;
- all sources failed;
- user cancellation.

Finding no attested title is a valid completed lookup. It does not trigger a
machine translation.

## Source Conflicts

Source Records remain attributable and do not overwrite one another. No source
is globally authoritative for every field.

Conflicting language, date, authorship, or relationship claims remain attached
to their sources and produce an explicit warning. Majority vote alone does not
resolve a conflict.

External References retain their namespace, for example:

- `openlibrary:work:OL274505W`
- `openlibrary:edition:OL59138652M`
- `wikidata:item:Q...`
- `isbn:978...`

The product does not claim to issue a permanent global Work ID. Temporary
candidate identifiers are valid only in the response that contains them.

## TUI Workflow

The full-screen workflow is:

1. Enter title and optional filters.
2. Search while retaining cancellation control.
3. Review Work Candidates.
4. Confirm direct or indirect Work resolution.
5. Review Title Groups by language.
6. Expand a group to inspect editions, sources, warnings, and identifiers.
7. Return to the query without losing editable search fields.

All behavior is keyboard accessible. Mouse support is optional. The interface
must recover the terminal after normal exit, cancellation, and unexpected
errors.

The minimum supported terminal size is `60×16`. A smaller terminal displays a
resize message rather than corrupting the layout.

## CLI Behavior

- Running with no arguments in a TTY starts the TUI.
- Explicit commands use a non-full-screen CLI.
- `--json` never prompts.
- Non-TTY output never starts the full-screen TUI.
- Diagnostics go to stderr; JSON data goes to stdout.
- JSON contains a `schemaVersion`.
- Ambiguous non-interactive searches return candidates and a dedicated exit
  code.
- Ctrl+C cancels work, restores the terminal, and exits conventionally.
- `NO_COLOR` and `TERM=dumb` disable ANSI styling.

## Source Availability

Each source has an independent deadline. The default target is eight seconds
per source and twelve seconds for the complete lookup.

Successful evidence is returned when another source fails, with a `partial`
state and source-specific warnings. "No record" is different from timeout,
rate limiting, invalid credentials, malformed upstream data, and total source
failure.

Retries are bounded:

- honor `Retry-After` for HTTP 429;
- retry eligible network failures and selected 5xx responses at most twice;
- do not retry ordinary 4xx responses;
- stop immediately on user cancellation.

## Cache and Offline Behavior

The MVP caches raw HTTP responses, not merged conclusions.

Default freshness:

- search responses: 24 hours;
- Work and Edition details: 7 days;
- negative results: 1 hour.

Offline mode may use stale cache entries and labels them `stale`. It never
claims stale data is fresh. The product does not save query history.

Users can inspect and clear the cache. Cache files live in the operating
system's standard user cache directory, not in the repository.

## Interface Language

The MVP interface, help, diagnostics, documentation, code identifiers, and JSON
schema use English. User-visible messages are centralized so Simplified Chinese
and Japanese locales can be added later without changing domain or JSON types.

## Acceptance Corpus

Manual and fixture-backed acceptance scenarios include:

| Query | Purpose |
| --- | --- |
| `百年孤独` | Translated Edition may be detached from the principal Work |
| `小王子` | Many languages and Editions |
| `1984` | Short, noisy, ambiguous title |
| `挪威的森林` | Distinct Chinese, Japanese, and English titles |
| `活着` | Chinese Original Title with foreign-language Editions |
| `代码整洁之道` | Technical book, subtitle, and edition differences |
| A known same-title pair | Candidate disambiguation |
| A nonexistent title | Valid no-result outcome |
| A partial source outage | Partial result and source warning |
| Simplified/traditional variants | Script-aware input and language metadata |

Routine tests use minimized, fixed response fixtures. Live source checks are
separate, low-volume smoke tests.

## MVP Completion

The MVP is complete when:

1. formatting, linting, type checking, and automated tests pass;
2. domain and reconciliation rules are covered by unit tests;
3. providers pass fixture-backed contract tests;
4. TUI state tests cover navigation, cancellation, stale responses, and partial
   failure;
5. CLI tests cover stdout, stderr, JSON schema, and exit behavior;
6. npm launcher tests pass platform, argument, signal, and exit-code behavior;
7. Windows Terminal passes manual Chinese input, wide-character, resize,
   cancellation, and terminal-restoration checks;
8. low-volume live smoke tests pass for Open Library and Wikidata;
9. the acceptance corpus has been manually exercised;
10. a Windows binary is built and run successfully;
11. npm packages pass dry-run and tarball inspection.

Publishing to npm or any other registry requires a separate explicit approval.

