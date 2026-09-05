# CLI and JSON Contract

Decision ticket:
[GitHub issue #12 — Freeze the CLI and JSON
contract](https://github.com/FilthyS/book-title-lookup/issues/12)

Type: grilling
Status: design decision for issue #12
Blocked by: #6 (catalog module interface) and #7 (evidence reconciliation
and recommendation) — both closed; their design documents are listed under
References.

This document freezes the smallest durable automation interface for the MVP:
the executable command set, option grammar, opaque-versus-stable references,
stdout/stderr separation, every exit code, the schema-version policy, and the
JSON document for every success, needs-choice, empty, partial, cancelled, and
failure outcome. It is a design specification, not production code. The
workspace is not scaffolded yet (issue #14); no source files are created or
changed by this ticket.

## 1. Decision

Freeze the following as the automation contract for the first release:

- One executable, `book-title`, with five explicit commands — `search`,
  `resolve`, `titles`, `cache`, and `config` — plus the no-command TUI mode
  and `--help`/`--version`.
- One option grammar with long options only, exact spelling, and the
  validation rules in Section 4.
- Stable automation uses External References only. Ephemeral in-memory
  candidate and resolved-work handles are never serialized as automation IDs.
- `stdout` carries exactly the requested result: one JSON document under
  `--json`, or deterministic human text without `--json`. `stderr` carries
  diagnostics, warnings, and progress. CLI commands never prompt.
- Exit codes come from the frozen allocation in Section 6, mapped per command.
- Every JSON document carries the top-level `schemaVersion` value
  `"cli-json.v1"` as its first key and serializes with deterministic key and
  array ordering (Section 7).
- The CLI/JSON boundary identifies sources as `"openlibrary"` and `"wikidata"`
  in bibliographic documents; cache maintenance documents preserve the cache
  port's `provider` tokens from issue #10 (spelling map in Section 7.3).
- The full document set of Section 8 is authoritative for stdout JSON; its
  JSON Schema-style fragments become machine-validatable fixtures under
  issue #14.

No option or command beyond those in Section 3 exists. Adding one later is an
additive change under the schema-version policy of Section 7.1, but the MVP
freezes the surface below as the minimal one that can express the accepted
product workflow and the maintenance needs issue #10 already requires.

## 2. Question and scope

Issue #12 asks what commands, inputs, stable external references, JSON
document shapes, schema-version policy, stdout/stderr split, exit codes, and
partial/empty/error outcomes form the smallest durable automation interface
for the MVP. This document answers it for the first release by translating the
settled module and domain contracts into a process contract:

- the `BookTitleCatalog` operations and outcome unions from issue #6;
- the candidate, resolution, evidence, group, and recommendation semantics
  from issue #7;
- the typed source and runtime failures from issue #8;
- the cache and configuration operations and precedence from issue #10;
- the `book-title` binary name, launcher behavior, and reserved launcher exit
  code from issue #11;
- the CLI/process rules already recorded in `docs/architecture.md` and
  `docs/product-spec.md`.

Out of scope: the full-screen TUI interaction model (issues #9 and #13),
workspace scaffolding and package code (issue #14), npm publishing mechanics
(issue #11), and every domain behavior that #6 or #7 deliberately left to
later tickets.

## 3. Command set and invocation model

### 3.1 Modes

| Invocation | Mode | Result |
| --- | --- | --- |
| `book-title` with no command, stdin and stdout both TTY, no `--json` | TUI | Starts the full-screen TUI. Its exit conventions are 0 on normal exit and 130 on interruption; its screens are issue #9/#13 territory, not JSON documents. |
| `book-title` with no command and not that exact case (non-TTY, or `--json`) | CLI | Usage error on stderr, exit `2`, no stdout. The CLI never starts the TUI when stdout is not a TTY or `--json` is present. |
| `book-title <command> ...` | CLI | The command grammar below. |
| `book-title --help` / `book-title <command> --help` | Help | Usage text on stdout, exit `0`, no JSON document. Help is not part of the JSON surface. |
| `book-title --version` | Version | One line `book-title <version>` on stdout, exit `0`. The version is the single release stamp from issue #11. |

### 3.2 Global options

Global options are accepted before or after the command token. They apply to
every command.

| Option | Meaning | Notes |
| --- | --- | --- |
| `--json` | Emit one JSON document on stdout | Never prompts; JSON output is never colorized. |
| `--debug` | Verbose diagnostics on stderr; for `cache show` only, include the cached response body | Never changes book outcomes or exit codes; never adds or removes secrets. |
| `--offline` | Force offline mode | Overrides `BOOK_TITLE_OFFLINE` and any config file value. Meaningful for network-backed commands. |
| `--cache-dir <path>` | Override the cache root | Overrides `BOOK_TITLE_CACHE_DIR`; must be an absolute path; never read from the config file (issue #10). |
| `--no-color` | Disable ANSI styling | Takes precedence over environment styling rules. |
| `--color` | Force ANSI styling | For deterministic tests of human output; never affects JSON. |
| `--help` | Print usage for the current scope and exit `0` | Processed before other behavior. |
| `--version` | Print the version and exit `0` | Only valid at the top level. |

Environment styling: ANSI styling is otherwise enabled only when the stream
being styled is a TTY and neither `NO_COLOR` (set and non-empty) nor
`TERM=dumb` disables it (product spec). JSON on stdout is never styled in any
case.

### 3.3 Command grammar

```text
book-title search --title <text>
                  [--author <text>] [--isbn <text>] [--year <integer>]

book-title resolve (--isbn <text> | --reference <namespace>:<value>)

book-title titles --reference <namespace>:<value>
                   [--language <tag>]...          # zero or more

book-title cache list
book-title cache show <digest>
book-title cache clear

book-title config show
```

`search`, `resolve`, and `titles` map one-to-one onto the `search`, `resolve`,
and `findTitles` operations of the accepted catalog module (issue #6).
`cache` and `config` expose only the maintenance operations issue #10 already
requires: `cache list`, `cache show <digest>`, `cache clear`, and
`config show`. No other command or subcommand exists in the MVP.

### 3.4 Option and argument rules

- Option names and command names are lowercase and case-sensitive.
- Only long options exist; there are no short options or abbreviations.
- Both `--flag value` and `--flag=value` forms are accepted and are
  equivalent.
- A single-value option given more than once is a usage error (exit `2`),
  except `--language`, which is repeatable.
- Unknown options, unknown commands, missing required options, conflicting
  options, and unexpected positionals are usage errors: diagnostics on
  stderr, exit `2`, no stdout.
- Values are validated as follows before a module operation is started.

| Option or argument | Validation (failure is exit `2`) |
| --- | --- |
| `--title` | Required. Non-empty after trimming Unicode whitespace. |
| `--author` | Optional. Non-empty after trimming when present. |
| `--isbn` | Optional for `search`; required exactly one of `--isbn`/`--reference` for `resolve`. After removing spaces and hyphens, only ASCII digits and a terminal `X`/`x` are allowed. The module normalizes ISBN-10 to ISBN-13 per issue #7. |
| `--year` | An integer between 1 and 9999 inclusive, matching the domain's "publication year as typed". |
| `--reference` | The form `namespace:value`; `namespace` must be one of the four supported namespaces (Section 5) and `value` must be non-empty. Syntax and namespace errors are exit `2`. |
| `--language` | A canonicalizable BCP 47-style tag per issue #7 (for example `zh`, `zh-Hans`, `zh-Hant`, `en`, `pt-BR`). The sentinels `und` and `mul` are rejected because they cannot be requested languages. Zero occurrences means all discovered languages. |
| `--cache-dir` | Absolute, canonicalizable path. A relative value is invalid configuration, exit `2` (issue #10). |
| `cache show <digest>` | Exactly one positional; exactly 64 lowercase hexadecimal characters. |

`search --isbn` and `search --year` combine with `--title` as the optional
`BookQuery` fields do (issue #6); they do not conflict with each other.

## 4. Configuration inputs

Every command resolves settings through the issue #10 seam. Precedence per
setting is fixed: CLI flag > environment variable > user config file >
built-in default.

| Resolved setting | CLI source | Environment source | Notes |
| --- | --- | --- | --- |
| `cacheRoot` | `--cache-dir` | `BOOK_TITLE_CACHE_DIR` | Never from the config file. |
| `offline` | `--offline` | `BOOK_TITLE_OFFLINE` | |
| `logLevel` | `--debug` raises effective verbosity for diagnostics | `BOOK_TITLE_LOG_LEVEL` | `--debug` does not change stored or echoed settings, only diagnostic verbosity and the one documented `cache show` body emission. |
| `contact` | none in MVP | `BOOK_TITLE_CONTACT` | Used to build the identified `User-Agent`. |

Secrets are never read by the MVP. `BOOK_TITLE_GOOGLE_API_KEY` remains a
documented reserved name and is not in the environment allowlist (issue #10).

## 5. Reference policy

### 5.1 Opaque handles are never automation IDs

The catalog module mints two opaque handles (issue #6): `CandidateRef`,
scoped to the search response that produced it, and `ResolvedWorkRef`, scoped
to the module session. Each CLI invocation is one short-lived module session
in one process, so neither handle survives between invocations by
construction. CLI JSON documents therefore never serialize either handle.

Consequences:

- `search` documents describe candidates by their External References only.
- `resolve` and `titles` accept External References only; there is no CLI
  syntax for an opaque candidate handle.
- A script that stores a candidate's in-memory token and reuses it later is
  already broken by design; nothing in the JSON contract encourages it.

### 5.2 External References

An External Reference is the only durable machine handle. Its JSON form is:

```json
{ "namespace": "openlibrary:work", "value": "OL274505W" }
```

The CLI string form is `namespace:value`, so the same reference on the command
line is `openlibrary:work:OL274505W`.

Supported namespaces for automation input and output are exactly the module's
reference namespaces (issue #6):

| Namespace | Value form | Meaning |
| --- | --- | --- |
| `openlibrary:work` | Open Library Work key, e.g. `OL274505W` | Work-level reference. |
| `openlibrary:edition` | Open Library Edition key, e.g. `OL59138652M` | Edition-level reference. |
| `wikidata:item` | Wikidata item id, e.g. `Q178869` | Work or Edition item. |
| `isbn` | Canonical ISBN-13 digits, e.g. `9780140328721` | Edition identifier. |

`--isbn <text>` is syntactic sugar for an `isbn` External Reference; the
module normalizes the value before any comparison or request (issue #7). No
other namespace is accepted by the CLI, and references to non-resolve
identifiers (`lccn`, `oclc`, `openlibrary:author`, `wikidata:property`) stay
inside claim provenance and never appear as CLI automation handles.

### 5.3 Cross-process workflow

Automation runs three one-shot commands per lookup:

1. `search` returns candidates; each candidate carries at least one Work
   External Reference.
2. The caller chooses a Work-level reference from a candidate (or supplies an
   ISBN/reference the caller already trusts) and runs `resolve`.
3. `titles` re-resolves that reference in its own process and returns the
   attested Title Groups.

Because `titles` starts a fresh process, it internally resolves the supplied
reference before calling `findTitles`; if that resolution cannot produce a
Work, `titles` reports the resolution outcome (Section 8.3). A resolved
Work's `references` in JSON are the canonical Work references the caller may
reuse on later invocations.

## 6. Streams and exit codes

### 6.1 stdout/stderr split

| Stream | Carries |
| --- | --- |
| `stdout` | Exactly the requested result: one JSON document under `--json`; deterministic human text without `--json`. Never diagnostics, progress, prompts, or ANSI in JSON. |
| `stderr` | Diagnostics, warnings, progress, usage errors, and fatal configuration/permission text. Free-form for humans; progress indicators appear only when stderr is a TTY. |

Rules:

- CLI commands never prompt, in a TTY or not. Interactive disambiguation is
  the full-screen TUI's job (issue #13).
- Warnings that reach a JSON document are also rendered as human text on
  stderr for the person watching, but they never appear on stdout.
- `--debug` adds diagnostics to stderr only. The single JSON exception is
  `cache show`, whose document includes the cached body only under `--debug`
  (Section 8.4).

### 6.2 Exit-code classes

Exit codes are process termination classes for the workflow the command
completed. They are coarse on purpose; the JSON `command`/`status` fields
carry the precise outcome. The application emits exactly the codes below, no
others. Exit code `70` is reserved for launcher-level distribution failure and
is produced only by the Node launcher (issue #11), never by the application.

| Code | Name | Emitted when |
| ---: | --- | --- |
| `0` | success | The invocation completed with a definitive usable result: `resolve` resolved, `titles` found, `cache`/`config` succeeded, `--help`/`--version`, or the TUI exited normally. |
| `2` | invalid command or configuration | Usage errors; invalid option values or reference syntax; unknown commands; invalid config file; settings, permission, or unsupported-environment failure; no-command invocation outside TUI mode. Diagnostics on stderr, no stdout. |
| `3` | selection required | The invocation reached a state where a Work must be confirmed or chosen and the non-interactive CLI cannot do so: `search` found candidates, `resolve` returned `needs_choice`, or `titles` could not resolve its reference to one Work (`needs_choice`). |
| `4` | no matching Work | `search` or `resolve` answered `not_found`, or `titles` could not resolve its reference (`not_found`). |
| `5` | Work resolved, no attested title in requested languages | `titles` returned `no_attested_titles`. |
| `10` | all required lookup paths failed | `search`, `resolve`, or `titles` returned `failed`. |
| `130` | interrupted | Any command returned `cancelled`: user interruption or the overall lookup deadline aborted the work. |

Exit `3` on a `search` that found candidates is deliberate. The product spec
states that ambiguous non-interactive searches return candidates and a
dedicated exit code; a candidate list, even a single-candidate list, cannot
proceed to titles without a confirmation that only an External Reference or
an interactive session can supply. Issue #6 confirms Core never auto-resolves
from search rank or uniqueness.

### 6.3 Per-command exit mapping

| Command | `found` | `resolved` | `needs_choice` | `not_found` | `no_attested_titles` | `failed` | `cancelled` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `search` | `3` | — | — | `4` | — | `10` | `130` |
| `resolve` | — | `0` | `3` | `4` | — | `10` | `130` |
| `titles` | `0` | — | `3` | `4` | `5` | `10` | `130` |
| `cache` / `config` | `0` on `ok` | — | — | — | — | — | `130` |

### 6.4 Signals

`SIGINT` (Ctrl+C) and `SIGTERM` both cancel in-flight work. When the process
can reach a final write it emits the command's `cancelled` JSON document under
`--json` and exits `130`; a hard kill before the final write may produce no or
partial stdout, which is inherent to signals. The full-screen TUI restores the
terminal on cancellation per the manual acceptance checklist (issue #9/#11).

## 7. Schema version policy and deterministic ordering

### 7.1 schemaVersion

Every stdout JSON document carries one top-level field, always the first
serialized key:

`"schemaVersion": "cli-json.v1"`

`schemaVersion` is always the first serialized key. The value is one exact
token with no minor component. Consumers must reject a document whose
`schemaVersion` they do not recognize; they must not guess semantics from a
newer token. When the contract must change incompatibly, the token becomes
`cli-json.v2` (and so on) and the old major is documented, not silently
reshaped.

Within one major version, only additive, backward-compatible changes are
allowed:

- new commands that older consumers never invoke (discouraged, not
  prohibited);
- new optional single-value or repeatable options that default to the old
  behavior;
- new known warning, failure, or detail codes;
- new language tags and a new External Reference namespace when a source that
  uses it enters the composition;
- new optional object keys that older consumers ignore.

Breaking changes that require a new major include: changing, removing, or
retyping an emitted field; changing or removing a status value; changing the
meaning of an exit code; changing key or array ordering; and removing,
renaming, or redefining an option or command.

Consumers are instructed to parse known fields and ignore unknown object keys,
and to treat an unrecognized warning/failure code generically. A change to
which statuses a command can emit, or a semantic change to an existing status,
is never slipped in as an additive change.

### 7.2 Serialization determinism

Actual `--json` stdout is a single JSON value, serialized compactly (no
insignificant whitespace) with a trailing newline, in UTF-8 without a BOM.
JSON numbers are integers only; there are no floats anywhere in the contract.
The examples in Section 8 are pretty-printed for reading; the wire form is
compact.

Key order within every object is the exact order listed in that document's
schema. Array order is deterministic as follows:

- `candidates`: the issue #7 deterministic candidate order (matched alias
  count, author match, distinct namespaces, distinct language-bearing
  Editions, then the stable reference/text tie-break).
- `warnings` and `failures`: ascending `code`, then `source`, then the sorted
  serialized `references`, then the sorted-key serialized `details`.
- `groups`: ascending canonical `language` tag with the `und`/`mul` buckets
  last, then the issue #7 `rankGroups` comparator within a concrete language,
  which places the recommended group first. Ambiguous evidence is not a
  separate JSON array: every group, including `und`/`mul` and otherwise
  ambiguous groups, is a member of `groups` with its `level`,
  `satisfiesRequest`, and `recommended` flags; human output separates it under
  an `Ambiguous` heading (Section 10).
- `references` arrays: ascending `namespace`, then ascending `value`.
- `attestations` within a group: ascending `source`, then `sourceRecordUrl`,
  then `statementId` (absent sorts before present), then `role`.
- `cache list` entries: ascending `digest` (issue #10).

Collection arrays that the schema lists (`candidates`, `warnings`,
`failures`, `groups`, `references`, `alternativeTitles`, `authors`,
`contentLanguages`, `attestations`, `entries`) are always present, empty
when they have no members; they are never `null` and never omitted. Optional
scalar fields (`publicationYear`, `firstPublicationYear`, `editionCount`,
`subtitle`, `statementId`, and so on) are omitted when the value is unknown;
they are never `null` unless the schema says `null` is a meaningful value
(only `subtitle` on groups and attestations uses explicit `null` for "no
separate subtitle recorded").

### 7.3 Source identifiers

Bibliographic JSON uses the application-boundary source ids from issue #6:

| Boundary value | Meaning |
| --- | --- |
| `openlibrary` | Open Library |
| `wikidata` | Wikidata |

The cache seam from issue #10 spells the same provider as `open_library`
internally. Cache maintenance documents (Section 8.4) preserve the issue #10
envelope and summary tokens verbatim, including `"provider": "open_library"`.
This is a deliberate, documented difference: bibliographic documents identify
the source that produced evidence, while cache documents identify the cache
envelope's provider port. Scripts that correlate the two map
`open_library` to `openlibrary`; the mapping is tested in Section 9.

## 8. JSON documents

Every document below is the complete stdout payload for one `--json`
invocation. Field tables give the exact key order; JSON Schema-style fragments
give the normative shape. A machine-validatable JSON Schema bundle that
mirrors these fragments is created under issue #14, where the first CLI
vertical slice also snapshots each document against fixed fixtures. The
examples are pretty-printed here; actual stdout is compact, single-value JSON
with a trailing newline (Section 7.2).

### 8.0 Shared definitions

#### External Reference

| Key | Type | Notes |
| --- | --- | --- |
| `namespace` | string | One of `openlibrary:work`, `openlibrary:edition`, `wikidata:item`, `isbn`. |
| `value` | string | Canonical value in the namespace, e.g. `OL274505W`, `Q178869`, `9780140328721`. |

```json
{ "namespace": "openlibrary:work", "value": "OL274505W" }
```

#### Warning and failure

`warnings` are degradations on an otherwise valid outcome. `failures` are the
reasons an outcome could not be produced; a `failed` document always carries a
non-empty `failures` array. Both share this shape.

| Key | Type | Notes |
| --- | --- | --- |
| `source` | string | `openlibrary` or `wikidata` at the bibliographic boundary. |
| `code` | string | Stable machine code. Known values are listed below; unknown values are forward-compatible and additive. |
| `references` | External Reference array | Affected references when applicable; always present, empty when none. |
| `details` | object | Optional string-key/string-value facts, never a formatted sentence. |

Known codes: `unavailable`, `timeout`, `rate_limited`, `decode`, `conflict`,
`stale` (issue #6 source codes) plus reconciliation and completeness codes:
`duplicate_identifier`, `detached_work`, `excluded_record`, `unknown_work`,
`relationship_divergence`, `language_divergence`, `title_divergence`,
`rank_conflict`, `author_divergence`, `partial_expansion`. `details` keys are
free-form but documented per code by the producing layer; examples include
`duplicateIdentifier`, `otherWork`, `recordUrl`, `requestIdentity`, and
`decoderVersion`.

```json
{
  "source": "openlibrary",
  "code": "duplicate_identifier",
  "references": [{ "namespace": "isbn", "value": "9787544253994" }],
  "details": { "otherWork": "OL49205422M" }
}
```

#### Work Candidate

A candidate is presented for confirmation. It never carries its in-memory
handle; automation selects it by one of its `references`.

| Key | Type | Notes |
| --- | --- | --- |
| `title` | string | Best display title for the candidate. |
| `alternativeTitles` | string array | Other recorded titles and matched forms; empty when none. |
| `authors` | string array | Display author names; empty when none. |
| `publicationYear` | integer | Optional; omitted when unknown. |
| `editionCount` | integer | Optional; omitted when unknown. |
| `contentLanguages` | string array | Canonical Content Language tags; empty when none. |
| `references` | External Reference array | Identity-mapped Work references, at least one; ordered by namespace then value. |

```json
{
  "title": "Cien años de soledad",
  "alternativeTitles": ["One Hundred Years of Solitude"],
  "authors": ["Gabriel García Márquez"],
  "publicationYear": 1967,
  "editionCount": 1,
  "contentLanguages": ["es"],
  "references": [
    { "namespace": "openlibrary:work", "value": "OL274505W" },
    { "namespace": "wikidata:item", "value": "Q178869" }
  ]
}
```

#### Resolved Work

| Key | Type | Notes |
| --- | --- | --- |
| `title` | string | Best display title for the Work. |
| `authors` | string array | Display author names; empty when none. |
| `firstPublicationYear` | integer | Optional; omitted when unknown. |
| `contentLanguages` | string array | Canonical Content Language tags; empty when none. |
| `references` | External Reference array | Canonical Work references after redirect and cross-source identity mapping, ordered by namespace then value. |

```json
{
  "title": "Cien años de soledad",
  "authors": ["Gabriel García Márquez"],
  "firstPublicationYear": 1967,
  "contentLanguages": ["es"],
  "references": [
    { "namespace": "openlibrary:work", "value": "OL274505W" },
    { "namespace": "wikidata:item", "value": "Q178869" }
  ]
}
```

#### Title Group and attestation

A Title Group is a set of title attestations with one canonical Title Language
and one normalized structured title text (issue #7). The JSON documents in
this contract carry every returned group in one `groups` array; each group
states whether it satisfies the requested languages and whether it is the
deterministic recommendation, so a consumer never reimplements RFC 4647 or
the issue #7 comparator.

| Key | Type | Notes |
| --- | --- | --- |
| `language` | string | Canonical Title Language tag, or `und`/`mul`. |
| `title` | string | Deterministic display main title for the group. |
| `subtitle` | string or `null` | Recorded separate subtitle, or `null` when no source recorded one. |
| `level` | string | `verified`, `probable`, or `ambiguous` (best member level). |
| `recommended` | boolean | True exactly for the one recommended group of a concrete language tag; never true for `und`/`mul`, ambiguous, or non-satisfying groups. |
| `satisfiesRequest` | boolean | Whether the group satisfies at least one requested language tag per RFC 4647 basic filtering (issue #7); true for every known-language group when no `--language` was given, false for `und`/`mul`. |
| `originalTitle` | boolean | True only when explicit evidence supports the Original Title annotation; display-only, never affects level or recommendation. |
| `attestations` | Attestation array | Member attestations, ordered by source, source URL, statement id, role. |

Attestation fields:

| Key | Type | Notes |
| --- | --- | --- |
| `source` | string | `openlibrary` or `wikidata`. |
| `role` | string | `edition_title`, `edition_subtitle`, `edition_display_fallback`, or `work_original_title`. |
| `text` | string | Recorded display main title. |
| `subtitle` | string or `null` | Recorded separate subtitle or `null`. |
| `language` | string | Title Language used by the attestation. |
| `sourceRecordUrl` | string | Source record URL for the attestation's Source Record. |
| `references` | External Reference array | Edition/Work references of the Source Record; empty when none. |
| `statementId` | string | Wikidata statement id when `source` is `wikidata`; omitted for Open Library. |
| `rank` | string | Wikidata rank (`preferred`/`normal`) when applicable; omitted otherwise. |
| `stale` | boolean | True when the underlying cached Source Record was stale (issue #10). |
| `fetchedAt` | string | ISO-8601 UTC fetch timestamp of the Source Record. |

```json
{
  "language": "es",
  "title": "Cien años de soledad",
  "subtitle": null,
  "level": "verified",
  "recommended": true,
  "satisfiesRequest": true,
  "originalTitle": false,
  "attestations": [
    {
      "source": "openlibrary",
      "role": "edition_title",
      "text": "Cien años de soledad",
      "subtitle": null,
      "language": "es",
      "sourceRecordUrl": "https://openlibrary.org/books/OL274507M.json",
      "references": [{ "namespace": "openlibrary:edition", "value": "OL274507M" }],
      "stale": false,
      "fetchedAt": "2026-09-05T12:34:56.789Z"
    }
  ]
}
```

### 8.1 `search` documents

All `search` documents have `command` equal to `"search"`. Statuses: `found`,
`not_found`, `failed`, `cancelled`.

#### `search` — `found` (exit `3`)

One or more Work Candidates were found; non-interactive selection is required
before titles can be requested. Partial source outages appear as `warnings`;
valid candidate data is never discarded.

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"search"`. |
| `status` | string | `"found"`. |
| `candidates` | Work Candidate array | Non-empty; issue #7 deterministic order. |
| `warnings` | Warning array | Always present; partial-failure and conflict warnings. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "search",
  "status": "found",
  "candidates": [
    {
      "title": "Cien años de soledad",
      "alternativeTitles": ["One Hundred Years of Solitude"],
      "authors": ["Gabriel García Márquez"],
      "publicationYear": 1967,
      "editionCount": 1,
      "contentLanguages": ["es"],
      "references": [
        { "namespace": "openlibrary:work", "value": "OL274505W" },
        { "namespace": "wikidata:item", "value": "Q178869" }
      ]
    }
  ],
  "warnings": []
}
```

#### `search` — `not_found` (exit `4`)

The sources answered and no Work matched. This is a valid completion.

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"search"`. |
| `status` | string | `"not_found"`. |
| `warnings` | Warning array | Always present; source notes such as `no_record` facts or outage warnings when one source failed. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "search",
  "status": "not_found",
  "warnings": []
}
```

#### `search` — `failed` (exit `10`)

No usable answer could be produced because the required lookup paths failed.

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"search"`. |
| `status` | string | `"failed"`. |
| `failures` | Failure array | Never empty; deterministic order. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "search",
  "status": "failed",
  "failures": [
    {
      "source": "openlibrary",
      "code": "timeout",
      "references": [],
      "details": { "requestIdentity": "https://openlibrary.org/search.json?q=..." }
    },
    {
      "source": "wikidata",
      "code": "unavailable",
      "references": [],
      "details": {}
    }
  ]
}
```

#### `search` — `cancelled` (exit `130`)

The operation was aborted by user interruption or the overall deadline. It is
not a failure and carries no warning or failure arrays.

| Key | Type |
| --- | --- |
| `schemaVersion` | string `"cli-json.v1"` |
| `command` | string `"search"` |
| `status` | string `"cancelled"` |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "search",
  "status": "cancelled"
}
```

### 8.2 `resolve` documents

All `resolve` documents have `command` equal to `"resolve"`. Statuses:
`resolved`, `needs_choice`, `not_found`, `failed`, `cancelled`.

#### `resolve` — `resolved` (exit `0`)

The reference or ISBN resolved unambiguously to one Work. The CLI non-
interactive resolve path confirms by a strong or explicit reference, so
`confirmation` is always `"strong_reference"` in this contract; the module
union also defines `candidate_confirmed` for the in-process TUI path (issue
#6), which never appears in CLI JSON because candidates cannot cross process
boundaries.

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"resolve"`. |
| `status` | string | `"resolved"`. |
| `confirmation` | string | `"strong_reference"`. |
| `work` | Resolved Work | Canonical Work references usable on later invocations. |
| `warnings` | Warning array | Always present. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "resolve",
  "status": "resolved",
  "confirmation": "strong_reference",
  "work": {
    "title": "Cien años de soledad",
    "authors": ["Gabriel García Márquez"],
    "firstPublicationYear": 1967,
    "contentLanguages": ["es"],
    "references": [
      { "namespace": "openlibrary:work", "value": "OL274505W" },
      { "namespace": "wikidata:item", "value": "Q178869" }
    ]
  },
  "warnings": []
}
```

#### `resolve` — `needs_choice` (exit `3`)

Resolution could not select one Work: the identifier or reference is
ambiguous, or indirect evidence surfaced a stronger candidate that must be
confirmed. The candidates in this document are for the caller to review;
the caller then repeats `resolve` with a Work-level reference.

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"resolve"`. |
| `status` | string | `"needs_choice"`. |
| `reason` | string | `ambiguous_identifier` or `indirect_evidence` (issue #6). |
| `candidates` | Work Candidate array | Non-empty; deterministic order. |
| `warnings` | Warning array | Always present; includes the duplicate-identifier or detached-Work warning that explains the reason. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "resolve",
  "status": "needs_choice",
  "reason": "ambiguous_identifier",
  "candidates": [
    {
      "title": "小王子",
      "alternativeTitles": ["The Little Prince"],
      "authors": ["Antoine de Saint-Exupéry"],
      "publicationYear": 1943,
      "editionCount": 1,
      "contentLanguages": ["zh"],
      "references": [{ "namespace": "openlibrary:work", "value": "OL10263W" }]
    }
  ],
  "warnings": [
    {
      "source": "openlibrary",
      "code": "duplicate_identifier",
      "references": [{ "namespace": "isbn", "value": "9787544253994" }],
      "details": { "otherEdition": "OL49205422M" }
    }
  ]
}
```

#### `resolve` — `not_found` (exit `4`), `failed` (exit `10`), `cancelled`
(exit `130`)

`not_found` means the sources answered that the reference or ISBN does not
resolve to a known Work. `failed` means the resolution paths failed; its
`failures` array is never empty. `cancelled` carries only the status fields.
These documents share the shapes of the corresponding `search` documents
(Section 8.1) with `command` set to `"resolve"` and no candidate field.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "resolve",
  "status": "not_found",
  "warnings": []
}
```

### 8.3 `titles` documents

All `titles` documents have `command` equal to `"titles"`. Because every CLI
invocation is one process, the command internally resolves its `--reference`
to a Work before calling `findTitles`; therefore a `titles` invocation can
also report the resolution outcomes `needs_choice` and `not_found`.
Statuses: `found`, `no_attested_titles`, `needs_choice`, `not_found`,
`failed`, `cancelled`.

Common fields on `found` and `no_attested_titles`:

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"titles"`. |
| `status` | string | `found` or `no_attested_titles`. |
| `work` | Resolved Work | The Work whose titles were requested, with canonical references. |
| `targetLanguages` | string array | Canonical requested tags, in the order given after canonicalization; empty means all discovered languages. |
| `groups` | Title Group array | Every Title Group in scope, deterministic order (Section 7.2). |
| `warnings` | Warning array | Always present. |

#### `titles` — `found` (exit `0`)

At least one default-visible group (Verified or Probable level that satisfies
the request) exists. `groups` still lists every in-scope group, including
non-satisfying and ambiguous evidence, each with `satisfiesRequest` and
`recommended` flags, so scripts can filter without reimplementing language
matching. Warnings carry partial-failure and conflict facts.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "titles",
  "status": "found",
  "work": {
    "title": "Cien años de soledad",
    "authors": ["Gabriel García Márquez"],
    "firstPublicationYear": 1967,
    "contentLanguages": ["es"],
    "references": [
      { "namespace": "openlibrary:work", "value": "OL274505W" },
      { "namespace": "wikidata:item", "value": "Q178869" }
    ]
  },
  "targetLanguages": ["es", "zh"],
  "groups": [
    {
      "language": "es",
      "title": "Cien años de soledad",
      "subtitle": null,
      "level": "verified",
      "recommended": true,
      "satisfiesRequest": true,
      "originalTitle": true,
      "attestations": [
        {
          "source": "openlibrary",
          "role": "edition_title",
          "text": "Cien años de soledad",
          "subtitle": null,
          "language": "es",
          "sourceRecordUrl": "https://openlibrary.org/books/OL274507M.json",
          "references": [{ "namespace": "openlibrary:edition", "value": "OL274507M" }],
          "stale": false,
          "fetchedAt": "2026-09-05T12:34:56.789Z"
        }
      ]
    },
    {
      "language": "zh",
      "title": "Bai nian gu du",
      "subtitle": null,
      "level": "verified",
      "recommended": true,
      "satisfiesRequest": true,
      "originalTitle": false,
      "attestations": [
        {
          "source": "openlibrary",
          "role": "edition_title",
          "text": "Bai nian gu du",
          "subtitle": null,
          "language": "zh",
          "sourceRecordUrl": "https://openlibrary.org/books/OL59138652M.json",
          "references": [{ "namespace": "openlibrary:edition", "value": "OL59138652M" }],
          "stale": false,
          "fetchedAt": "2026-09-05T12:34:56.789Z"
        }
      ]
    },
    {
      "language": "zh",
      "title": "百年孤独",
      "subtitle": null,
      "level": "probable",
      "recommended": false,
      "satisfiesRequest": true,
      "originalTitle": false,
      "attestations": [
        {
          "source": "openlibrary",
          "role": "edition_title",
          "text": "百年孤独",
          "subtitle": null,
          "language": "zh",
          "sourceRecordUrl": "https://openlibrary.org/books/OL43416865M.json",
          "references": [{ "namespace": "openlibrary:edition", "value": "OL43416865M" }],
          "stale": false,
          "fetchedAt": "2026-09-05T12:34:56.789Z"
        }
      ]
    }
  ],
  "warnings": []
}
```

The example is a fixture-style snapshot of the issue #7 `百年孤独` corpus: the
Spanish group is recommended at Verified, the direct Chinese edition attests
the romanized group at Verified (recommended for `zh`), and the `百年孤独`
group is Probable work-and-clue evidence, never merged into the Verified
group. Examples are fixed fixtures for contract tests, never live catalog
assertions.

#### `titles` — `no_attested_titles` (exit `5`)

The Work resolved, but no default-visible group satisfies the requested
languages. This is a valid completion, never a translation trigger. Any
non-satisfying, `und`/`mul`, or otherwise ambiguous groups are still listed in
`groups` with `satisfiesRequest: false` (or `level: "ambiguous"`), and the
requested-but-unsatisfied outcome is explicit in the status.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "titles",
  "status": "no_attested_titles",
  "work": {
    "title": "Cien años de soledad",
    "authors": ["Gabriel García Márquez"],
    "firstPublicationYear": 1967,
    "contentLanguages": ["es"],
    "references": [
      { "namespace": "openlibrary:work", "value": "OL274505W" },
      { "namespace": "wikidata:item", "value": "Q178869" }
    ]
  },
  "targetLanguages": ["zh-Hant"],
  "groups": [
    {
      "language": "und",
      "title": "百年孤独",
      "subtitle": null,
      "level": "ambiguous",
      "recommended": false,
      "satisfiesRequest": false,
      "originalTitle": false,
      "attestations": [
        {
          "source": "openlibrary",
          "role": "edition_title",
          "text": "百年孤独",
          "subtitle": null,
          "language": "und",
          "sourceRecordUrl": "https://openlibrary.org/books/OL49205422M.json",
          "references": [{ "namespace": "openlibrary:edition", "value": "OL49205422M" }],
          "stale": false,
          "fetchedAt": "2026-09-05T12:34:56.789Z"
        }
      ]
    }
  ],
  "warnings": [
    {
      "source": "openlibrary",
      "code": "language_divergence",
      "references": [{ "namespace": "openlibrary:edition", "value": "OL49205422M" }],
      "details": { "recorded": "chi", "requested": "zh-Hant" }
    }
  ]
}
```

#### `titles` — resolution-precondition outcomes

`needs_choice` (exit `3`) and `not_found` (exit `4`) use exactly the payloads
defined for `resolve` (Section 8.2) with `command` set to `"titles"`: the
supplied reference did not resolve to exactly one Work, so there is no Work
or group data. `failed` (exit `10`) and `cancelled` (exit `130`) use the
corresponding `search`/`resolve` shapes with `command` `"titles"`.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "titles",
  "status": "not_found",
  "warnings": []
}
```

### 8.4 `cache` documents

`cache list`, `cache show <digest>`, and `cache clear` are the maintenance
operations issue #10 requires. Their JSON preserves the issue #10 port
vocabulary verbatim, including `provider` tokens (`open_library`/`wikidata`)
and the raw envelope field names. This is why the spelling map in Section 7.3
exists. Statuses emitted on stdout are `ok` and `cancelled`; settings,
permission, and unsupported-environment failures exit `2` with stderr
diagnostics and no JSON document.

All `cache` documents carry `command: "cache"`, an `operation` field equal to
the subcommand, and `schemaVersion` first.

#### `cache list` — `ok` (exit `0`)

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"cache"`. |
| `operation` | string | `"list"`. |
| `status` | string | `"ok"`. |
| `entries` | Cache entry array | Issue #10 `CacheEntrySummary` documents, sorted by `digest`. |

Cache entry summary keys (verbatim from issue #10): `digest`, `provider`
(`open_library`/`wikidata`), `url`, `status` (integer HTTP status),
`freshnessClass` (`search`/`detail`/`negative`), `state` (`fresh`/`stale`),
`fetchedAt`, `freshUntil`, `byteLength`.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "cache",
  "operation": "list",
  "status": "ok",
  "entries": [
    {
      "digest": "9f2b4c1d0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
      "provider": "open_library",
      "url": "https://openlibrary.org/search.json?q=%E7%99%BE%E5%B9%B4%E5%AD%A4%E7%8B%AC",
      "status": 200,
      "freshnessClass": "search",
      "state": "fresh",
      "fetchedAt": "2026-09-05T12:34:56.789Z",
      "freshUntil": "2026-09-06T12:34:56.789Z",
      "byteLength": 8123
    }
  ]
}
```

#### `cache show <digest>` — `ok` (exit `0`)

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"cache"`. |
| `operation` | string | `"show"`. |
| `status` | string | `"ok"`. |
| `digest` | string | The requested 64-hex digest. |
| `entry` | object | The stored envelope (issue #10), verbatim, except `entry.response.body`, which is included only under `--debug`. |

The envelope object uses the issue #10 `RawResponseEnvelopeV1` keys:
`envelopeVersion`, `key` (`algorithm`, `digest`), `request` (`provider`,
`method`, `url`, `decoderSchemaVersion`), `response` (`status`, optional
`contentType`, `location`, `etag`, `lastModified`, and `body` under `--debug`
only), and `freshness` (`freshnessClass`, `negative`, `fetchedAt`,
`freshUntil`).

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "cache",
  "operation": "show",
  "status": "ok",
  "digest": "9f2b4c1d0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
  "entry": {
    "envelopeVersion": 1,
    "key": {
      "algorithm": "sha256",
      "digest": "9f2b4c1d0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c"
    },
    "request": {
      "provider": "open_library",
      "method": "GET",
      "url": "https://openlibrary.org/search.json?q=%E7%99%BE%E5%B9%B4%E5%AD%A4%E7%8B%AC",
      "decoderSchemaVersion": 1
    },
    "response": {
      "status": 200,
      "contentType": "application/json"
    },
    "freshness": {
      "freshnessClass": "search",
      "negative": false,
      "fetchedAt": "2026-09-05T12:34:56.789Z",
      "freshUntil": "2026-09-06T12:34:56.789Z"
    }
  }
}
```

#### `cache clear` — `ok` (exit `0`)

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"cache"`. |
| `operation` | string | `"clear"`. |
| `status` | string | `"ok"`. |
| `removedEntries` | integer | Live entries, quarantined files, and temp litter removed beneath the cache root. |
| `removedBytes` | integer | Total bytes removed. |

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "cache",
  "operation": "clear",
  "status": "ok",
  "removedEntries": 14,
  "removedBytes": 204800
}
```

`removedBytes` counts bytes and is an ordinary integer. The `cache clear`
operation never touches the config root (issue #10).

#### `cache` — `cancelled` (exit `130`)

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "cache",
  "operation": "list",
  "status": "cancelled"
}
```

### 8.5 `config show` documents

| Key | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | string | `"cli-json.v1"`. |
| `command` | string | `"config"`. |
| `operation` | string | `"show"`. |
| `status` | string | `"ok"` or `"cancelled"`. |
| `settings` | object | Effective settings: `configRoot`, `cacheRoot`, `offline`, `logLevel`, and optional `contact`. |
| `sources` | object | Per-setting origin (`cli`/`environment`/`config_file`/`default`); `cacheRoot` can only be `cli`, `environment`, or `default` (issue #10). |

`config show` prints the resolved settings, never raw file content, and never
prints reserved or future secrets (issue #10). The reserved
`BOOK_TITLE_GOOGLE_API_KEY` is not read and cannot appear.

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "config",
  "operation": "show",
  "status": "ok",
  "settings": {
    "configRoot": "/home/alice/.config/book-title-lookup",
    "cacheRoot": "/home/alice/.cache/book-title-lookup",
    "offline": false,
    "logLevel": "info",
    "contact": "alice@example.com"
  },
  "sources": {
    "offline": "default",
    "logLevel": "default",
    "contact": "environment",
    "cacheRoot": "default"
  }
}
```

An invalid config file, a denied environment variable or path, or an
unsupported platform root is a configuration failure: stderr diagnostics and
exit `2`, no JSON document on stdout.

## 9. CLI contract-test tables

The tables below are the acceptance matrix the CLI integration tests assert
under issue #14. Every row runs against the module-level fake (issue #6) and
the real composition with fixture-backed providers; no row requires a live
source or a physical terminal unless noted. `doc` abbreviates the JSON
`status` field. Rows marked [ordering] additionally assert exact byte output
against fixed snapshots. Warnings/failures arrays follow the ordering rules in
Section 7.2.

### 9.1 Cross-cutting

| # | Case | Invocation | stdout | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| X1 | Help | `book-title --help` | Usage text | `0` | No JSON document; usage explains every command and option. |
| X2 | Command help | `book-title titles --help` | Command usage | `0` | |
| X3 | Version | `book-title --version` | `book-title <version>` line | `0` | Version equals the release stamp. |
| X4 | Unknown command | `book-title frobnicate` | none | `2` | Diagnostic on stderr. |
| X5 | Unknown option | `book-title search --titles x` | none | `2` | |
| X6 | No command, non-TTY | `book-title` (piped) | none | `2` | Never starts the TUI. |
| X7 | No command, TTY, `--json` | `book-title --json` in a TTY | none | `2` | `--json` never starts the TUI. |
| X8 | Missing required option | `book-title resolve` | none | `2` | |
| X9 | Conflicting options | `book-title resolve --isbn 9780140328721 --reference openlibrary:work:OL274505W` | none | `2` | |
| X10 | Repeated single-value option | `book-title titles --reference a:b --reference c:d` | none | `2` | |
| X11 | Invalid reference namespace | `book-title resolve --reference lccn:123` | none | `2` | Only the four supported namespaces. |
| X12 | Malformed reference | `book-title titles --reference openlibrary:work` | none | `2` | Missing value. |
| X13 | Invalid language tag | `book-title titles --reference a:b --language 12ab` | none | `2` | |
| X14 | Sentinels rejected as languages | `book-title titles --reference a:b --language und` | none | `2` | |
| X15 | Invalid cache-dir | `book-title cache list --cache-dir relative/path` | none | `2` | Relative override invalid (issue #10). |
| X16 | Invalid digest | `book-title cache show abc` | none | `2` | Must be 64 lowercase hex. |
| X17 | [ordering] JSON envelope | Any `--json` data outcome | One compact JSON value + newline | per doc | `schemaVersion` first; UTF-8, no BOM, no color. |
| X18 | JSON stdout purity | `search --json` | Document only | per doc | No progress, help, or prompt text on stdout. |
| X19 | Warnings on stderr | `search --title <partial-fixture>` | Document; warnings in doc | per doc | Human warning text also on stderr, never stdout. |
| X20 | No prompts | Every command under a PTY with `--json` | Document | per doc | Assert no stdin read occurs. |
| X21 | Color disabled | `--no-color`, `NO_COLOR=1`, or `TERM=dumb` human output | No ANSI | `0` | |
| X22 | Secret redaction | `config show --json` with reserved env present | No secret value | `0` | `BOOK_TITLE_GOOGLE_API_KEY` never appears (not even read). |
| X23 | Permission failure | Run under grants denying cache root | none | `2` | stderr diagnostic; no JSON; never a book outcome. |
| X24 | Invalid config file | Config file with unknown key | none | `2` | Issue #10 `invalid_config`. |
| X25 | Signals | Send `SIGINT` during a fixture-backed slow search | `cancelled` doc when writable | `130` | No failure data. |
| X26 | Option forms | `--title=百年孤独` and `--title 百年孤独` | Same document | same | Grammar equivalence. |
| X27 | Deterministic repeats | Same invocation twice against fixed fixtures [ordering] | Byte-identical output | same | |
| X28 | Launcher passthrough | Run through the npm launcher with a stub binary | unchanged | synthetic | Launcher never writes stdout; reserved `70` only launcher-level. |

### 9.2 `search`

| # | Case | Invocation | doc status | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| S1 | Candidates found | `search --title 百年孤独 --json` (found fixture) | `found` | `3` | `candidates` non-empty; each candidate carries ≥1 Work reference; [ordering] by issue #7 comparator. |
| S2 | Single candidate | `search --title <single-candidate fixture> --json` | `found` | `3` | Confirmation is still required; never auto-resolves. |
| S3 | No matching Work | `search --title <nonexistent fixture> --json` | `not_found` | `4` | `candidates` absent; no fabrication. |
| S4 | Partial source outage | `search --title <partial-outage fixture> --json` | `found` | `3` | Successful source's candidates present; failing source as `warnings`; never `failed`. |
| S5 | All sources failed | `search --title x` with both sources failing | `failed` | `10` | `failures` non-empty. |
| S6 | Cancelled | Cancel during search | `cancelled` | `130` | |
| S7 | With optional fields | `search --title 小王子 --author 圣埃克苏佩里 --year 1943 --json` | `found` | `3` | Query fields combine per `BookQuery`. |
| S8 | Empty title | `search --title " "` | none | `2` | |
| S9 | ISBN with search | `search --title 小王子 --isbn 9780156012195 --json` | `found` | `3` | |
| S10 | Human text | `search --title 百年孤独` in a TTY | Candidate text | `3` | Text on stdout; warnings/progress on stderr. |

### 9.3 `resolve`

| # | Case | Invocation | doc status | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| R1 | Work reference | `resolve --reference openlibrary:work:OL274505W --json` (resolves fixture) | `resolved` | `0` | `confirmation` = `strong_reference`; `work.references` canonical. |
| R2 | Wikidata item | `resolve --reference wikidata:item:Q178869 --json` | `resolved` | `0` | P648 identity mapping yields both references when known. |
| R3 | ISBN direct | `resolve --isbn 9780140328721 --json` | `resolved` | `0` | ISBN-10 input also normalizes to ISBN-13. |
| R4 | Edition reference | `resolve --reference openlibrary:edition:OL59138652M --json` | `resolved` | `0` | Unique Edition-to-Work relation. |
| R5 | Duplicate identifier | `resolve --isbn <duplicate fixture>` | `needs_choice` | `3` | `reason` = `ambiguous_identifier`; warning explains duplicate. |
| R6 | Indirect evidence | `resolve --reference <isolated-work fixture>` | `needs_choice` | `3` | `reason` = `indirect_evidence`; Probable stronger candidates listed. |
| R7 | Unknown reference | `resolve --reference openlibrary:work:OLDOESNOTEXIST --json` | `not_found` | `4` | |
| R8 | All failed | Both resolution paths fail | `failed` | `10` | |
| R9 | Cancelled | Cancel during resolve | `cancelled` | `130` | |
| R10 | No opaque handles | [ordering] `search --json` output parsed and reused | — | — | Assert no `candidate` `ref`, `resolvedWorkRef`, or session token ever appears in any JSON key or value. |

### 9.4 `titles`

| # | Case | Invocation | doc status | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| T1 | Multi-language found | `titles --reference openlibrary:work:OL274505W --language es --language zh --json` | `found` | `0` | One `recommended: true` group per concrete language; [ordering] by language then `rankGroups`. |
| T2 | All languages | `titles --reference openlibrary:work:OL274505W --json` | `found` | `0` | Empty `targetLanguages`; every known-language group `satisfiesRequest: true`. |
| T3 | No attested titles | `titles --reference ... --language zh-Hant` (script-less fixture) | `no_attested_titles` | `5` | Non-satisfying/ambiguous groups still present with flags; warning attached. |
| T4 | Script precision | `--language zh-Hans` vs `--language zh-Hant` vs `--language zh` | per fixture | per fixture | `zh` request matches scripted groups; script-specific requests do not match script-less groups. |
| T5 | Ambiguous never recommended | Any fixture with only ambiguous/`und` evidence | `no_attested_titles` or `found` with none recommended in `und` | per fixture | Assert no group with `language: und` or `level: ambiguous` is `recommended`. |
| T6 | Reference needs choice | `titles --reference <duplicate edition fixture>` | `needs_choice` | `3` | Resolution precondition payload; no work/groups. |
| T7 | Reference not found | `titles --reference openlibrary:work:OLDOESNOTEXIST` | `not_found` | `4` | |
| T8 | All title paths failed | Edition expansion fails on both sources | `failed` | `10` | |
| T9 | Cancelled | Cancel during title lookup | `cancelled` | `130` | |
| T10 | Human text | `titles --reference ... --language en` | Title text | per outcome | Default-visible groups first per language; ambiguous section last. |

### 9.5 `cache`

| # | Case | Invocation | doc status | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| C1 | Empty list | `cache list --json` | `ok` | `0` | `entries` = `[]`. |
| C2 | List order | `cache list --json` over fixed entries [ordering] | `ok` | `0` | Sorted by `digest` (issue #10). |
| C3 | Show | `cache show <digest> --json` | `ok` | `0` | Envelope verbatim except body omitted. |
| C4 | Show with body | `cache show <digest> --debug --json` | `ok` | `0` | `response.body` present with declared encoding. |
| C5 | Show missing digest | `cache show <unknown-digest>` | none | `2` | Issue #10 typed miss maps to config/diagnostic exit class. |
| C6 | Clear | `cache clear --json` | `ok` | `0` | Counts reflect removed entries and bytes; config root untouched. |
| C7 | Clear empty | `cache clear --json` with no entries | `ok` | `0` | Counts are `0`. |
| C8 | Permission denied | Cache root denied | none | `2` | stderr diagnostic. |
| C9 | Cancelled | Cancel during list | `cancelled` | `130` | |
| C10 | Provider token | [ordering] Assert cache entries carry `open_library`/`wikidata` and bibliographic docs carry `openlibrary`/`wikidata`. | `ok` | `0` | Documented spelling map (Section 7.3). |

### 9.6 `config`

| # | Case | Invocation | doc status | exit | Notes |
| --- | --- | --- | --- | --- | --- |
| G1 | Defaults | `config show --json` with no env/config | `ok` | `0` | All origins `default`; paths from the platform table. |
| G2 | Precedence | Set env + config + CLI override | `ok` | `0` | Per-setting origins recorded exactly (`cli` > `environment` > `config_file` > `default`). |
| G3 | Cache root origin | `--cache-dir` and env override | `ok` | `0` | `cacheRoot` origin is `cli` or `environment`; never `config_file`. |
| G4 | Invalid config | Unknown key or wrong `schemaVersion` in config file | none | `2` | |
| G5 | Reserved secret | `BOOK_TITLE_GOOGLE_API_KEY` set | `ok` | `0` | Never read, echoed, or logged. |
| G6 | Human text | `config show` in a TTY | Settings text | `0` | |

## 10. Human output

Without `--json`, each command writes deterministic plain text to stdout. The
text below is the normative shape; the exact bytes are fixtures under issue
#14. Human text uses the same grouping and ordering rules as JSON, may use
ANSI styling under the Section 3.2 rules, and never invents facts beyond the
document content. Diagnostics, warnings, and progress go to stderr.

### 10.1 `search`

```text
Candidates
1. Cien años de soledad (1967)
   Authors: Gabriel García Márquez
   References: openlibrary:work:OL274505W, wikidata:item:Q178869
2. ...
```

Candidates are numbered in the issue #7 deterministic order. The exit code is
still `3` when candidates are present.

### 10.2 `resolve`

```text
Resolved work
Title: Cien años de soledad
Authors: Gabriel García Márquez
First published: 1967
References: openlibrary:work:OL274505W, wikidata:item:Q178869
```

For `needs_choice`, human output prints the candidates list (Section 10.1
shape) with the reason line first; the exit code is `3` and the CLI never
prompts the user to pick.

### 10.3 `titles`

```text
Attested titles for Cien años de soledad

es (recommended)
  Cien años de soledad  [verified]
  Editions: openlibrary:edition:OL274507M

zh (recommended)
  Bai nian gu du  [verified]
  Editions: openlibrary:edition:OL59138652M

zh
  百年孤独  [probable]
  Editions: openlibrary:edition:OL43416865M

Ambiguous
  und: 百年孤独  [ambiguous]
```

Default-visible groups are shown grouped by language in ascending language
order, recommended group first per language. Ambiguous and non-satisfying
groups print last under an `Ambiguous` heading when any are present. The
`no_attested_titles` outcome prints the work line, a message that no attested
title satisfied the requested languages, and then the same trailing evidence
section; it never offers a translation.

### 10.4 `cache` and `config`

```text
$ book-title cache list
<digest>  open_library  search  fresh  2026-09-05T12:34:56.789Z  8123 B  https://...

$ book-title config show
config root:  /home/alice/.config/book-title-lookup   (default)
cache root:   /home/alice/.cache/book-title-lookup    (default)
offline:      false                                  (default)
log level:    info                                   (default)
contact:      alice@example.com                      (environment)
```

`cache show` without `--json` prints the envelope summary and omits the body;
`cache show --debug` prints the body with its declared encoding.

### 10.5 Help

Top-level help lists the modes (TUI, `search`, `resolve`, `titles`, `cache`,
`config`) and the global options. Command help lists that command's options
and validation rules. Help text is deterministic English and is not a JSON
document.

## 11. Worked end-to-end example

A scripted lookup of the acceptance-corpus `百年孤独` case, fixture-backed:

```text
$ book-title search --title 百年孤独 --json
```

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "search",
  "status": "found",
  "candidates": [
    {
      "title": "Cien años de soledad",
      "alternativeTitles": ["One Hundred Years of Solitude"],
      "authors": ["Gabriel García Márquez"],
      "publicationYear": 1967,
      "editionCount": 1,
      "contentLanguages": ["es"],
      "references": [
        { "namespace": "openlibrary:work", "value": "OL274505W" },
        { "namespace": "wikidata:item", "value": "Q178869" }
      ]
    }
  ],
  "warnings": []
}
```

Exit `3`: candidates exist and non-interactive selection is required. The
caller chooses the Work-level reference printed on the candidate — never a
hidden session token — and confirms it:

```text
$ book-title resolve --reference openlibrary:work:OL274505W --json
```

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "resolve",
  "status": "resolved",
  "confirmation": "strong_reference",
  "work": {
    "title": "Cien años de soledad",
    "authors": ["Gabriel García Márquez"],
    "firstPublicationYear": 1967,
    "contentLanguages": ["es"],
    "references": [
      { "namespace": "openlibrary:work", "value": "OL274505W" },
      { "namespace": "wikidata:item", "value": "Q178869" }
    ]
  },
  "warnings": []
}
```

Exit `0`. The resolved Work carries both canonical references; the script
stores whichever it prefers. Finally the title lookup runs in its own process
and re-resolves the reference internally:

```text
$ book-title titles --reference openlibrary:work:OL274505W --language es --language zh --json
```

```json
{
  "schemaVersion": "cli-json.v1",
  "command": "titles",
  "status": "found",
  "work": {
    "title": "Cien años de soledad",
    "authors": ["Gabriel García Márquez"],
    "firstPublicationYear": 1967,
    "contentLanguages": ["es"],
    "references": [
      { "namespace": "openlibrary:work", "value": "OL274505W" },
      { "namespace": "wikidata:item", "value": "Q178869" }
    ]
  },
  "targetLanguages": ["es", "zh"],
  "groups": [
    {
      "language": "es",
      "title": "Cien años de soledad",
      "subtitle": null,
      "level": "verified",
      "recommended": true,
      "satisfiesRequest": true,
      "originalTitle": true,
      "attestations": [
        {
          "source": "openlibrary",
          "role": "edition_title",
          "text": "Cien años de soledad",
          "subtitle": null,
          "language": "es",
          "sourceRecordUrl": "https://openlibrary.org/books/OL274507M.json",
          "references": [{ "namespace": "openlibrary:edition", "value": "OL274507M" }],
          "stale": false,
          "fetchedAt": "2026-09-05T12:34:56.789Z"
        }
      ]
    }
  ],
  "warnings": []
}
```

Exit `0`. A maintenance pass over the same session might run:

```text
$ book-title config show --json
$ book-title cache list --json
$ book-title cache clear --json
```

The three lookup commands plus the two maintenance commands are the complete
automation surface of the MVP.

## 12. Consequences and risks

### 12.1 Consequences for downstream tickets

- **#13** — The TUI state/effect seam calls the module operations in-process,
  so it may use opaque session refs internally; it must never present them to
  a user or script as reusable handles. TUI screens can consume the same
  outcome vocabulary this contract serializes.
- **#14** — Scaffolds the workspace and builds the first CLI vertical slice
  from this document. It creates the machine-validatable JSON Schema bundle,
  the fixture documents, and the Section 9 integration tests. The module
  outcome unions from #6 already carry the statuses this contract requires;
  the `titles` command's resolution-precondition statuses are implemented in
  the CLI composition root, not added to the `findTitles` module union.
- The spelling map between cache `provider` tokens and bibliographic `source`
  ids (Section 7.3) is enforced by contract-test row C10 so it cannot drift.

### 12.2 Risks and revisit triggers

- **Exit `3` on `search` `found`.** Product and architecture text already
  require a dedicated exit code for non-interactive candidate selection. A
  future interactive-only caller that finds this surprising can rely on the
  JSON `status`; changing the mapping is a breaking change and requires a new
  schema-version major.
- **Provider-token spelling difference.** Cache documents keep issue #10
  tokens verbatim. If a later release consolidates the cache seam onto the
  boundary spelling, it must do so with an envelope-format or
  schema-version change and the mapping test row C10 updated together.
- **Reference durability is upstream durability.** External References are
  durable within the contract but their resolution can change upstream;
  `resolve` and `titles` report `needs_choice`/`not_found` honestly rather
  than guessing. This is the accepted issue #7 behavior.
- **Document size.** Group and attestation payloads make `titles` documents
  large for heavily attested Works. The MVP accepts this because every
  returned title must retain source and evidence; a future
  `--languages`-narrowed request is already the mitigation.
- **Cancellation output is best-effort.** A hard signal before the final
  write can truncate stdout; contract tests use injectable signals/deadlines
  and only assert the `cancelled` document when the write is reachable.

## 13. References

Frozen-input constraints (authoritative):

- `CONTEXT.md`, `docs/product-spec.md`, `docs/architecture.md`, ADRs `0001`
  and `0002`.
- `docs/design/catalog-module-interface.md` (issue #6) — module operations,
  queries, outcome unions, and the opaque/External Reference lifecycle.
- `docs/design/evidence-reconciliation.md` (issue #7) — deterministic
  candidate order, group keys, levels, language matching, recommendation, and
  warning/conflict semantics.
- `docs/design/provider-runtime.md` (issue #8) — typed failures and
  source states.
- `docs/design/cache-and-config.md` (issue #10) — cache commands,
  `CacheEntrySummary`, `RawResponseEnvelopeV1`, settings resolution and
  origins, permission/config failure mapping, and the `config.v1`
  `schemaVersion` precedent.
- `docs/design/npm-release-topology.md` (issue #11) — binary name
  `book-title`, launcher passthrough, and reserved exit code `70`.
- `docs/design/tui-rendering-strategy.md` (issue #9) and
  `docs/agents/issue-tracker.md` for lifecycle and scope context.

Historical planning snapshot (provenance only):
`.scratch/mvp-implementation/issues/12-freeze-the-cli-and-json-contract.md`.


