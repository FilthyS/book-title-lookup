# Implementation Plan — Order the Implementation Frontier

Deliverable for [GitHub issue #14 — Order the implementation
frontier](https://github.com/FilthyS/book-title-lookup/issues/14).
Type: grilling, phase: planning.
Status: accepted implementation plan.

This document turns the cleared planning map into the fewest coherent
vertical slices and then into ready-to-copy GitHub build tickets. It is a
planning document: it adds no production code, changes nothing under
`.scratch/`, and does not create GitHub tickets. The coordinator opens the
build tickets in Section 6 after this issue closes.

## 1. Purpose and scope

Issue #14 asks:

> In what vertical-slice order should the agreed modules, adapters,
> interfaces, tests, TUI, and distribution be implemented, and what
> evidence-based acceptance gate ends each slice so the cleared map can
> become one implementation spec and then executable build tickets?

This plan answers it. It converts the frozen contracts of issues #6–#13 into
six ordered, runnable, fixture-backed build tickets, each with one explicit
completion gate. The map's destination — "the cleared map can become one
implementation spec and then executable build tickets" — is reached in two
steps: this document is the implementation spec, and Section 6 supplies the
executable build tickets.

Scope boundaries inherited from the planning map:

- The plan specifies the build; it does not implement the build.
- No registry publication, no external service writes, and no release
  infrastructure is created without separate approval.
- Google Books, machine translation, accounts, hosting, plugin APIs, and the
  other product non-goals stay out of every ticket.
- Build tickets are `type: task`. They are opened and assigned by the human
  coordinator under the lifecycle in `docs/agents/issue-tracker.md`; a local
  pi worker never opens, labels, or closes them.

## 2. Authoritative inputs

The plan is bound by the accepted artifacts. Where a ticket below cites one
of these documents, the cited document is the normative contract; this plan
only orders the work and fixes ticket boundaries.

Baseline and governance:

- `CONTEXT.md` — domain language (Work, Edition, Attested Title, Title
  Attestation, Title Group, Original Title, Search Alias, Evidence Level,
  Content Language, Title Language).
- `docs/product-spec.md` — product statement, query contract, evidence,
  outcomes, TUI workflow, CLI behavior, source availability, cache behavior,
  acceptance corpus, and the MVP completion gates G1–G11 below.
- `docs/architecture.md` — system shape, workspace, public boundary,
  provider boundary, reconciliation rules, request policy, cache, TUI state
  model, CLI/process contract, configuration, permissions, testing,
  distribution.
- `docs/data-sources.md` — source selection and the observed `百年孤独`
  resolution case.
- ADRs `0001` (evidence-based lookup), `0002` (local modular application),
  and `0003` (distribute Deno binaries through npm).
- `docs/agents/issue-tracker.md` — ticket lifecycle, labels, dependency
  syntax, and the pi-worker contract.

Accepted design decisions:

- Issue #6: `docs/design/catalog-module-interface.md` — the
  `BookTitleCatalog` application seam, outcome unions, opaque refs, internal
  evidence port, fake and contract-test seams.
- Issue #7: `docs/design/evidence-reconciliation.md` — the deterministic
  reconciliation and recommendation pipeline, invariants, and acceptance
  corpus fixture table.
- Issue #8: `docs/design/provider-runtime.md` — the deep `ProviderRuntime`,
  source workflows, decoding seam, retry/deadline/cancellation policy, and
  fixture harness.
- Issue #9: `docs/design/tui-rendering-strategy.md` — the thin project-owned
  ANSI renderer decision, measured evidence, and the manual Windows Terminal
  release gate.
- Issue #10: `docs/design/cache-and-config.md` — the `ResponseCache` port,
  `FileEntryStore`, `providers/platform`, `SettingsResolver`, envelope and
  key schemas, freshness, corruption, permissions, and fixture matrix.
- Issue #11: `docs/design/npm-release-topology.md` — the frozen package
  topology, names, launcher contract, gates, and recovery rules.
- Issue #12: `docs/design/cli-json-contract.md` — commands, option grammar,
  reference policy, streams, exit codes, schema version, JSON documents, and
  contract-test tables.
- Issue #13: `docs/design/application-state-and-effects.md` — the session
  coordinator: session state, messages, effects, reducer pseudocode,
  effect-runner ownership, navigation table, CLI projection, and terminal
  ownership.

Accepted research:

- Issue #1: `docs/research/open-library-evidence-surface.md`.
- Issue #2: `docs/research/wikidata-retrieval-strategy.md`.
- Issue #3: `docs/research/deno-tui-candidates.md`.
- Issue #4: `docs/research/npm-binary-distribution.md`.
- Issue #5: `docs/research/deno-persistence-and-permissions.md`, decisions
  D1–D9.

Product completion gates (from `docs/product-spec.md`, "MVP Completion"):

| Gate | MVP completion requirement |
| --- | --- |
| G1 | Formatting, linting, type checking, and automated tests pass |
| G2 | Domain and reconciliation rules covered by unit tests |
| G3 | Providers pass fixture-backed contract tests |
| G4 | TUI state tests cover navigation, cancellation, stale responses, and partial failure |
| G5 | CLI tests cover stdout, stderr, JSON schema, and exit behavior |
| G6 | npm launcher tests pass platform, argument, signal, and exit-code behavior |
| G7 | Windows Terminal manual Chinese input, wide-character, resize, cancellation, and terminal-restoration checks |
| G8 | Low-volume live smoke tests pass for Open Library and Wikidata |
| G9 | The acceptance corpus has been manually exercised |
| G10 | A Windows binary is built and run successfully |
| G11 | npm packages pass dry-run and tarball inspection |

## 3. Reconciliation of contradictions

The accepted documents were written while issue #14 was still open and
sometimes refer to "#14" as if it were an implementation ticket. Under the
live tracker, #14 is the final planning ticket. The plan reconciles the
following points rather than repeating both readings.

1. **"#14 scaffolds the workspace" is now #15–#20.** Several documents say
   "package scaffolding and code land under issue #14" (catalog-module-interface,
   cli-json-contract, application-state-and-effects). Issue #14 is a
   `type: grilling, phase: planning` ticket and its deliverable is this
   plan. The scaffolding and code assignments therefore become the build
   tickets in Section 6. Each build ticket states the design references it
   implements; no such reference is left assigned to a planning ticket.
2. **The architecture sketch of the TUI state model is superseded.**
   `docs/architecture.md` shows an illustrative `Screen` union and
   `AppState`. Issue #13 explicitly supersedes that sketch: the frozen
   `SessionState`, `Message`, `Effect`, reducer, and effect-runner types in
   `application-state-and-effects.md` are authoritative for implementation.
3. **The spike's non-interactive guard is not the production process
   contract.** The throwaway issue #9 binaries exited `0` after a guard
   message when run non-interactively. Issue #13 section 13.1 freezes the
   production rule: `book-title` with no command outside the exact TUI case
   (both stdin/stdout TTY and no `--json`) is a usage error with exit `2`.
   Build ticket #19 implements the final mode-selection table; earlier
   tickets never claim the final no-command contract.
4. **The coordinator is mode-agnostic; CLI and TUI differ only in goal and
   driver.** CLI `search`/`resolve`/`titles` commands run directed sessions
   over the same reducer that the TUI drives interactively. The CLI lookup
   work therefore lands with the core/module slice (#16), and the TUI slice
   (#19) adds interactive transitions, the renderer, and terminal ownership
   without reimplementing lookup policy.
5. **`cache` and `config` never enter the session coordinator.** Issue #13
   section 2 fixes them as maintenance commands that bypass the coordinator.
   That is why the maintenance CLI can precede every lookup slice.
6. **One source identifier at every boundary.** Cache documents use
   `provider` tokens `openlibrary`/`wikidata`; bibliographic documents use
   `source` tokens `openlibrary`/`wikidata` (issue #12 section 7.3). The
   plan treats these as the same canonical spelling enforced by contract
   tests (CLI row C10).
7. **Open Library first, Wikidata second.** Research and design documents
   agree Wikidata is supplementary and Open Library is primary; issue #8
   and the acceptance corpus need the OL path proven before the federated
   composition grows. The slice order below reflects that, as the worker
   guide requires.
8. **No lifecycle scripts, no install-time downloads, no publish path.**
   ADR 0003 and issue #11 fix the npm topology. Build ticket #20 produces
   packages, tarballs, and gates but contains no code path that can publish;
   publication remains a separate, explicitly authorized operation.

## 4. Slicing rationale

The worker guide for issue #14 requires: the fewest coherent vertical
slices; start with repository/workspace scaffolding without horizontal
layers that leave nothing runnable; establish an Open Library CLI slice
before Wikidata/TUI/distribution; and end with cleanup or promotion rules
for the TUI spike.

The six slices below are the smallest set that keeps every slice runnable or
testable on its own and never builds a wide horizontal layer that produces no
capability:

| # | Build ticket | Runnable capability at the end of the slice |
| --- | --- | --- |
| 15 | Workspace scaffold + configuration/cache seam + maintenance CLI | `book-title --help`, `--version`, `config show`, `cache list/show/clear` against real platform roots and a real file cache |
| 16 | Catalog module + evidence reconciliation + session coordinator + fixture-backed CLI contract | `book-title search/resolve/titles` end-to-end over the module-level fake with final JSON, human text, and exit codes |
| 17 | Provider runtime + Open Library vertical slice | The same CLI driven by the real catalog service over fixture-backed Open Library HTTP; runtime, cache, retry, redirect behavior proven |
| 18 | Wikidata adapter + two-source composition | Cross-source candidates, partial failure, offline/stale behavior, and low-volume live smoke for both sources |
| 19 | Thin-renderer TUI + interactive session; retire the TUI spike | `book-title` with no command in a TTY runs the full-screen workflow; the disposable spike is removed |
| 20 | Compile + npm launcher distribution gates | Four platform binaries, npm package trees, launcher contract tests, tarball inspection, and the artifact manifest; no publish |

Why this is minimal:

- The maintenance surface (#15) is required first because the whole
  application needs the settings, permission, and file-cache seams before any
  provider fetches through the cache, and it leaves a real CLI behind.
- The module contract, reconciliation domain, and CLI process contract (#16)
  form one vertical slice because the module seam, the pure Core pipeline,
  and the CLI projection are tested together against the module-level fake;
  splitting them would build interfaces with no runnable consumer.
- Open Library (#17) is a complete provider vertical slice before Wikidata
  (#18) because issue #8's deep runtime and the OL workflow are independent
  of WD, and the OL evidence path must be proven first.
- The TUI (#19) is deliberately last among application slices: it consumes
  the complete coordinator and the composition root with both sources, and
  it is where the disposable spike's evidence is promoted and the spike is
  retired.
- Distribution (#20) is last because it packages the completed application
  and only exercises the product gates (G6, G10, G11) meaningfully once the
  app, providers, and TUI exist.

Each slice also satisfies the rule "avoid horizontal layers that leave
nothing runnable": #15 leaves a working maintenance CLI, #16 a working
fixture-backed lookup CLI, #17–#18 a working real-source lookup CLI, #19 the
full product workflow, and #20 a release-shaped artifact set.

## 5. Workspace and shared conventions

These conventions are refinements of the repository shape the accepted
documents already fix. Ticket #15 validates and commits the exact Deno 2.9
workspace mechanics.

### 5.1 Target workspace tree

```text
/
├── apps/
│   └── tui/                  # composition root, CLI + TUI drivers, coordinator
├── packages/
│   ├── core/                 # domain, BookTitleCatalog, reconciliation, internal evidence port
│   └── providers/            # runtime, platform, cache store, OL + WD adapters, federation
├── distribution/
│   ├── npm/
│   │   ├── launcher/         # book-title-lookup launcher package tree
│   │   └── platform-package/ # platform package template tree
│   └── scripts/              # compile, pack, manifest, verification scripts
├── fixtures/                 # shared fixture-backed test data (see 5.3)
├── docs/                     # unchanged; this plan is added here
├── CONTEXT.md
├── README.md
└── deno.json                 # workspace + tasks (fmt/lint/check/test)
```

`distribution/` is not a Deno workspace member; generated packages live under
`dist/` and are ignored. `packages/core` never imports `packages/providers`;
`apps/tui` is the only member that may import both. Relative imports keep the
workspace local; no member is published to JSR or npm from a build ticket.

### 5.2 Task and permission surface

The root `deno.json` gains workspace configuration plus repository tasks:

```text
deno task fmt        deno task fmt:check
deno task lint       deno task check      deno task test
```

Per-member tasks (`check:core`, `test:core`, `check:providers`, ...) may be
added as the workspace layout settles. Every task runs without `-A`.
Environment, network, and path grants follow issue #5 D7 and issue #10
section 17:

- development and CI grants: the exact allowlisted environment variable
  names, the catalog hosts, and the resolved fixture roots;
- the permission manifest is derived from the same `ENV_ALLOWLIST` constant
  the code reads (issue #10 section 16.1);
- compiled-artifact filesystem policy is the sealed-seam release decision
  from issue #10 D11, owned by ticket #20.

A committed `deno.lock` is added as soon as any dependency is introduced.
The MVP introduces no runtime dependency beyond Deno built-ins and, where a
ticket explicitly justifies it, narrow `@std` helpers; issue #8 fixes the
providers side to add none.

### 5.3 Fixture layout

Shared fixture data is not a package. Raw HTTP response envelopes and
module-level payloads live under `fixtures/` so that provider contract tests,
Core unit tests, and CLI/TUI integration tests can consume the same fixed
snapshots:

```text
fixtures/
├── acceptance-corpus/        # issue #7 section 17 corpus inputs + expected results
├── cli-json/                 # cli-json.v1 schema bundle + document snapshots (issue #12)
├── providers/
│   ├── openlibrary/          # research #1 fixture guidance items 1-9
│   └── wikidata/             # research #2 fixtures F1-F7 + SPARQL rows
└── npm/                      # launcher stub binaries for distribution tests (#20)
```

Every fixture records source, source record URL, requested/final URL,
fetched-at timestamp, status, content type, and decoder schema version where
the consuming contract requires it. Live catalog values are never test
assertions (research #1 recommendation 10, issue #7 section 17).

### 5.4 JSON and snapshot conventions

Ticket #16 creates the machine-validatable `cli-json.v1` JSON Schema bundle
that issue #12 section 8 requires, plus byte-exact document snapshots. All
CLI JSON writes are compact, single-value, UTF-8 without BOM, with a trailing
newline, `schemaVersion` first, and the deterministic ordering rules of issue
#12 section 7.2.

## 6. Vertical slices and ready-to-copy build tickets

Each subsection is one build ticket. The issue body in each fenced block is
ready to copy into a GitHub issue exactly as written, with the label applied
by the coordinator. Numbers #15–#20 are the expected sequential assignments
once issue #14 closes; if the actual numbers differ, the coordinator rewrites
the `Blocked by:` references and PR bodies accordingly.

---

### 6.1 Ticket #15 — Workspace scaffold, configuration/cache seams, maintenance CLI

Issue body:

```text
Title: Scaffold the Deno workspace and implement the configuration and cache
seams with the maintenance CLI

Type: task
Labels: type: task

Blocked by: (none - first build ticket)

Prerequisites
- Closed planning issues #5 and #10 supply the settings/cache contracts;
  no earlier build ticket exists.

Goal
Turn the repository from a design-only tree into a runnable Deno workspace
whose maintenance commands work against the real settings and file-cache
seams, so later provider and lookup slices have a tested foundation and the
repository is never left with nothing runnable.

Deliverable / capability
- Deno workspace with apps/tui, packages/core, and packages/providers as
  members; root tasks fmt/lint/check/test; committed deno.lock; a
  permission manifest per issue #5 D7.
- packages/providers/src/platform: directory locator (issue #5 D1-D2),
  closed environment allowlist (issue #5 D6), path canonicalization and
  containment.
- packages/providers/src/cache: ResponseCache port, FileEntryStore, SHA-256
  canonical cache keys, RawResponseEnvelopeV1, atomic same-directory
  replace, quarantine, reclaim, and Clock/FileSystemSeam/RandomSource
  (issue #10 sections 6-18).
- apps/tui: composition root that resolves settings (SettingsResolver over
  the platform primitives; CLI > env > config file > default per setting),
  constructs the cache store, parses the issue #12 option grammar for the
  maintenance surface, and runs `config show`, `cache list`,
  `cache show <digest>`, and `cache clear`.
- apps/tui: `--help`, `--version`, global options `--json`, `--debug`,
  `--offline`, `--cache-dir`, `--no-color`, `--color`; JSON and human
  documents for cache/config per issue #12 sections 8.4-8.5 and 10.4.
- Single version stamp constant used by `--version`; distribution tooling
  replaces its value in ticket #20.

Packages and files to add
- deno.json (workspace + tasks), deno.lock
- packages/core/deno.json (skeleton member; no production logic yet)
- packages/providers/deno.json
- packages/providers/src/platform/{locator,env,paths}.ts
- packages/providers/src/cache/{store,key,envelope,file-entry-store,clock,
  fs-seam,random}.ts
- apps/tui/deno.json
- apps/tui/src/main.ts
- apps/tui/src/cli/{args,help,usage}.ts
- apps/tui/src/settings/resolver.ts
- apps/tui/src/json/{serialize,doc-builders}.ts
- apps/tui/src/version.ts
- fixtures/ (root directory scaffolding only)
- README.md "Development" section update to the real task list

Interfaces consumed
- docs/architecture.md (cache, configuration, permissions, CLI/process
  contract)
- docs/research/deno-persistence-and-permissions.md decisions D1-D9
- docs/design/cache-and-config.md sections 5-21
- docs/design/cli-json-contract.md sections 3, 6, 7, 8.4, 8.5, 9.5, 9.6

Tests, fixtures, manual evidence
- The issue #10 fixture matrix rows that need no provider decoder or live
  source: default roots, cache override, precedence/origins, unsupported
  environment, directory security, key identity, envelope round-trip,
  freshness classes, stale positive offline/online, stale negative,
  atomic replacement, crash simulation, Windows rename contention,
  cross-process races, corruption recovery, envelope-level decoder
  evolution, inspect/clear, env allowlist, least privilege.
- CLI contract-table rows that concern the maintenance surface and global
  options: X1-X5, X8, X15-X17, X22-X24, X26; cache C1-C9; config G1-G6.
  No-command TTY behavior (X6/X7 TTY branches) is deferred to ticket #19
  and is never claimed here.
- Deterministic env fixture runs (Windows and simulated POSIX roots).

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno run apps/tui/src/main.ts --version
deno run apps/tui/src/main.ts config show --json

Completion gate
- fmt/lint/check/test pass from a clean tree.
- The listed issue #10 and CLI fixture assertions pass on this platform.
- `config show`, `cache list/show/clear`, `--help`, and `--version`
  produce the issue #12 documents and exit codes (0, 2, 130) on stderr/
  stdout as specified.
- `git diff --check` is clean; no `-A` appears in any task or manifest.

Deliberately deferred
- Every lookup command, the session coordinator, and the full-screen TUI.
- Provider runtime, HTTP, and source adapters (tickets #17-#18).
- Release stamp tooling and compile/npm packaging (ticket #20).
```

---

### 6.2 Ticket #16 — Catalog module, evidence reconciliation, coordinator, fixture-backed CLI

Issue body:

```text
Title: Implement the catalog module, evidence reconciliation, session
coordinator, and fixture-backed CLI contract

Type: task
Labels: type: task

Blocked by: #15

Prerequisites
- #15 provides the workspace, settings, cache, and option grammar.
- Closed issues #6, #7, #12, and #13 supply the frozen contracts this
  ticket implements.

Goal
Make `book-title search|resolve|titles` runnable end-to-end against the
module-level fake over fixed acceptance-corpus fixtures, with the final
JSON documents, human text, and exit codes frozen by issue #12, and with
the pure domain, reconciliation, and coordinator behavior covered by the
issue #7/#12/#13 test tables.

Deliverable / capability
- packages/core owns the domain model and the BookTitleCatalog application
  seam exactly as issue #6 specifies, including the opaque-ref lifecycle,
  outcome unions, SourceWarning/SourceFailure codes, and the internal
  evidence port type that Providers implements later.
- packages/core implements the deterministic reconciliation pipeline of
  issue #7: normalization, language matching, candidate assembly and order,
  direct/indirect resolution rules, in-scope Edition logic, accepted
  attestation extraction, evidence-level predicates, Title Groups, per
  language recommendation, and conflict warnings.
- apps/tui owns the session coordinator of issue #13: SessionState,
  Message, Effect types; the pure reducer; the effect runner with injected
  RequestIdSource and real AbortController ownership; directed CLI sessions
  for search/resolve/titles (goal `lookup` for search/titles, goal
  `resolve` for resolve).
- apps/tui owns the CLI driver: option grammar for the three lookup
  commands, stdout/stderr separation, JSON document builders, human text
  rendering, and exit-code mapping per issue #12 sections 6 and 8-10.
- FakeBookTitleCatalog (issue #6 fake seam) over the acceptance corpus.
- The machine-validatable cli-json.v1 JSON Schema bundle and document
  snapshots from issue #12.
- Shared fixtures under fixtures/acceptance-corpus and fixtures/cli-json.

Packages and files to add
- packages/core/src/{domain,module,evidence,reconcile,normalize,group,
  recommend,internal-port} modules with tests beside them
- packages/core/src/catalog/module.ts (illustrative placement per issue #6)
- apps/tui/src/coordinator/{state,messages,effects,reducer,runner,
  projections}.ts
- apps/tui/src/cli/{lookup-commands,directed-session,human,json}.ts
- apps/tui/testdata or fixtures/cli-json snapshots
- fixtures/acceptance-corpus/* per issue #7 section 17

Interfaces consumed
- docs/design/catalog-module-interface.md (issue #6)
- docs/design/evidence-reconciliation.md (issue #7)
- docs/design/cli-json-contract.md (issue #12)
- docs/design/application-state-and-effects.md (issue #13)
- CONTEXT.md and docs/product-spec.md for vocabulary and outcomes

Tests, fixtures, manual evidence
- Issue #7 normalization/property/grouping/recommendation invariants and
  the acceptance-corpus fixture table (section 17).
- Issue #6 envelope contract suite against FakeBookTitleCatalog: status
  unions, readonly results, opaque-ref scoping, cancellation resolves
  cancelled, partial success carries warnings, no opaque ref leaks.
- Issue #13 reducer and effect-runner tables 14.1-14.3 (R1-R17, C1-C14,
  L1-L5) with injected ids and scripted module outcomes.
- Issue #12 contract tables 9.2-9.4 (search S1-S10, resolve R1-R10,
  titles T1-T10) and the cross-cutting rows X1-X5, X8-X27 that do not need
  a TTY or a real source; byte-exact JSON snapshots for ordering rows.
- JSON documents validate against the cli-json.v1 schema bundle.

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno run apps/tui/src/main.ts search --title <fixture> --json
deno run apps/tui/src/main.ts resolve --reference <fixture-ref> --json
deno run apps/tui/src/main.ts titles --reference <fixture-ref> --language es --json

Completion gate
- All issue #7/#12/#13 rows listed above pass; every JSON document
  validates against the schema bundle and snapshots byte-identically.
- Core imports no terminal, fetch, environment, or Providers code; reducer
  purity and no-leak assertions hold.
- The three lookup commands run headlessly against fixtures with the frozen
  exit codes (0, 2, 3, 4, 5, 10, 130).
- fmt/lint/check/test and git diff --check are clean.

Deliberately deferred
- Real HTTP, provider runtime, cache integration, and source adapters
  (tickets #17-#18).
- Full-screen TUI rendering and interactive mode selection (ticket #19).
- Compiled artifacts and npm packaging (ticket #20).
```

---

### 6.3 Ticket #17 — Provider runtime and the Open Library vertical slice

Issue body:

```text
Title: Implement the provider runtime and the Open Library vertical slice

Type: task
Labels: type: task

Blocked by: #16

Prerequisites
- #15 provides the cache store and platform seams; #16 provides Core port
  types and the CLI surface.
- Closed issues #1 and #8 and research #1 supply the Open Library evidence
  and runtime contracts.

Goal
Make the fixture-backed CLI from ticket #16 run through the real catalog
service composed from the Open Library adapter, so the deep runtime, HTTP
cache integration, redirect handling, retry/deadline/cancellation policy,
and OL decoding are proven behind the module seam before Wikidata is added.

Deliverable / capability
- packages/providers implements the deep ProviderRuntime (issue #8): typed
  request plans, host allowlisting, per-source concurrency/spacing, bounded
  retry with jitter and Retry-After, per-source budgets, redirect
  resolution with requested/final URLs, transport failure classification,
  and injectable RuntimeEffects (now/random/delay).
- The runtime performs cache read-through/write-through over the
  ResponseCache port from ticket #15 with the issue #10 freshness classes,
  negative marking, stale/offline labeling, and decoder-schema-version
  enforcement.
- packages/providers/openlibrary implements the OL workflows from research
  #1: fielded /search.json candidate discovery, ISBN resolution through
  302s, Work/Edition reads with /type/redirect detection, paged
  /works/{key}/editions.json expansion, tolerant endpoint decoders over
  `unknown` (content-type gate, strict UTF-8, required key/type
  invariants).
- packages/providers/federated implements the internal evidence port that
  Core owns, composing the single Open Library source into the catalog
  operations search/resolve/findTitles with outcome-union semantics.
- apps/tui composition root constructs the real catalog service and wires
  it as the default for source runs while tests keep using the fake.
- Raw HTTP fixture envelopes for Open Library under
  fixtures/providers/openlibrary per research #1 fixture guidance 1-9.

Packages and files to add
- packages/providers/src/runtime/{types,runtime,schedule,budget,backoff,
  redirect,cache-key}.ts
- packages/providers/src/decode/{json,struct}.ts
- packages/providers/src/cache glue (store consumption used by runtime)
- packages/providers/src/openlibrary/{client,workflows,decoders}.ts
- packages/providers/src/federated/composition.ts
- apps/tui composition-root wiring and a seam-test harness
- fixtures/providers/openlibrary/*

Interfaces consumed
- docs/design/provider-runtime.md (issue #8)
- docs/design/catalog-module-interface.md (issue #6)
- docs/research/open-library-evidence-surface.md (issue #1)
- docs/design/cache-and-config.md (issue #10)
- docs/product-spec.md source-availability and contract-test rules

Tests, fixtures, manual evidence
- Issue #8 deterministic runtime harness: HTTP contract fixtures (200
  search, zero-result, JSON 404, HTML 404 ISBN, 422, 302 ISBN, merged-key
  redirect, paginated editions, extra fields, 429 Retry-After, retryable
  5xx), transport fixtures (malformed JSON, invalid UTF-8, off-allowlist
  redirect, redirect loop, network error), and policy assertions (retry
  counts, Retry-After, budget exhaustion, cancellation, concurrency,
  spacing, cache-write eligibility).
- Issue #10 cache contract tests exercised through the runtime: fresh hit
  does not fetch; stale only with offline allowance and labeled; corrupt
  and decoder-version mismatch quarantine and refetch; cache identity
  differs per meaning-changing parameter.
- Issue #6 envelope contract suite against the real OL-composed service.
- CLI integration rows S1-S10, R1-R10, T1-T10 against the real fixture
  composition (no live network), plus X17/X19/X27.
- Decoder invariants from issue #8 section 6 and research #1.

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno run apps/tui/src/main.ts search --title <fixture-ol> --json

Completion gate
- Runtime, OL contract, and CLI fixture rows above pass; envelope suite
  passes against the real service.
- No live Open Library traffic is required by routine tests.
- Raw upstream JSON never crosses into Core; typed outcomes only.
- fmt/lint/check/test and git diff --check are clean; no regression in
  ticket #15/#16 surfaces.

Deliberately deferred
- Wikidata adapter and two-source composition (ticket #18).
- Live smoke suite (opened in ticket #18 so both sources share it).
- Full-screen TUI (ticket #19) and distribution (ticket #20).
```

---

### 6.4 Ticket #18 — Wikidata adapter and two-source provider composition

Issue body:

```text
Title: Implement the Wikidata adapter and two-source provider composition

Type: task
Labels: type: task

Blocked by: #17

Prerequisites
- #17 provides the runtime and cache-integrated OL path.
- Closed issues #2 and #7 and research #2 supply the Wikidata pipeline and
  the reconciliation rules this ticket extends.

Goal
Add Wikidata evidence behind the same module seam so lookups compose Open
Library and Wikidata with per-source deadlines, partial-failure warnings,
offline/stale behavior, and the fixed low-complexity SPARQL fallbacks, and
so the product acceptance corpus can be exercised against both sources.

Deliverable / capability
- packages/providers/wikidata implements the research #2 pipeline:
  wbsearchentities discovery (zh with zh-hant retry), batch wbgetentities /
  EntityData entity reads, Work/Edition/Other classification from P31,
  fixed ID-bound SPARQL shapes 2-4 on WDQS with P747/entity-read fallback,
  ISBN lookup via shape 3 or CirrusSearch haswbstatement, redirect
  preservation, and P1476/P1680/P407/rank/reference-aware attestation
  extraction.
- Decoders preserve claims, ranks, qualifiers, references, labels, and
  language tags; labels/aliases/descriptions/sitelinks are never
  attestations (research #2 mapping table).
- packages/providers/federated grows to two sources: fan-out, per-source
  budgets, partial-failure aggregation, deterministic ordering, and
  cross-source identity mapping via P648 (issue #7 section 6.2).
- Offline mode reconstructs cached title groups and labels stale entries
  through the ticket #15/#17 seams.
- Raw Wikidata HTTP fixtures under fixtures/providers/wikidata per research
  #2 F1-F7 plus SPARQL JSON rows and a 429 Retry-After response.
- The opt-in low-volume live smoke suite for Open Library and Wikidata
  (product gate G8), serialized with the identified User-Agent and current-
  date assertions.

Packages and files to add
- packages/providers/src/wikidata/{client,workflows,decoders,sparql}.ts
- packages/providers/src/federated/ (two-source composition extension)
- fixtures/providers/wikidata/*
- packages/providers live-smoke entry and task (opt-in, not routine)

Interfaces consumed
- docs/research/wikidata-retrieval-strategy.md (issue #2)
- docs/design/provider-runtime.md (issue #8)
- docs/design/evidence-reconciliation.md (issue #7) sections 6-8, 10, 14
- docs/design/cache-and-config.md (issue #10)
- docs/product-spec.md source availability, partial results, G8

Tests, fixtures, manual evidence
- Wikidata contract fixtures F1-F7 and SPARQL shapes; rank/qualifier/
  reference preservation; label-only Edition (F3) produces no attestation;
  deprecated identifier pair (F6) produces a warning.
- Two-source composition: partial source outage keeps successful evidence
  plus warnings and never degrades to failed; no-record from one source is
  not a global no-result; WDQS failure falls back to P747/entity reads.
- Envelope suite against the two-source service.
- Acceptance-corpus rows from issue #7 section 17 that exercise Wikidata
  evidence (for example Q178869/Q25338/Q751348/Q151919 scenarios).
- CLI rows S4, R2/R6, T1-T5 across both sources where fixtures define them.
- Low-volume live smoke suite for both sources run opt-in.

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno task test:live-smoke   # opt-in; not part of routine checks

Completion gate
- All Wikidata fixture, composition, envelope, and CLI rows above pass.
- A one-source outage on a fixed partial-outage fixture returns partial
  results with warnings and the correct status/exit code.
- The live smoke suite passes at low volume against both sources with an
  identified User-Agent (coordinator-authorized run; never routine CI).
- fmt/lint/check/test and git diff --check are clean.

Deliberately deferred
- Full-screen TUI (ticket #19).
- Distribution and compiled artifacts (ticket #20).
- Registry publication (separate explicit approval).
```

---

### 6.5 Ticket #19 — Interactive coordinator session, thin-renderer TUI, spike retirement

Issue body:

```text
Title: Implement the thin-renderer TUI and interactive session; retire the
TUI spike

Type: task
Labels: type: task

Blocked by: #18

Prerequisites
- #16 provides the reducer and CLI directed sessions; #18 provides the
  two-source composition root.
- Closed issues #9 and #13 and the spikes/tui evidence supply the renderer
  and coordinator contracts.

Goal
Let `book-title` with no command in a TTY (and no `--json`) run the full-
screen workflow from the product spec through the issue #13 coordinator and
the issue #9 thin renderer, and cleanly retire the disposable spike.

Deliverable / capability
- apps/tui implements the interactive transitions already specified by the
  issue #13 reducer (query, searching, candidates, resolving, resolved,
  titles_loading, titles, group_detail), the effect runner, and the notice
  vocabulary; CLI directed sessions continue to share the same reducer.
- apps/tui/tui owns the thin renderer: frame rendering to memory and ANSI
  to Deno.stdout, alternate screen, cursor, clear/reset, and the issue #9
  grapheme-aware width logic.
- apps/tui/tui owns the input decoder from raw stdin bytes to the issue #9
  token vocabulary, then to coordinator messages.
- The TUI driver performs mode selection (issue #12 section 3.1 and issue
  #13 section 13): no-command TTY no `--json` starts the TUI; every other
  no-command invocation exits 2 with no stdout; explicit commands never
  acquire the terminal.
- Terminal acquire/restore ownership lives only in the driver: raw input,
  echo, alternate screen, cursor, idempotent finally-restore, SIGINT/
  SIGTERM as `interrupt` (exit 130), resize handling with the 60x16
  minimum message.
- Promotion rules for the spike (see below) are applied and then
  spikes/tui is deleted in this ticket's PR.

Packages and files to add
- apps/tui/src/tui/{driver,terminal,input-decoder,render,width,ansi}.ts
- apps/tui/src/tui/*_test.ts (memory-backed render, synthetic byte input,
  width corpus, acquire/release ordering)
- apps/tui/src/tui/manual-gates.md (Windows Terminal release checklist
  from issue #9 section 4/research #3 section 10.2)
- Deletion: spikes/tui/** (git history retains the evidence)

Interfaces consumed
- docs/design/application-state-and-effects.md (issue #13) sections 5-15
- docs/design/tui-rendering-strategy.md (issue #9)
- docs/design/cli-json-contract.md (issue #12) sections 3.1 and 6
- docs/research/deno-tui-candidates.md (issue #3) width corpus and
  acceptance checks
- docs/product-spec.md TUI workflow and G4/G7

Tests, fixtures, manual evidence
- Reducer/effect-runner tables already implemented in ticket #16 plus any
  interactive-only transitions; TUI driver tests assert acquire/restore
  ordering with injected stream doubles.
- Promote spike evidence into production tests: width corpus expectations,
  byte-stream decoder regressions (text-only chunk flush, trailing ESC/CSI
  buffering), memory-backed render snapshots, alternate-screen string
  lifecycle, and the pure-reducer driving rule.
- Mode-selection rows X6/X7 of issue #12 complete at last.
- TUI state tests cover navigation, cancellation, stale responses, and
  partial failure (product gate G4).
- Manual Windows Terminal release gate (product gate G7): Chinese IME
  composition/deletion/cursor movement, wide-character rendering at 60x16
  and 120x40, resize through 40x10, alternate-screen entry/restore,
  restoration after Ctrl+C and an uncaught error. The checklist is
  executed and recorded by the human coordinator; it cannot be automated.

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno run apps/tui/src/main.ts          # from Windows Terminal (manual)

Completion gate
- All automated TUI/driver/CLI rows pass; the manual checklist is recorded
  with named pass/fail results for IME, resize, and restoration.
- spikes/tui is removed from the tree; no production module imports it.
- fmt/lint/check/test and git diff --check are clean.

Deliberately deferred
- Compiled artifacts and npm distribution (ticket #20).
- Registry publication (separate explicit approval).
- Interface locales beyond English and any feature in the product non-goals.
```

Spike cleanup and promotion rules (normative for ticket #19):

- Promote only evidence into production: the grapheme width corpus and its
  expected widths, the byte-stream decoder regression cases, the memory-
  backed render/kernel test pattern, and the manual Windows Terminal gate
  checklist. These move as new production tests and docs, never as imports
  from `spikes/tui`.
- The spike binaries' non-interactive guard-exit-0 behavior is not
  promoted; issue #13 section 13.1 freezes the production mode-selection
  contract instead.
- `spikes/tui` is removed once promotion is committed. Git history remains
  the provenance record; no runtime or CI task references the directory
  after removal.

---

### 6.6 Ticket #20 — Compile and npm launcher distribution gates

Issue body:

```text
Title: Implement compile and npm-launcher distribution gates (no publish)

Type: task
Labels: type: task

Blocked by: #19

Prerequisites
- #19 completes the application that #20 packages.
- Closed issues #4 and #11, ADR 0003, and research #4/#5 (D7/D9) supply
  the topology, launcher, manifest, and permission contracts.

Goal
Produce the release-shaped artifacts and gates from issue #11 without any
publishing capability: four `deno compile` binaries, npm launcher and
platform package trees, launcher contract tests, tarball inspection, the
artifact manifest, and a Windows binary build/run proof.

Deliverable / capability
- distribution/scripts: single-version-stamp tooling, compile scripts for
  the frozen target matrix, npm pack/publish-dry-run inspection, artifact
  manifest generation and validation (issue #11 section 7).
- distribution/npm/launcher: the frozen `book-title-lookup` launcher
  package tree with bin/book-title.js (Node >= 18 floor, fixed platform
  table, require-based resolution, stdio inherit, signal forwarding,
  exit-code passthrough, reserved launcher exit 70, actionable fallback).
- distribution/npm/platform-package: the frozen platform package template
  for win32-x64, linux-x64 (glibc), darwin-x64, darwin-arm64 with the
  trivial CommonJS path export and no bin entry.
- CI workflow templates (.github/workflows) for workspace verification,
  the four-target compile matrix, native smoke on matching runners, launcher
  contract tests with stub platform packages, and post-build verification.
  A protected publish workflow is not added; publishing stays out of every
  normal build.
- Windows x64 native binary built and run locally (product gate G10).

Packages and files to add
- distribution/scripts/{version,compile,pack,manifest,verify}.ts
- distribution/npm/launcher/{package.json,bin/book-title.js}
- distribution/npm/platform-package/{package.json,index.js,bin/}
- fixtures/npm/ stub binaries for launcher contract tests
- .github/workflows/{build,verify}.yml templates
- README/development notes for the release stamp and dry-run commands

Interfaces consumed
- docs/design/npm-release-topology.md (issue #11) sections 1-12
- docs/research/npm-binary-distribution.md (issue #4)
- docs/adr/0003-distribute-deno-binaries-through-npm.md
- docs/architecture.md Distribution, Permissions, Testing
- docs/research/deno-persistence-and-permissions.md D7/D9 and issue #10
  section 17 (compile-time permissions)

Tests, fixtures, manual evidence
- Issue #11 gates: dry-run/tarball inspection per package (file lists,
  executable bits, shebang, no lockfiles/cache/secrets), launcher contract
  tests with stub binaries (args, stdout/stderr, synthetic exit code,
  omitted-optional and unsupported-platform fallback with code 70), native
  smoke matrix, artifact-manifest completeness and integrity.
- Windows binary smoke: the compiled win32-x64 binary starts and honors the
  documented no-command/--version behavior.
- Product gates G6, G10, G11. Manual Windows Terminal/signal checks remain
  recorded by the coordinator (shared checklist with ticket #19).
- Publishing is never exercised: there is no npm token, no OIDC publish
  workflow, and no code path that calls npm publish.

Commands
deno task fmt:check
deno task lint
deno task check
deno task test
deno run distribution/scripts/compile.ts --target x86_64-pc-windows-msvc
deno run distribution/scripts/pack.ts --dry-run
deno run distribution/scripts/verify.ts

Completion gate
- All four target builds succeed or are produced on their native CI
  runners; every produced binary passes native smoke on a matching runner.
- Launcher contract and tarball gates pass; the artifact manifest is
  complete and internally consistent.
- The Windows binary is built and runs (G10); dry-run and tarball
  inspection pass (G11); launcher tests pass (G6).
- fmt/lint/check/test and git diff --check are clean.
- No publish was performed and no publish path exists.

Deliberately deferred
- Actual registry publication, provenance issuance, and GitHub Release
  asset upload (separate explicit human approval).
- musl Linux, linux-arm64, and other non-MVP targets (issue #11 section 4).
```

## 7. Dependency graph and PR merge order

| Order | Ticket | Blocked by | Merges after |
| --- | --- | --- | --- |
| 1 | #15 Workspace scaffold + config/cache + maintenance CLI | none | — |
| 2 | #16 Catalog module + reconciliation + coordinator + fixture CLI | #15 | #15 |
| 3 | #17 Provider runtime + Open Library vertical slice | #16 | #16 |
| 4 | #18 Wikidata adapter + two-source composition | #17 | #17 |
| 5 | #19 Thin-renderer TUI + spike retirement | #18 | #18 |
| 6 | #20 Compile + npm launcher distribution gates | #19 | #19 |

Integration rule: each ticket is implemented on an isolated branch and
merged as a pull request that closes its issue (issue-tracker lifecycle).
Merge order is strictly the table order above. #19 does not require #18's
source-specific code to develop (it consumes the module seam), so #18 and
#19 may be built in parallel worktrees; they still merge serially in table
order so the composition root with both sources lands before the TUI's
partial-failure presentation is claimed complete.

Dependency review:

- #15 depends on no build ticket; it implements seams frozen by closed
  issues #5 and #10.
- #16 depends only on #15's scaffolding; it consumes frozen contracts #6,
  #7, #12, #13 and needs no Providers code.
- #17 depends on #16's Core port types and #15's cache seams; it consumes
  #1 and #8.
- #18 depends on #17's runtime; it consumes #2 and the #7/#8 semantics
  already implemented.
- #19 depends on #18 for the full two-source composition root; it consumes
  #9 and the #13/#12 behavior from #16.
- #20 depends on #19's complete application; it consumes #4, #11, ADR 0003,
  and #5 D7/D9.

No ticket consumes a design whose issue is still open; all inputs #1–#13 are
closed.

## 8. Completion-gate ledger

Each product completion gate is owned by at least one ticket. The ledger is
the acceptance map for the whole frontier.

| Product gate | First satisfied by | Final proof point |
| --- | --- | --- |
| G1 format/lint/type/tests | #15 | every ticket keeps it green; #20 runs the full tree |
| G2 domain/reconciliation unit tests | #16 | issue #7 invariant and corpus tables |
| G3 provider fixture-backed contract tests | #17 (OL) / #18 (WD) | issue #8 harness + research #1/#2 fixtures |
| G4 TUI state tests | #16 (reducer) / #19 (driver) | issue #13 tables + driver acquire/restore tests |
| G5 CLI stdout/stderr/JSON/exit | #16 (lookup) / #15 (maintenance) | issue #12 tables X/S/R/T/C/G |
| G6 npm launcher tests | #20 | issue #11 launcher contract gates |
| G7 Windows Terminal manual checks | #19 (TUI) / #20 (launcher) | coordinator records the checklist |
| G8 low-volume live smoke OL + WD | #18 | opt-in smoke suite passes |
| G9 acceptance corpus manually exercised | #16/#18 automate fixtures; human review before MVP release | coordinator records corpus results |
| G10 Windows binary built and run | #20 | local win32-x64 smoke run |
| G11 npm dry-run and tarball inspection | #20 | issue #11 section 11 gates |

Issue #11's implementation-phase validation gates (all four targets build
and smoke, glibc host requirements documented, provenance presence — for the
later authorized publish — launcher floor and signals) are owned by #20,
except the Windows Terminal and signal acceptance items, which share the #19
manual checklist.

## 9. Risks and follow-ups

1. **Ticket size.** #16 and #19 are intentionally large because they each
   close one vertical capability. If a ticket grows past reviewability, the
   implementing worker may split its work into reviewable commits on one
   branch; the slice boundary must not change.
2. **Manual gates are not automation.** G7, parts of G8/G9/G10, and the
   issue #11 signal checklist require a human coordinator on Windows
   Terminal. The plan never claims them as CI-passing gates.
3. **Deno workspace mechanics.** The repo has no workspace members yet;
   ticket #15 validates the exact Deno 2.9 workspace/import/task wiring and
   commits a lockfile. Residual uncertainty is bounded to scaffolding, not
   to any frozen contract.
4. **CI does not exist yet.** Tickets up to #18 run locally; #20 introduces
   GitHub Actions workflow templates. Cross-platform native smoke (Linux/
   macOS runners) depends on hosted runners being available to the
   coordinator.
5. **Publishing stays out of scope.** Provenance, registry credentials, and
   GitHub Release uploads are deliberately not implemented; issue #11
   recovery and no-rollback rules are activated only when a separate
   approval authorizes publication.
6. **Live records change.** All live-catalog numbers in the fixtures are
   dated snapshots (2026-09-05); no routine test asserts live state, and the
   live smoke suite re-validates etiquette and recall at low volume.
7. **Follow-up artifacts.** After #14 closes, the coordinator opens #15–#20,
   replaces the illustrative numbers in any `Blocked by:` text if the real
   numbers differ, labels each `type: task`, and records this plan's
   resolution in issue #14.

## 10. References

Authoritative inputs are listed in Section 2. This plan adds one repository
artifact: this document. No `.scratch` file and no GitHub issue is modified
by issue #14's resolution.
