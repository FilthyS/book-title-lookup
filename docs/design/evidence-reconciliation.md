# Evidence Reconciliation and Recommendation

Grilling ticket: [GitHub issue #7 — Define evidence reconciliation and
recommendation](https://github.com/FilthyS/book-title-lookup/issues/7)
Blocked by: #1 (Open Library evidence surface), #2 (Wikidata retrieval
strategy) — both closed.

Deliverable: the deterministic, executable-level specification that turns
source claims into Work Candidates, a Resolved Work,
Verified/Probable/Ambiguous title attestations, Title Groups, conflicts, and
one recommended title per language without inventing unsupported confidence.

This document is a design specification, not production code. It defines the
domain reconciliation behavior that `packages/core` will implement and that
unit tests will assert. Fixture data referenced below is derived from the
minimized, fixed snapshots recommended by the research in #1 and #2 and is
dated 2026-09-05; live catalog records are never test assertions.

## 1. Decision

Apply a fixed, source-preserving pipeline that classifies every recorded fact,
never merges Source Records destructively, and derives every classification
from discrete, explainable predicates:

1. Normalize only what comparison requires (NFC, whitespace, identifiers,
   language tags). Preserve raw display forms and provenance.
2. Build Work Candidates from Work hits and from Edition hits by following the
   Edition-to-Work relationship. Deduplicate only across an explicit identity
   mapping. Never let provider search order choose or rank a candidate.
3. Resolve automatically only on a unique strong identifier or an explicit
   supported External Reference; otherwise require user confirmation. Indirect
   resolution finds a stronger candidate from original-title/author clues and
   always leaves that candidate Probable until the user confirms it.
4. Accept edition title attestations only from explicit title fields on an
   in-scope Edition of the Resolved Work (Open Library `title`/`subtitle`;
   Wikidata `title` P1476 with a non-deprecated rank). Work-level title
   statements are Probable original-title evidence only, never Verified.
   Labels, aliases, work-titles, other-titles, transliterations, snippets, and
   article names are Search Clues and can never become attestations.
5. Assign Evidence Level by fixed predicates: Verified requires a direct
   Work–Edition relation or a unique strong identifier; Probable requires at
   least two independent consistent clue facts and no contradiction; Ambiguous
   is everything else, including every attestation whose Title Language is
   unknown. Evidence Level is a three-value explainable classification. There
   is no numeric confidence anywhere.
6. Group titles by explicit Title Language plus a structured normalized text
   tuple; never by script guessing. Unknown Title Language stays unknown.
7. Within each concrete Title Language tag, recommend exactly one Title Group
   using a total, deterministic comparator whose tie-breaker is lexical and
   external-reference based. Ambiguous groups and unknown-language groups are
   never recommended. Recency is never a ranking input.
8. Preserve every conflict as an attributable warning. No source is globally
   authoritative and majority vote never resolves a conflict.

## 2. Baseline and inputs

Authoritative product and domain rules:

- `CONTEXT.md` — Work, Edition, Work Candidate, Resolved Work, Source Record,
  Attested Title, Title Attestation, Title Group, Original Title, Search
  Alias, Suggested Translation, Evidence Level, Content Language, Title
  Language.
- `docs/product-spec.md` — accepted attestations, evidence levels, grouping,
  language, conflicts, outcomes, source availability, acceptance corpus.
- `docs/architecture.md` — evidence-oriented Core boundary, reconciliation
  rules, resolution, provider composition, caching, CLI/process contract.
- `docs/data-sources.md` — Open Library primary, Wikidata supplementary;
  observed 百年孤独 resolution case.
- Accepted ADRs `0001` (evidence-based lookup) and `0002` (local modular
  application).

Research inputs:

- `docs/research/open-library-evidence-surface.md` (issue #1): field mapping,
  direct/indirect resolution, `/type/redirect` and 3xx behavior, duplicate
  ISBNs, language semantics, fixture guidance, issue #7 conclusions.
- `docs/research/wikidata-retrieval-strategy.md` (issue #2): Edition class
  P31 Q3331189, P629 Edition-to-Work edge, P1476 title statements with
  monolingual tags and P407/P1680 qualifiers, rank handling, label/alias
  exclusion, fixed SPARQL shapes, fixture set F1–F7.

## 3. Pipeline overview

```text
Source Records (Open Library, Wikidata)
   │  provider-decoded, provenance preserved, warnings attached   (#8 seam)
   ▼
A. Normalize (comparison keys only)
   ▼
B. Candidate Assembly ──► WorkCandidate[] (ordered deterministically)
   │                              │
   │  user confirms               │ unique strong identifier
   ▼                              ▼
C. Resolve Work ──► indirect-clue check ──► possible stronger candidate
   │                                     (Probable, requires confirmation)
   ▼
D. Bind identity (redirect/canonical refs, cross-source work mapping)
   ▼
E. Expand in-scope Editions of the Resolved Work
   ▼
F. Extract accepted title attestations (edition-level and work-level)
   ▼
G. Assign Evidence Level (Verified / Probable / Ambiguous)
   ▼
H. Group by Title Language + normalized text
   ▼
I. Build language results; choose one recommended Title Group per Title
   Language tag
   ▼
J. Attach conflicts/warnings and return a discriminated Outcome
```

Stages B–J live in Core and are pure given their inputs. Providers deliver
Source Records that already carry `source`, `sourceRecordUrl`, namespaced
references, `fetchedAt`, `stale`, decoded claims, and decoding warnings
(architecture.md; the provider seam is issue #8, the catalog interface issue
#6). This document therefore specifies Core inputs at the claim level.

## 4. Core input model

Core receives normalized, typed records. For reconciliation the essential
structures are:

```text
SourceRecord {
  source: "openlibrary" | "wikidata";
  sourceRecordUrl: string;
  fetchedAt: ISO timestamp;
  stale: boolean;
  kind: "work" | "edition" | "redirect" | "other" | "unknown";
  refs: ExternalRef[];            // namespaced references on this record
  claims: Claim[];                // decoded facts, each with provenance
  warnings: SourceWarning[];      // decoding and conflict warnings
}

Claim {
  type: "title" | "subtitle" | "content-language" | "title-language"
      | "translated-from" | "work-link" | "original-work-title"
      | "author" | "translator" | "publisher" | "publication-date"
      | "publication-year" | "identifier" | "class" | "edition-type"
      | "work-title" | "other-title" | "original-title" ...;
  value: ClaimValue;              // string / language tag / ref / number
  qualifiers: Qualifier[];        // e.g. P1680 subtitle, P407 language
  rank?: "preferred" | "normal" | "deprecated";   // Wikidata only
  statementId?: string;           // provenance within the source
  namespace: string;              // e.g. "openlibrary", "wikidata"
}

ExternalRef { namespace: string; id: string; }   // canonical string form
```

Namespaces used by the MVP:

| Namespace | Form | Applies to |
| --- | --- | --- |
| `openlibrary:work` | `OL274505W` | Work record |
| `openlibrary:edition` | `OL59138652M` | Edition record |
| `wikidata:item` | `Q178869` | Wikidata item (Work or Edition) |
| `isbn` | normalized ISBN-13 digits | Edition identifier |
| `lccn`, `oclc`, `openlibrary:author`, `wikidata:property` | as recorded | identifiers / claims |

Temporary candidate identifiers are only valid within the response that
contains them (product-spec.md). No project-issued permanent Work ID exists.

## 5. Deterministic normalization

Normalization is a comparison function input, not a data transformation.
Source spelling is preserved for display everywhere.

### 5.1 Title text normalization (grouping)

`normalizeTitleText(raw)`:

1. Apply Unicode NFC.
2. Trim leading and trailing Unicode whitespace.
3. Collapse every run of Unicode whitespace to a single ASCII space.

No other change. Case, punctuation, and wording are preserved, so their
differences deliberately keep Title Groups separate (product-spec.md). A
single-string source title is never split to guess a subtitle.

### 5.2 Language tag canonicalization

`canonicalizeLang(raw)` maps an upstream language value to a canonical BCP 47
language tag or to one of the sentinels `und` (unknown) or `mul`
(multilingual).

Open Library MARC three-letter codes observed for the acceptance corpus map
to BCP 47 primary subtags:

| MARC code | Meaning | Canonical tag | Script/region? |
| --- | --- | --- | --- |
| `chi` | Chinese | `zh` | no — MARC records no script |
| `eng` | English | `en` | no |
| `fre` / `fra` | French | `fr` | no |
| `ger` / `deu` | German | `de` | no |
| `ita` | Italian | `it` | no |
| `jpn` | Japanese | `ja` | no |
| `kor` | Korean | `ko` | no |
| `por` | Portuguese | `pt` | no |
| `rus` | Russian | `ru` | no |
| `spa` | Spanish | `es` | no |
| `ara` | Arabic | `ar` | no |
| `yue` | Cantonese | `yue` | no |
| `mul` | multilingual | `mul` | special sentinel |
| `und` | undetermined | `und` | unknown sentinel |

An unmapped MARC code is evidence that the record carries a Content Language,
but Core never invents a BCP 47 meaning for it; such a record contributes a
warning and its title keeps Title Language unknown until a title-level tag
exists.

Wikidata and MediaWiki language values are canonicalized as BCP 47-style
tags: lowercase the language subtag, title-case a four-letter script subtag,
uppercase a two-letter or three-digit region subtag, keep other subtags
lowercase, join with `-`. Examples: `zh-hans` → `zh-Hans`,
`zh-hant` → `zh-Hant`, `zh-cn` → `zh-CN`, `en` → `en`. An empty or missing
value yields `und`.

### 5.3 Identifier normalization

`canonicalIdentifier(ref)`:

- ISBN: strip whitespace and hyphens; uppercase; strip a leading `ISBN`
  prefix if present. If the cleaned string is a valid ISBN-10, convert it to
  its ISBN-13 form by prefixing `978` and recomputing the check digit. If it
  is a valid ISBN-13 beginning `978` or `979`, use it directly. A cleaned
  string with an invalid check digit is still compared as-is (warnings are
  attached by the decoder), so a malformed value never blocks comparison of
  otherwise identical strings. The source form is retained on the Claim.
- Open Library and Wikidata references: use the key exactly as the source
  emits it, after redirect canonicalization (section 8).
- LCCN/OCLC and other identifiers: strip whitespace, compare
  case-insensitively, retain source form.

Two identifiers are equal only when their canonical forms are equal. An
ISBN-10 record and its ISBN-13 counterpart therefore compare equal by
construction; a `979` ISBN never collides with a `978` ISBN.

### 5.4 Language matching

A Title Group with canonical Title Language tag `G` satisfies a requested
language range `R` when both tags exist and RFC 4647 basic filtering matches:
`G == R` or `G` starts with `R + "-"`. `und` and `mul` satisfy no specific
range. An empty target-language list means all groups whose Title Language is
known are in scope.

Consequences:

- `zh` request matches `zh`, `zh-Hans`, and `zh-Hant` groups.
- `zh-Hans` request matches `zh-Hans` and `zh-Hans-CN` groups but not a
  script-less `zh` group and not `zh-Hant`.
- A `zh` group recorded only from Open Library `chi` never satisfies a
  `zh-Hant` request, because the evidence cannot confirm script. Such a group
  is shown only as ambiguous evidence relative to a script-specific request.

## 6. Work Candidate assembly

### 6.1 Record classification

A Source Record is classified as:

- **Work** — Open Library `/type/work`; Wikidata item whose best non-deprecated
  `instance of` (P31) is a Work class such as `literary work` (Q7725634) or
  `written work` (Q47461344) or a descendant of Work (Q386724).
- **Edition** — Open Library `/type/edition`; Wikidata item whose P31 includes
  `version, edition or translation` (Q3331189) or a subclass such as `print
  edition` (Q59466300). An item tagged with `translation` (Q7553) alone is not
  an Edition; it must also satisfy the Q3331189 test to qualify.
- **Redirect** — Open Library `/type/redirect`; Wikidata resolved redirects.
- **Other** — a record that is clearly neither (films, disambiguation pages,
  people, series, etc.).
- **Unknown** — the record cannot be classified from available claims.

Classification is evidence, not authority. "Other" and "Unknown" records do
not produce Work Candidates on their own; a clearly-Other record attached by a
P629 or `works` claim to a Work only contributes a warning and does not make
the target Work a candidate by itself.

### 6.2 Candidate construction rules

Each search hit produces candidate evidence, not a resolved identity:

- A Work hit produces a Work Candidate with the Work reference as evidence.
- An Edition hit produces a Work Candidate for every distinct Work that the
  Edition's Edition-to-Work relation names: Open Library `works[].key`
  (decoded, redirect-canonicalized) and Wikidata P629 (best non-deprecated
  rank). An Edition with no Work relation produces no Work Candidate and is
  retained only as Edition-level evidence with an unknown-Work warning.
- A Wikidata Work hit additionally carries its P648 Open Library ID claim
  when present; an Open Library Work hit carries no back-pointer and can only
  be cross-linked through Wikidata P648 lookups (issue #6 operation).

Candidate identity is a set of Work ExternalRefs. Two candidates are merged
only when an explicit identity mapping exists:

1. the same canonical provider Work reference (identical `openlibrary:work`
   key or identical `wikidata:item` id); or
2. a Wikidata Work's non-deprecated P648 claim equals the Open Library Work
   key of the other candidate.

ISBN or LCCN equality between Editions under different Work references is
relationship evidence and a warning, never a Work merge by itself
(reconciliation rule 3 in architecture.md). When no mapping exists, the
candidates remain separate so the user can review both provider identities.

Every candidate stores its matched Search Alias evidence: the label, alias,
search match text, or snippet that surfaced it, with its language. That
evidence is used only for display and for the deterministic candidate order
below; it never becomes a title attestation.

### 6.3 Deterministic candidate order

Provider search rank is not a Core input (issue #1 recommendation 2). Given a
candidate list, the display order uses only the following features, in order:

1. number of matched aliases whose canonical Title Language equals the query
   language (descending);
2. presence of an author match against the optional query author (entity
   reference equality first, then normalized name equality; both are claims);
3. number of distinct source namespaces that surfaced the candidate
   (descending);
4. number of distinct Edition records surfaced for the candidate that carry
   a known Content Language (descending);
5. stable tie-break: ascending concatenation of the candidate's sorted
   canonical Work references, then the sorted matched-alias texts.

The order is a deterministic, explainable presentation order for candidate
review. It is not a confidence ranking: Core never selects a candidate from
this order (section 7).

## 7. Resolution

### 7.1 Resolution modes

`resolve(candidate | strongIdentifier | externalRef, query, signals)`
returns one of:

- `resolved(work)` — the Work is unambiguously identified;
- `needs_choice(candidates)` — candidates must be confirmed;
- `not_found` / `ambiguous_identifier` — with warnings;
- `failed` / `cancelled`.

**User confirmation.** Selecting any Work Candidate resolves it. This is the
ordinary path for every title search.

**Automatic resolution.** Allowed only when:

- a unique normalized ISBN identifies exactly one distinct Edition across all
  consulted sources and that Edition names exactly one distinct Work; or
- the caller passes an explicit supported External Reference and it is
  unambiguous: `openlibrary:work` or `wikidata:item` that is a Work; or
  `openlibrary:edition` / `wikidata:item` that is an Edition whose
  Edition-to-Work relation names exactly one Work; and any redirects resolve
  to one canonical Work.

Nothing else resolves automatically. Title similarity alone never resolves a
Work. Search ranking alone never resolves a Work.

**Duplicate identifiers.** If the same normalized ISBN (or the same explicit
Edition reference) is found on more than one distinct Edition, or those
Editions name more than one distinct Work, automatic resolution is refused.
The Editions and their Works become candidates with a duplicate-identifier
warning, and each such Edition's attestations are subject to the identifier
degradation in section 10.

### 7.2 Redirects and canonical references

Open Library redirects are resolved while preserving both requested and
canonical references:

- Follow HTTP 3xx `Location` (ISBN and merged-key HTML routes).
- Detect `/type/redirect` JSON records and resolve their `location` key.
- Ignore `location` on `/type/work` records (merge residue).

Wikidata redirects are resolved by the provider read path
(`wbgetentities`/`redirects=yes`, and WDQS already resolves redirects). Core
stores the requested reference and the canonical reference as provenance on
the Resolved Work.

### 7.3 Indirect resolution

An isolated or one-Edition Work whose single Edition carries indirect clues is
the canonical trigger for a second search (issue #1 conclusions).

`indirectClueSet(resolvedWork)` is non-empty when the resolved Work has
exactly one qualifying Edition connected to it **and** that Edition records at
least one of: Open Library `translation_of`, `work_titles`, `other_titles`,
`translated_from`, or Wikidata original-title evidence plus author/translator
claims. If non-empty, the app constructs a bounded second-search plan:

1. Query titles: the Edition's recorded original-title/other-title strings
   (`translation_of`, `work_titles`, `other_titles`), deduplicated, in the
   order they appear in the record; Wikidata Work title statements are added when
   present. Each is searched with the fielded title parameter (Open Library)
   or `wbsearchentities` (Wikidata) in the language of the clue when known.
2. Author hints: author reference or normalized author name claims from the
   Edition accompany each query.
3. Queries run in deterministic order with the provider budget; results are
   assembled into Work Candidates by section 6.

Indirectly found candidates are always labeled **Probable** and require user
confirmation. If the user confirms a stronger candidate, it becomes the
Resolved Work and the isolated Work's Editions remain attached to the original
candidate as Probable evidence with a detached-Work warning (never merged).
If no stronger candidate is confirmed, the original resolution stands.

Indirect resolution is never applied to a Work whose connected Edition set has
more than one qualifying Edition unless the user explicitly requests a
stronger-Work search.

### 7.4 Resolved Work model

A Resolved Work stores:

- canonical Work references by namespace (the authoritative key after
  redirect resolution) plus every requested reference;
- a deterministic set of identity-mapped cross-source references discovered
  after resolution (for example the Wikidata item whose P648 equals the
  resolved Open Library Work, or the Open Library Work found for a resolved
  Wikidata item);
- Edition-to-Work relation claims observed during resolution;
- original-title and content-language claims used by later stages;
- a resolution provenance note (`direct_identifier`,
  `explicit_reference`, `user_confirmation`, `indirect_confirmation`).

## 8. Edition expansion and identity binding

After a Work is resolved, Core requests edition expansion from each available
source for each of the Work's canonical references:

- Open Library: page `/works/{key}/editions.json` with `offset`/`limit`
  (provider issue #6/#8 concerns; Core consumes pages in order).
- Wikidata: fixed ID-bound P629 SPARQL rows, with the Work P747 fallback
  (research #2, shapes 1–4).

**In-scope Editions.** Edition expansion yields the Editions that may carry
evidence for the Resolved Work. Core distinguishes:

- **Qualifying Editions**, which may carry Verified evidence, are in-scope
  Editions connected to the Resolved Work by at least one of:
  - an Open Library `works[].key` equal to a canonical Work reference of the
    Resolved Work (after redirect resolution);
  - a Wikidata P629 claim with best non-deprecated rank equal to a canonical
    Wikidata Work reference of the Resolved Work;
  - a unique strong publication identifier shared with the Resolved Work's
    Edition set and present on no other Edition of another Work.
- **Candidate-related Editions** are additional in-scope Editions that cannot
  satisfy the Qualifying test but were surfaced by a legitimate
  reconciliation path: duplicate-identifier conflicts (section 7.1), the
  second searches of indirect resolution (section 7.3), or cross-source
  identity mapping. Their title claims are accepted as attestations but can
  only reach Probable or Ambiguous, never Verified.

An Edition explicitly identified as abridged, excerpted, summarized, an
adaptation, a collection container, a periodical, or a non-text medium is
never an in-scope Edition for default evidence: it contributes no title
attestation and produces an excluded-record warning. If the source does not
provide enough information to classify the record, the record is retained as
Ambiguous evidence (product-spec.md), never silently dropped.

Expansion continues per source until the source says it has no more pages or a
source-level failure occurs; partial expansion is a partial result with a
warning, not a failure. Edition sets from a Work P747 fallback are
deduplicated by Edition reference.

## 9. Accepted and rejected attestation fields

### 9.1 Accepted fields

The following claims can produce a Title Attestation:

| # | Domain role | Open Library | Wikidata | Preconditions |
| --- | --- | --- | --- | --- |
| A1 | Edition title attestation | Edition `title` | Edition `title` (P1476) statement, rank ≠ deprecated | Edition is in scope for the Resolved Work and not an excluded record (section 8) |
| A2 | Edition subtitle attestation | Edition `subtitle` (separately recorded) | `subtitle` (P1680) qualifier of the P1476 statement | same preconditions; never guessed from a single title string |
| A3 | Edition display fallback | Edition `full_title` | — | used only when `title` is absent; contributes the same attestation as A1 |
| A4 | Work-level original-title evidence | Work record `title` | Work `title` (P1476) statements, rank ≠ deprecated | claim is on the Resolved Work itself |
| A5 | Source field explicitly tied to a publication identifier | none today | none today | reserved for a future documented field whose schema names the published title |

Acceptance rules that always apply:

- The normalized attestation text and Title Language come from the claim
  itself, never from a label, alias, sitelink, or script heuristic.
- Excluded edition types (abridged, excerpted, summary, adaptation,
  collection container, periodical, non-text media) never attest; they
  produce an excluded-record warning only.
- A Wikidata Edition label — even one that looks like a title and belongs to
  an in-scope Edition (fixture WD F3, Q69966015) — is a Search Alias and
  produces no attestation.
- Rank handling: deprecated statements are excluded from evidence.
  `preferred` and `normal` statements both attest; when two non-deprecated
  P1476 statements on one Edition carry the same normalized text and
  language they are one attestation with both statement IDs as provenance;
  when they disagree they are separate attestations plus a rank-conflict
  warning.

### 9.2 Rejected fields (Search Clues, never attestations)

| Source | Field / value | Domain role |
| --- | --- | --- |
| Open Library | `work_titles` | clue for indirect search; MARC 240 work title |
| Open Library | `other_titles` | clue only |
| Open Library | `alternative_title`, `alternative_subtitle` (search) | search alias |
| Open Library | `translation_of` | original-title clue; never a target-language edition title |
| Open Library | `by_statement`, `notes`, `description`, `contributors` roles | provenance / clue |
| Open Library | `series`, `edition_name` | edition characteristic, not a title |
| Open Library | cover/OCR/URL-derived strings | excluded |
| Wikidata | entity `label` in any language | Search Alias |
| Wikidata | entity `alias` | Search Alias |
| Wikidata | entity `description` | disambiguation clue |
| Wikidata | sitelink titles (Wikipedia etc.) | Search Alias |
| Wikidata | search `match`, snippet text | Search Alias |
| Wikidata | Edition label even when title-like | Search Alias |
| Any | transliterations/romanizations generated by the application | excluded — never generated |

A rejected field becomes a Title Attestation only when a separate accepted
field (A1–A5) on an in-scope Edition records that exact title text
(product-spec.md, "Search Clues, Not Attestations"). The upstream clue remains
provenance for that promotion; the attestation is the accepted field, not the
clue.

## 10. Evidence Level assignment

Evidence Level is the only confidence-like classification in the system. It is
assigned to each Title Attestation and lifted to its Title Group. Values
compare `Verified > Probable > Ambiguous`.

### 10.1 Verified

A title attestation is **Verified** when:

1. its Edition is a Qualifying Edition of the Resolved Work (section 8): a
   direct Work–Edition relation (Open Library `works[].key` or Wikidata
   P629) or a **unique** strong publication identifier with no duplicate on
   a different Edition or Work; and
2. its Title Language is known (`und` never verifies).

Candidate-related Editions are never Verified by construction. A Work-level
statement (A4) is never Verified.

### 10.2 Probable

A title attestation or an indirectly produced Work Candidate is **Probable**
when it is not Verified and at least two **independent consistent clue facts**
connect it to the Resolved Work, with no contradicting fact.

Clue facts and their independence families:

| Family | Examples of one fact |
| --- | --- |
| `title` | normalized attestation text equals the normalized text of a title already attested for the Resolved Work |
| `original-title` | Edition `translation_of`/`work_titles` text equals a Work-level original-title statement of the Resolved Work |
| `author` | shared author entity reference or exact normalized author-name claim with a Resolved Work author |
| `origin-language` | Edition `translated_from` (OL) / source-language claim equals the Resolved Work original-language claim or an attested original-title language |
| `identifier` | non-unique but exact identifier overlap with an Edition of the Resolved Work (duplicate ISBN included) |

Independence rules:

- At most one fact per family per Edition counts.
- Two facts count only when they come from different families, different
  Editions, or different source namespaces; facts from different Editions in
  the same source count once per family.
- A fact only counts when the underlying claim is not itself already the
  direct relation that would have made the attestation Verified.

**Duplicate-identifier degradation.** An Edition whose only connection to the
Resolved Work rests on a strong identifier that is duplicated on an Edition of
a different Work cannot be Verified by that identifier. It is classified by
the clue rules above (typically Probable when at least one other family
agrees, otherwise Ambiguous), and the duplicate identifier produces a warning.
An Edition that is directly Work-linked remains Verified even when one of its
ISBNs is duplicated elsewhere; the duplication is a warning, not a reason to
demote a direct relation.

### 10.3 Ambiguous

Anything not Verified or Probable is **Ambiguous**:

- attestations whose Title Language is unknown (`und`), regardless of the
  directness of their Edition link (product-spec.md: unknown-language titles
  appear as ambiguous evidence);
- attestations with fewer than two independent consistent clue facts;
- records whose Work identity, publication type, or relationship is unclear;
- clearly-ambiguous Editions that carry only a label and no P1476 statement;
- Edition sets that cannot be classified because the source gives
  insufficient metadata.

Ambiguous evidence is shown separately, is never in the default list, never
satisfies a specific target-language request, and is never recommended.

### 10.4 Work-level original-title evidence

Work-level statements (A4) get the following deterministic treatment:

1. A Work-level statement with a known Title Language whose normalized text
   equals a Verified Edition Title Group in the same language joins that
   group as a Probable member; the group's level remains Verified because at
   least one member is Verified.
2. A Work-level statement with a known Title Language and no matching group
   creates its own Title Group at **Probable** level, labeled
   "work-level original-title evidence". It appears in default language
   results and may be recommended only if no better group exists in that
   language, because its Work identity is certain but it has no Edition
   evidence.
3. A Work-level statement with unknown Title Language is Ambiguous unless its
   normalized text equals a Verified Title Group in exactly one Title
   Language; in that exact-equality case it may inherit that Title Language
   (identity-backed, never script-guessed) and follow rule 1.
4. Work-level statements never make any group Verified and never count as
   edition evidence.

Original-title annotation: when the Resolved Work has an explicit
original-language claim (Wikidata P407 on the Work at a non-deprecated rank),
the Work-level statement in that language may be annotated "Original Title".
If only an earliest-edition Content Language is available and it is the sole
language of the Work's Work-level statements, that language may annotate too.
When evidence is missing, the app never claims which title is original. The
annotation is display-only and never affects Evidence Level or
recommendation ordering.

## 11. Conflicts

Conflicts are first-class, attributable outputs. Rules from
architecture.md/product-spec.md are implemented as:

1. Source Records are never overwritten and never merged destructively;
   there is no last-write-wins.
2. A matching strong identifier is relationship evidence, not a license to
   overwrite conflicting fields.
3. No source is globally authoritative. Majority vote alone never resolves a
   conflict.
4. Author names are claims; spelling alone is not author identity.
5. Work-level and Edition-level title evidence stay distinct.

A conflict is recorded when two Source Records that are known to describe the
same logical object (same canonical reference, or same unique identifier with
no contradiction) carry different values for an equivalent claim, or when an
identifier maps to more than one object:

| Conflict type | Detection | Effect |
| --- | --- | --- |
| Identifier collision | normalized ISBN/LCCN/OLID present on Editions of different Works | no auto-resolve; warning; identifier-based connection degraded to Probable/Ambiguous (10.2) |
| Relationship divergence | one Edition claims different Works in different sources, or `works[]` names several Works | no merge; warning; attestations follow the direct-relation rules per source |
| Language divergence | editions that map to one logical Edition disagree on Content Language; or a Title Language claim conflicts with an Edition Content Language | warning; Title Language of each attestation stays with its own claim |
| Title divergence | same logical Edition records different title text | separate attestations with warning; never "corrected" |
| Rank divergence (Wikidata) | deprecated vs non-deprecated, or `preferred` vs `normal` disagreement | deprecated excluded; disagreement among kept claims is a warning |
| Author divergence | differing author names/identities for same Work | warning; names remain claims |

Warnings carry the source, affected references, and a stable warning code.
Warnings are ordered deterministically (by code, then namespace, then
reference) for tests. No warning is ever downgraded silently because another
source agrees with a majority.

## 12. Title Groups

### 12.1 Group key

Each Title Attestation contributes a structured Group Text:

```text
GroupText =
  ( mainTitle: normalizeTitleText(titleText),        // required
    subtitle: normalizeTitleText(subtitleText) | absent,   // only when a
  )                                                   // source split it
```

An attestation whose source recorded a subtitle only merges with attestations
that recorded the identical normalized subtitle; an attestation without a
recorded subtitle never merges with one that has one. A single-string source
title is the whole main title and never implies a subtitle.

A **Title Group** is the set of Title Attestations with:

1. the same canonical Title Language tag (where `und` is a distinct bucket);
2. the same normalized `mainTitle`; and
3. an equal subtitle component (both absent, or both present and equal).

Grouping never discards attestations. Differences in case, punctuation,
wording, or subtitle are separate groups by construction. `und` and `mul`
attestations group only with the identical normalized text and the same
sentinel language.

A Title Group's level is the highest member level
(`Verified > Probable > Ambiguous`). A group whose best member is Ambiguous is
shown only in the ambiguous section.

### 12.2 Title Language determination

For each edition title attestation, Title Language is determined in order:

1. explicit title-level tag — Wikidata P1476 monolingual text language, or a
   P407 qualifier on the P1476 statement (the qualifier wins only when the
   text tag is absent or equals it in the source encoding; both are preserved
   when they differ and produce a warning);
2. sole Content Language inheritance — an Open Library Edition that records
   exactly one Content Language, or a Wikidata Edition whose P407 claims a
   single content language, inherits that language for the title;
3. exact-text equality inheritance for Work-level statements (10.4 rule 3);
4. otherwise `und`.

Title Language is never inferred from the characters of the title, the label,
or the script. An Edition with several recorded Content Languages (`mul`,
multiple `languages`, or multiple P407 values) does not inherit any single
language: its titles keep `und` unless a title-level tag exists
(product-spec.md).

### 12.3 Multilingual Edition handling

A multilingual Edition (several Content Languages) still contributes its
edition title attestations, each with the Title Language determined in 12.2
(usually `und`, therefore Ambiguous and not in default lists for any specific
request). The Edition's own `languages` array is never a title-language claim.

## 13. Language results and recommendation

### 13.1 Result construction

For a target-language list `T` (empty = all languages):

1. Collect Title Groups.
2. Visible default groups: groups whose best level is Verified or Probable,
   with a known Title Language that satisfies at least one tag in `T` (or any
   known Title Language when `T` is empty).
3. Ambiguous section: every group whose best level is Ambiguous, including
   every `und` group, regardless of target list.
4. If no default group satisfies the target list, the outcome is
   `no_attested_titles` for those languages, with ambiguous groups still
   reported separately and warnings attached.

Groups are displayed grouped by their canonical Title Language tag; `zh` and
`zh-Hans` groups are different rows with different recommended titles. This is
the consequence of never guessing script.

### 13.2 Recommended Title Group per language

"One recommended title per language" means: for each canonical Title Language
tag that has at least one visible default group, exactly one Title Group is
recommended. Recommendation is computed within a tag by the total comparator
`rankGroups(a, b)` which applies, in order:

1. **Direct edition evidence** — group best level (Verified beats Probable).
2. **Strong identifier support** — number of member attestations whose
   Edition carries at least one canonical strong identifier that uniquely
   identifies that Edition (ISBN/LCCN/OLID), descending.
3. **Independent support** — number of distinct source namespaces among
   member attestations, descending; then number of distinct supporting
   Editions among members, descending.
4. **Publication metadata completeness** — for the group's best edition-backed
   members, the maximum number of present publication-metadata categories
   among {known Content Language, publisher, publication date/year,
   identifiers, page count}; Work-level-only members contribute zero.
5. **Stable tie-break** — ascending (canonical Title Language tag, Group Text
   normalized main title, subtitle component or absent-marker, sorted
   concatenated member external references).

Feature 5 makes the order total; the comparator never uses provider search
rank, recency, or any numeric score. A newer publication date is not a
preference input; a recorded publication date only counts toward metadata
completeness.

## 14. Source failures and partial results

Source outcomes (provider seam, issue #8) are classified as:

- success (records found),
- no record (empty 200 / zero results),
- redirected (3xx or `/type/redirect` — followed with provenance),
- duplicate identifier,
- rate limited (429 with `Retry-After`),
- timeout,
- malformed data,
- total source failure,
- cancelled.

Core rules:

1. "No record" from one source is not a global no-result and is not a
   failure.
2. When one source fails and another succeeds, successful evidence is
   returned with a `partial` state and per-source warnings.
3. When a provider page or query within a source fails, remaining pages and
   the successful data are retained with a warning.
4. A source failure never fabricates claims and never turns labels/aliases
   into attestations to fill a gap.
5. If every required lookup path fails, the outcome is `failed`; cancellation
   is `cancelled` and aborts immediately.
6. Stale cache entries are labeled `stale`; a `stale` record still carries
   provenance and is never presented as fresh.

## 15. Pseudocode reference

The pseudocode below is normative for unit tests. All functions are pure;
every iteration and sort is over arrays with the stated deterministic
comparators; no floating point is used anywhere.

```text
// 15.1 Normalization
fn normalizeTitleText(raw: string) -> string:
    s = NFC(raw)
    s = s.trimUnicodeWhitespace()
    return collapseUnicodeWhitespaceRuns(s, " ")

fn canonicalizeLang(raw: string | null) -> tag | "und" | "mul":
    if raw is null or empty -> "und"
    if raw in OPEN_LIBRARY_MARC_MAP -> return map[raw]      // chi->zh, eng->en, ...
    if raw == "mul" -> "mul"
    if raw == "und" -> "und"
    return canonicalizeBcp47(raw)                            // zh-hans -> zh-Hans

fn canonicalIdentifier(ref):  // ISBN / LCCN / OCLC / OLID
    s = ref.raw.stripSpaceAndHyphens().upper()
    if s is valid ISBN-10: return isbn13(s, prefix = 978)
    if s is valid ISBN-13: return s
    return s

fn matchesRange(groupTag, requestedRange) -> bool:   // RFC 4647 basic filter
    if requestedRange is empty: return groupTag != "und" and groupTag != "mul"
    if groupTag == "und" or groupTag == "mul": return false
    return groupTag == requestedRange
        or groupTag.startsWith(requestedRange + "-")
```

```text
// 15.2 Candidate assembly
fn classifyRecord(record) -> "work" | "edition" | "redirect" | "other" | "unknown":
    if record.type == "/type/redirect": return "redirect"
    if record.type == "/type/work": return "work"
    if record.type == "/type/edition": return "edition"
    if record is Wikidata item:
        if p31 contains Q3331189 or a subclass (bounded P279*): return "edition"
        if p31 is a Work class under Q386724: return "work"
        if p31 is empty or unresolvable: return "unknown"
    return "other"

fn buildCandidates(searchHits) -> WorkCandidate[]:
    // expand Edition hits up to their Work; keep alias evidence
    for hit in searchHits in deterministic source order:
        kind = classifyRecord(hit)
        if kind == "work":
            add candidate(hit.ref, aliasEvidence = hit.match)
        elif kind == "edition":
            for workRef in hit.editionToWorkRefs():        // works[] / P629
                add candidate(workRef, aliasEvidence = hit.match,
                              viaEdition = hit.editionRef)
    merge candidates only when refs are identity-linked (same canonical ref
        or Wikidata P648 == OpenLibrary key)
    return stableOrder(candidates, comparator in 6.3)

// 15.3 Resolution
fn resolveDirect(isbn or externalRef) -> Resolution:
    editions = collectDistinctEditionsByIdentifier(ref)     // across sources
    if editions.count() == 0: return not_found
    if editions.count() > 1:                                 // duplicate id
        warn(duplicate_identifier)
        return needs_choice(workCandidatesOf(editions))
    work = distinctWorkOf(editions[0])
    if work.count() != 1: warn(ambiguous_work_link); return needs_choice(work)
    return resolved(work)

// 15.4 Evidence level
fn levelOf(attestation a, resolvedWork R) -> Verified | Probable | Ambiguous:
    // Excluded editions never reach levelOf: extraction drops them with a
    // warning (section 8). Candidate-related editions are handled here.
    E = a.edition
    if a.language == "und":        return Ambiguous       // 10.3
    if directRelation(E, R):       return Verified         // works[] / P629
    if strongUniqueIdentifierConnects(E, R)
       and not duplicateIdentifier(E): return Verified
    facts = independentClueFacts(E, a, R)                  // 10.2 families
    if facts.count() >= 2 and noContradiction(facts, R): return Probable
    return Ambiguous

// 15.5 Grouping
fn groupKey(a: attestation) -> Key:
    return (a.language,
            normalizeTitleText(a.mainTitle),
            a.hasSeparateSubtitle ? normalizeTitleText(a.subtitle)
                                  : ABSENT)

fn groupAttestations(list) -> TitleGroup[]:
    groups = group list by groupKey
    for g in groups:
        g.level = maxLevel(members)                        // Verified > Probable > Ambiguous
        g.members = stableOrder(g.members, by provenance then statementId)
    return groups

// 15.6 Recommendation
fn rankGroups(a, b) -> int:                                 // negative => a first
    compare (1) level(a) vs level(b)
    compare (2) -countUniqueStrongIds(a) vs -countUniqueStrongIds(b)
    compare (3) -countSourceNamespaces(a) vs -countSourceNamespaces(b)
    compare (3b) -countEditions(a) vs -countEditions(b)
    compare (4) -metadataCompleteness(a) vs -metadataCompleteness(b)
    compare (5) lexicographic(groupKey(a), groupKey(b))
    return result

fn recommendPerLanguage(groups) -> Map<LanguageTag, TitleGroup>:
    result = {}
    for tag in groups.knownLanguageTags():                  // sorted
        visible = groups.where(g.language == tag
                               and g.level in {Verified, Probable})
        if visible not empty: result[tag] = stableOrder(visible, rankGroups)[0]
    return result
```

## 16. Invariants suitable for unit tests

1. Every Title Attestation retains at least one resolvable Source Record,
   source URL, fetched-at timestamp, and provenance.
2. No Attested Title is derived from a label, alias, sitelink, snippet,
   `work_titles`, `other_titles`, `translation_of`, romanization, or
   generated translation. (Property-testable: removing all such claims from
   the input leaves the same default Title Groups when Edition title claims
   are unchanged.)
3. A Work-level title statement never produces a Verified member.
4. No Title Group mixes Title Languages; the group key is equal for all
   members.
5. `und`/`mul` Title Groups never satisfy a specific requested language and
   are never recommended.
6. An Edition with several Content Languages contributes no inherited Title
   Language; an Edition with a single Content Language inherits exactly that
   language; characters never classify language.
7. Grouping is idempotent and total: identical evidence inputs produce
   identical Title Groups and identical member order.
8. Recommendation is deterministic and total within every Title Language
   tag; no tie survives the comparator.
9. Ambiguous evidence is never a recommendation and never a default-visible
   member.
10. Duplicate strong identifiers never produce automatic resolution and never
    yield Verified status through that identifier.
11. Conflicting claims remain attributable; Core never performs
    last-write-wins and never resolves a conflict by majority.
12. Candidate order is not used to resolve; automatic resolution happens only
    through section 7.1 rules.
13. Normalization is display-preserving: applying `normalizeTitleText` to an
    already normalized title is a fixed point.
14. All counters in comparators are counts of discrete facts, never
    probabilities, scores, or floats.

## 17. Acceptance-corpus fixture table

Fixtures referenced below are the minimized snapshots recommended by issue #1
(fixture guidance items 1–9) and issue #2 (F1–F7), recorded 2026-09-05. They
become provider fixtures under issue #8 and Core fixture inputs under issue
#6. Live values are not assertions; the assertions below apply to the fixed
fixtures only.

| Corpus scenario | Fixture inputs (2026-09-05) | Expected deterministic Core behavior |
| --- | --- | --- |
| `百年孤独` — translated Edition detached | OL: isolated `OL43416865W`/`OL59138652M` (chi, `translated_from: spa`, `work_titles: [Cien años de soledad]`); principal `OL274505W` absent from first search; second search on original title returns `OL274505W`. WD: `Q178869`; editions via P629. | Candidates: isolated Work and principal Work as separate candidates (identity mapping only if Wikidata P648 matches). No auto-resolution. Indirect clue set fires on the isolated Work: `translated_from` + `work_titles` + author produce a second-search candidate list. After user confirms the principal Work: Spanish default group `Cien años de soledad` Verified (direct editions); Chinese default groups: romanized `Bai nian gu du` Verified (direct chi Edition), `百年孤独` Probable (author + original-title + origin-language clue facts) with detached-Work warning. Unknown-language records Ambiguous. Because the deterministic comparator prefers direct-edition evidence, the recommended `zh` group under these fixtures is the Verified romanized group; the Probable `百年孤独` group stays visible beneath it and is never merged into it. |
| `小王子` — many languages and Editions | OL: eleven one-Edition Works plus principal `OL10263W`; `language:chi` filter returns only `OL10263W`. WD: `Q25338` + film/Other items. Edition without `languages` `OL49205422M` (title 小王子) on isolated Work; duplicate ISBN with `OL49205424M` (yue, principal). | Candidate list merges only identity-linked refs; films and Other items contribute no Work Candidates. No auto-resolution from search. After confirming `Q25338`/`OL10263W`, `小王子 香港粵拼版` (yue, direct) Verified; script-less/`und` Edition titles Ambiguous; duplicate ISBN between the isolated and principal Editions is a warning and never auto-resolves. WD F3-style Edition (label only, no P1476) contributes no attestation. |
| `1984` — short, noisy, ambiguous | OL: 77k search hits capped by provider; WD: novel `Q208460` alongside year/other items; deprecated/normal P648 pair fixture (F6). | Candidates presented deterministically; no silent selection. After confirming `Q208460`, English `Nineteen Eighty-Four` groups Verified from direct English Editions; rank-conflict on deprecated Open Library IDs surfaces as a warning, deprecated ref excluded. Any `1984`-as-number Work candidates remain unconfirmed and out of the default title path. |
| `挪威的森林` — distinct CN/JA/EN titles | OL: principal `OL2625457W`; WD: `Q751348` + Chinese Edition `Q69966015` (P629 to `Q751348`, zh label, **no P1476**). | `Q69966015` is classified Edition and surfaces its P629 Work as a candidate, but its zh label never becomes an Attested Title (F3 rule). After confirmation, Chinese/Japanese/English default groups come only from Edition title attestations (OL editions and WD P1476 rows); label-only editions are Ambiguous evidence with warning. |
| `活着` — Chinese Original Title + foreign-language Editions | OL: isolated Chinese Works and English Works; WD: `Q151919` with zh/en P1476 Work statements (F1), English Edition `Q125131191` (F2, full attestation). | After confirming `Q151919`: Chinese group `活着` Verified when chi OL Editions attest it (Work P1476 joins as Probable member at most); English `To Live` Verified from `Q125131191`. Work-level statement never makes a group Verified on its own. Original-title annotation applies to `活着` only when original-language evidence exists. |
| `代码整洁之道` — technical book, subtitle, edition differences | OL: no Chinese record; WD: no Chinese label/alias for the Work; English search surfaces `Q109996684` + Japanese Edition `Q112416172` (P629, no P1476). | Chinese query yields no candidates from Chinese evidence; secondary other-language fallback can find the English Work and Japanese Edition but `Q112416172` attests nothing (no P1476). Subtitle and edition differences create separate Title Groups for the English title (e.g., base `Clean Code` vs `Clean Code` with recorded subtitle); each merges only on identical normalized structured text. |
| Known same-title pair | Two Works share the same Chinese title; each has distinct author/date claims (fixture derived from `活着` detached pairs `OL25129388W`/`OL20903102W` style). | Both remain candidates; author/year are display claims. No automatic resolution. After user confirmation of one, only that Work's in-scope Editions contribute default-title evidence; the other Work's records are never merged. |
| Nonexistent title | OL `numFound: 0` 200; WD empty search. | Outcome `no matching work found`, no candidate, no fabrication, zero warnings except per-source no-record notes as applicable. |
| Partial source outage | OL success; WD timeout/failure (or the reverse). | Successful source's candidates and titles are returned; outcome is partial with a per-source warning; failing source never contributes labels/aliases as attestations to compensate. |
| Simplified/traditional variants | Query `百年孤寂` (zh-Hant alias) resolves `Q178869`; requested `zh-Hant`; only script-specific P1476/`zh-Hant`-tagged data is in scope. | `zh-Hant` groups satisfy `zh-Hant`; script-less `zh`/`chi` groups do not and appear only as ambiguous evidence for that request. When only `zh-Hans`/script-less groups exist, outcome for `zh-Hant` is `no_attested_titles` with the script-less evidence shown separately and warned. |

## 18. Risks and unknowns

- Catalog identity is imperfect on both sources. Candidate merging across
  Open Library and Wikidata is deliberately narrow (P648-only); users may see
  one Work twice when no mapping exists. A future provider can widen the
  mapping without changing Core reconciliation rules.
- Language metadata is sparse: Open Library frequently omits `languages`,
  Wikidata frequently omits P1476. The strict `und` rule therefore produces
  many Ambiguous entries and conservative `no_attested_titles` results. This
  is the intended product behavior ("no invented confidence"), but it means
  recall over real catalogs will be lower than title-text heuristics would
  give.
- Script-less `zh` groups cannot satisfy `zh-Hans`/`zh-Hant` requests. Users
  who expect simplified results from an Open Library `chi` record must either
  omit the script-specific target or rely on later script metadata.
- Indirect-resolution search budgets and the exact second-query field/language
  ordering are provider-level details deferred to issues #6/#8; Core defines
  the trigger set and the Probable-until-confirmed rule here.
- Work-level original-title annotation is display-only and intentionally
  conservative; no claim of "original" is made without explicit evidence.
- Research examples are snapshots (2026-09-05). All automated assertions must
  run against fixed fixtures, never live Open Library/Wikidata state.

## 19. Inputs to downstream tickets

- Issue #6 (catalog module interface): Core reconciliation consumes Work
  search hits, Edition-to-Work relations, Work detail with Work-level title
  claims, and paged Edition expansion; the interface should express these
  evidence-oriented operations plus an optional "find Work by P648" mapping
  operation.
- Issue #8 (decoding and HTTP seams): decoders must preserve provenance and
  the optional presence of every field in section 9; redirect and duplicate
  identifier outcomes must reach Core classified as in section 14; none of
  the deterministic decisions here may be performed heuristically in the
  provider layer.
- Issue #10 (cache/config seam): cached raw responses must retain fetched-at
  and stale state so Core never mistakes a stale record for fresh evidence;
  grouping and recommendation conclusions are never cached.
