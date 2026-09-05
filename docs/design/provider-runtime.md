# Provider Runtime Design

Decision deliverable for [issue #8 — Choose provider decoding and HTTP
seams](https://github.com/FilthyS/book-title-lookup/issues/8).

Status: decision for the planning phase. This document specifies the runtime
seams that `packages/providers` exposes internally and how Open Library and
Wikidata use them. It contains design sketches only: no production code and no
`.scratch` content is part of this decision.

Inputs:

- `docs/architecture.md` — system shape, provider boundary, source request
  policy, cache policy, permissions.
- `docs/product-spec.md` — source availability, retry bounds, cache freshness,
  partial-result semantics, provider contract tests.
- Research from closed blockers #1 (Open Library evidence surface), #2
  (Wikidata retrieval strategy), and #5 (Deno persistence and permissions),
  including decision D8, which authorizes issue #8 to consume the file-entry
  store contract from sections 3.4–3.8 and 3.11 of the #5 report.
- `docs/data-sources.md` and the accepted ADRs for the non-goal "public
  provider plugin API" and the no-backend system shape.

## Question

Which runtime-validation, HTTP, rate-limit, retry, time, and cancellation seams
should Providers expose internally, which third-party dependencies earn their
cost, and which behavior belongs behind one deep module rather than a chain of
shallow wrappers?

## Decisions

1. **One deep transport module owns every cross-cutting HTTP concern.**
   `packages/providers` implements a single `ProviderRuntime` that executes
   typed request plans and owns HTTP execution, redirect resolution, host
   allowlisting, per-source rate limiting and concurrency, bounded retry with
   jitter, `Retry-After`, per-source deadline budgeting, caller-cancellation
   propagation, raw-response capture, cache consultation and write-through, and
   transport failure classification. Providers never wrap that module in
   per-stage decorators (`HttpClient` → `RetryClient` → `RateLimitedClient` →
   `CacheClient`) and never re-implement a shared invariant per source.

2. **No third-party runtime dependency is justified for the provider runtime
   or its decoders in the MVP.** Deno's built-in `fetch`, `URL`,
   `URLSearchParams`, `TextDecoder`, `AbortSignal`, and web streams supply the
   transport surface. Decoders are small, per-endpoint, hand-written structural
   validators over `unknown`; a schema or validation library is not adopted.

3. **Decoding is a tolerant boundary seam, not a shared "model" layer.** Each
   endpoint declares a typed decoder. Decoders require only the identity and
   type invariants an endpoint must satisfy, ignore unknown fields, preserve
   unknown-but-relevant upstream facts as warnings where the product requires
   provenance, and never let raw upstream JSON cross into Core.

4. **Time and randomness are injected effects, not globals.** The runtime
   depends on a narrow `RuntimeEffects` seam (`now`, `random`, and an
   abortable `delay`) so every budget, backoff, retry, and rate-spacing policy
   is deterministic under test. Production defaults use `Date.now`,
   `Math.random`, and a `setTimeout`-based sleep; tests inject fakes and never
   rely on real timers.

5. **Caching is a transport read-through/write-through seam over an opaque
   store.** The runtime owns *when and what* to cache and how a request
   identity is derived; the `CacheStore` port owns *how* entries persist.
   Entry layout, atomic write, concurrency, corruption quarantine, and the
   stale/offline rules follow decision D8 of the #5 report. Cache TTL metadata
   follows `docs/product-spec.md` and `docs/architecture.md`; the physical
   file store, directory locator, and user-visible cache configuration belong
   to issue #10.

6. **Expected conditions are discriminated outcomes at every seam.** The
   runtime, source clients, and workflows return typed outcomes
   (`ok`, `no_record`, `source_failure`, `cancelled`, and source-warning
   detail). Exceptions are reserved for programming errors and violated
   invariants. Provider behavior maps directly onto the product's partial /
   failed / cancelled source states without inventing book outcomes.

7. **Source differences are data and plan differences, not code forks.** A
   runtime configuration table (hosts, spacing, concurrency, retries,
   redirect cap) plus per-request plans express the difference between Open
   Library and Wikidata. Each source additionally owns its endpoint workflows
   (search, read, expand, identifier resolution) as a narrow internal module.

8. **There is no public provider plugin abstraction.** Everything below the
   Core-facing catalog surface (owned by issue #6) is private to
   `packages/providers`. This document fixes internal seams only; it adds no
   public types, hooks, or configuration surface for third-party providers.

## Why one deep module instead of shallow wrappers

The invariants this module owns interact at the *request* level:

- A fresh cache hit must skip the network, a rate-limit slot, and a retry
  attempt.
- A 429 must suppress the generic retry backoff and instead honor
  `Retry-After`, but only if the remaining source budget can afford the wait.
- A redirect hop must consume a rate-limit slot and re-check the host
  allowlist, yet never be retried like a failed attempt.
- Cancellation must abort a rate-limit queue wait, a backoff sleep, and an
  in-flight fetch with one signal, and must prevent a cache write.
- A 5xx-after-retries and a decode failure must never be cached, while a
  structured 404 may be cached as a negative result.

A decorator chain splits these decisions across layers that cannot see one
another: a retry wrapper cannot know the remaining budget, a cache wrapper
cannot know not to cache a 429, and a rate wrapper cannot see redirect hops.
The single deep module keeps the ordering explicit and testable in one place.
It is not a god module: pure helpers for backoff math, cache identity, budget
accounting, and redirect validation stay as small, separately unit-testable
functions; decoders, request builders, and source workflows live outside the
transport and pass plans and decode functions *into* it.

## Package shape inside Providers

```text
packages/providers
├── runtime/                 # the deep module (Decision 1)
│   ├── types.ts             # request plans, envelopes, outcomes
│   ├── runtime.ts           # ProviderRuntime: execute(plan) orchestration
│   ├── schedule.ts          # concurrency slot + spacing queue
│   ├── budget.ts            # per-source deadline accounting (pure)
│   ├── backoff.ts           # retry decision + jitter math (pure)
│   ├── redirect.ts          # bounded allowlisted redirect follow (pure)
│   └── cache-key.ts         # normalized request identity (pure)
├── cache/                   # CacheStore port + file-entry store (D8, #10)
│   ├── store.ts             # opaque read/write/delete/quarantine port
│   └── file-entry-store.ts  # implementation per issue #5 sections 3.4–3.8
├── decode/                  # decoder primitives shared by source decoders
│   ├── json.ts              # strict-UTF-8 parse, content-type gate
│   └── struct.ts            # small field validators (string?, array, enum)
├── openlibrary/             # OL client + workflows + endpoint decoders
├── wikidata/                # WD client + workflows + endpoint decoders
└── federated/               # composition over sources (catalog surface #6)
```

The boundary that matters to the rest of the application is still the
Core-facing catalog surface from `docs/architecture.md` and issue #6. The
runtime, source clients, and workflows in this diagram are private.

## Seams

### 1. Runtime effects: clock, randomness, and delay

```ts
// runtime/types.ts (conceptual sketch, refined test-first)
interface RuntimeEffects {
  /** Epoch milliseconds. Drives budgets, Retry-After, and freshness. */
  readonly now: () => number;
  /** Uniform [0, 1). Drives retry jitter and spacing decisions. */
  readonly random: () => number;
  /** Sleep that aborts promptly when the signal fires. */
  readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;
}
```

Production effects use `Date.now`, `Math.random`, and a `setTimeout`-based
sleep that registers an abort listener. Core never sees this seam; only the
provider runtime and its contract tests construct or fake it.

### 2. HTTP request plans

Source clients never call `fetch` directly. They build a typed plan and hand
it to the runtime:

```ts
type CacheClass = "search" | "detail"; // negative results shorten the TTL

interface RequestPlan<D> {
  readonly method: "GET";              // MVP transport is GET-only
  readonly url: string;                // fully resolved, encoded URL
  readonly headers?: Readonly<Record<string, string>>;
  readonly cacheClass?: CacheClass;    // absent => never cache
  readonly decoder: (envelope: ResponseEnvelope) => DecodeResult<D>;
}
```

`cacheClass` is declared by the *request*, not sniffed from the body. The
freshness metadata (search 24 h, detail 7 d, negative 1 h) is attached by the
store (#10); the runtime only marks which class applies and whether the
response turned out negative so the store can apply the shorter negative TTL.

`url` is the fully normalized request URL. It is the cache identity, so it
must include every parameter that changes the meaning of the response:
`fields`, `limit`, `offset`/`page`, `language` filters, format, and
continuation state. Request builders produce the URL once; `URLSearchParams`
encoding is done at build time so the same string is used for the cache key
and the wire.

### 3. Execution orchestration

```ts
interface RuntimeConfig {
  readonly userAgent: string;
  readonly hosts: readonly string[];      // exact allowlist
  readonly maxConcurrent: number;         // default 2
  readonly minSpacingMs: number;          // per-source default (policy table)
  readonly maxRetries: number;            // default 2 additional attempts
  readonly baseBackoffMs: number;         // default 200
  readonly maxBackoffMs: number;          // default 2_000
  readonly sourceBudgetMs: number;        // default 8_000
  readonly maxRedirects: number;          // default 5
  readonly fetch: typeof fetch;           // injectable, defaults to globalThis.fetch
}

type RunOutcome<D> =
  | { readonly kind: "ok"; readonly data: D; readonly meta: ResponseMeta }
  | { readonly kind: "no_record"; readonly meta: ResponseMeta }
  | { readonly kind: "source_failure"; readonly failure: SourceFailure }
  | { readonly kind: "cancelled" };

interface ResponseMeta {
  readonly requestedUrl: string;          // the URL that was asked for
  readonly finalUrl: string;              // after redirect resolution
  readonly status: number;
  readonly contentType: string | null;
  readonly fetchedAtMs: number;
  readonly servedFromCache: boolean;
  readonly stale: boolean;
  readonly warnings: readonly SourceWarning[];
}
```

Request lifecycle for one plan:

1. **Budget check** — if the operation's source budget is exhausted, return a
   `timeout` source failure without starting a fetch.
2. **Cache lookup** — for cacheable plans, ask the store for the request
   identity. A fresh hit returns immediately as `ok`/`no_record` with
   `servedFromCache: true`. A stale hit is used only when the caller allows
   stale/offline reads (policy owned with #10); it is returned with
   `stale: true`. A corrupt or decoder-version-mismatched entry is quarantined
   as a miss (D5).
3. **Schedule** — wait for a concurrency slot and the per-source minimum
   spacing, abortably. If the signal fires or the budget expires while
   waiting, stop as `cancelled`/`timeout`.
4. **Attempt** — run one fetch with `redirect: "manual"` and a
   caller+deadline abort signal. Validate the request host and every redirect
   target against the allowlist (see Redirect resolution).
5. **Classify** — decide whether the response is terminal, retryable,
   negative, or malformed (policy table below).
6. **Cache write** — write cacheable success and negative envelopes
   write-through; never write failures, retries, 429s, or malformed bodies.
7. **Decode** — invoke the plan decoder on the envelope only after the
   response is known terminal. Decode failures are `source_failure`
   (`malformed`) and the body is not cached.
8. **Return** — convert the typed result to `RunOutcome` and return metadata
   with requested/final URLs, cache state, and warnings.

Every retry loop re-enters at step 3 for spacing, then re-checks the budget
before the next attempt; backoff sleeps are abortable and count against the
budget.

### 4. Redirect resolution

The runtime follows HTTP redirects itself rather than trusting `fetch`'s
`follow` mode:

- `redirect: "manual"` so each hop is visible and validated.
- Each `Location` is resolved against the current URL, must be `https`, and
  must resolve to an allowlisted host.
- At most `maxRedirects` hops.
- The requested URL and final URL are both preserved in `ResponseMeta`.
- Identifier routes whose redirect is deterministic (Open Library
  `/isbn/{isbn}.json`) may be cached as detail-class entries under their own
  request identity, so an offline or subsequent lookup can replay the
  resolution. The canonical body fetched after the redirect is cached under
  the canonical URL.

Source-layer redirects are *not* the runtime's concern. Open Library merged
keys return a `200` `/type/redirect` JSON record; the Open Library workflow
detects that record and issues a second plan for the canonical key. Both plans
share the source budget, and both preserve requested and canonical keys.

### 5. Retry, rate limiting, deadlines, and cancellation policy

#### Retry eligibility

| Condition | Action |
| --- | --- |
| Network failure before a response (DNS, TLS, reset, refused) | Retry at most twice |
| HTTP 502, 503, 504 | Retry at most twice |
| HTTP 429 with `Retry-After` | Honor `Retry-After`, retry at most twice if the remaining budget can afford the wait; otherwise fail with `rate_limited` |
| HTTP 429 without `Retry-After` | Fail with `rate_limited`; no automatic retry |
| All other 4xx (including Open Library's 422 validation) | Never retried |
| HTTP 500, 501 | Not retried; fail with `upstream_error` |
| User cancellation | Never retried; abort immediately |
| Budget exhausted | No further attempts; fail with `timeout` |

Backoff between eligible attempts is exponential with full jitter:
`delay = random() * min(maxBackoffMs, baseBackoffMs * 2^attempt)`; when
`Retry-After` is present it replaces the computed delay. Retry attempts,
backoff sleeps, spacing waits, and the fetch itself share one abort source, so
cancellation preempts every phase.

#### Per-source policy defaults

| Source | Hosts | Max concurrent | Min spacing | Notes |
| --- | --- | --- | --- | --- |
| Open Library | `openlibrary.org` | 2 | 350 ms | Identified clients are documented at ~3 requests/s; spacing and identification are the only rate defense (no documented rate headers) |
| Wikidata | `wikidata.org`, `www.wikidata.org`, `query.wikidata.org` | 1 | 0 ms (serialized) | Wikimedia guidance is to keep requests in series at a low rate; concurrency 1 is the operative bound |

These are product defaults applied by the runtime, verifiable by live smoke
tests; they are not user-facing configuration in the MVP.

#### Deadlines

Each catalog operation receives a per-source budget (default 8 s) and the
whole lookup has a separate overall deadline (default 12 s). Providers only
know their own source budget. The composition layer (#6/#13) passes the
overall deadline down as the caller's `AbortSignal`; when it fires, the
runtime treats it as cancellation, aborts queue waits, backoff, and fetch, and
returns `cancelled`. A source that exhausts its own budget returns
`source_failure` with `timeout`; a caller that cancels returns `cancelled`.

| Budget event | Result |
| --- | --- |
| Source budget expires before response | `source_failure` with `timeout`, source warning; partial results from other sources survive |
| Overall lookup deadline fires | `cancelled` at every source |
| User cancels (new search, Ctrl+C) | `cancelled`, no cache write, no retry |

### 6. Decoding seam

Decoding is deliberately small and hand-written. A decoder accepts the raw
envelope (status, content type, body bytes, final URL) and returns a typed
`DecodeResult`:

```ts
type DecodeResult<D> =
  | { readonly kind: "data"; readonly value: D }
  | { readonly kind: "empty" }            // valid zero-result response
  | { readonly kind: "malformed"; readonly detail: string };
```

Rules:

- **Content-type gate**: JSON is parsed only when the response content type is
  JSON (`application/json` or `application/sparql-results+json`), or when an
  endpoint documents that a missing content type is JSON and the body starts
  with `{`/`[`. HTML bodies (Open Library's unknown-ISBN 404) are classified
  as `no_record` at the HTTP layer without an HTML parser; they are never fed
  to a JSON decoder.
- **Strict UTF-8**: bodies are decoded as UTF-8 with fatal errors; invalid
  byte sequences are `malformed`, never silently replaced. This prevents the
  observed mojibake failure mode where a client assumes Latin-1 for JSON that
  has no `charset`.
- **Tolerant shape**: only required identity and type invariants fail.
  Optional fields that are absent, `null`, or the wrong type for a *non-core*
  fact degrade to absent plus a warning where provenance demands it. Unknown
  fields and unknown `fields` requests are ignored (Open Library schema is not
  stable). Required invariants per endpoint are enumerated in each source's
  decoder table (Open Library requires `key` and `type` on records; Wikidata
  requires the entity `id` and `claims` structure it is asked to read).
- **Rank preservation**: Wikidata decoders preserve claim ranks,
  qualifiers, and references. Deprecated claims are excluded from ordinary
  evidence; conflicts among preferred/normal claims surface as warnings
  (research #2).
- **Decoder versioning**: each endpoint's decoder has a version that is stored
  with cached envelopes. Serving a cached body whose decoder version is
  unsupported is treated as corruption (miss + quarantine) per D5, never as a
  silent decode of a changed shape.

No JSON schema, `zod`-style library, or generated validator is adopted.

### 7. Caching seam

The runtime treats the cache as an opaque store with these operations:

```ts
// cache/store.ts (port; file-entry implementation per D8 / #10)
interface CacheStore {
  readonly read: (key: CacheKey) => Promise<ReadOutcome>;
  readonly write: (entry: CacheEntry) => Promise<WriteOutcome>;
  readonly quarantineCorrupt: (key: CacheKey) => Promise<void>;
}
```

`ReadOutcome` is the discriminated set from issue #5 section 3.11
(`hit_fresh`, `hit_stale`, `miss`, `corrupt`, `permission_denied`,
`cancelled`); `WriteOutcome` is `stored` or a typed failure. The runtime owns:

- **Identity**: cache key = method + normalized request URL + source +
  decoder version. Headers that change response semantics (none for the MVP
  GETs besides the immutable `User-Agent`/`Accept`) are part of the URL query
  or are fixed; anything that would change meaning must appear in the key.
- **What is cacheable**: terminal `200`/`2xx` data responses, structured
  negative responses (JSON `404` "not found", valid `200` with zero results),
  and deterministic identifier redirects. Failures, retries, 429s, 422
  validation responses, malformed bodies, and HTML negatives are never cached.
- **Freshness classes**: `search` requests get the search TTL, `detail`
  requests get the detail TTL; a response the decoder or HTTP layer marks
  negative gets the negative TTL. The store holds the TTL table; the runtime
  only labels the class and the negative flag.
- **Offline/stale semantics**: the runtime never claims stale data is fresh;
  a stale hit is served only when the calling path allows it and is labeled
  `stale` on the metadata. Core-facing behavior (stale labeling, offline
  commands) follows `docs/product-spec.md` and issue #10.
- **What is never cached**: a Resolved Work, a recommended Title Group, or any
  merged conclusion. The cache stores raw response envelopes only.

## Which third-party dependencies earn their cost

Assessment against the MVP surface and the project's Deno 2.9 constraints:

| Candidate | Verdict | Reason |
| --- | --- | --- |
| HTTP client library (undici wrapper, `ky`, `ofetch`, fetch-retry) | Rejected | Deno's built-in `fetch` already supplies signal, streaming, and response metadata. Retry, rate limiting, budget, redirect, and cache semantics must be single-sourced in the deep module; a library retry layer cannot see the source budget or the cache, and would duplicate the very invariants this design centralizes |
| Runtime schema/validation library (zod, valibot, ajv) | Rejected | Decoders are few, endpoint-specific, tolerant, and intentionally small. A schema layer adds an npm/deno dependency tree, a node_modules layout requirement for npm imports, compile risk, and version-age gating for no MVP benefit. The invariant set is already enumerated by research #1 and #2 |
| `@std/async` retry/delay/semaphore helpers | Considered, not required | The helpers are credible, but the runtime needs abortable sleeps, budget-aware retry decisions, `Retry-After` overrides, and spacing that interacts with concurrency and cancellation. Reimplementing those few behaviors locally (a few dozen lines behind the effects seam) keeps policy explicit and deterministic. Adopt a std helper later only if it can express every policy without wrapping |
| `@std/fs` `ensure-dir` for the file-entry store | Allowed by D8/D3 | The store implementation may use narrow std filesystem helpers; the runtime itself does not touch files |
| Other npm/js-only runtime packages | Rejected for the MVP | Documented Deno compile flakiness with npm dependencies and the extra permission/layout surface make them net-negative here. Dependencies, if any, first earn their place in the TUI/app layer (issue #3/#9) or distribution (issue #11), not in the provider transport |

Explicit answer: **no third-party runtime dependency is justified** for the
provider runtime or decoders in the MVP. Deno built-ins plus tiny local helpers
cover the surface, and the deep module keeps the policy in one auditable
place.

## Source-specific workflows

Each source owns a narrow internal client module with fixed operations. The
operations below are private to Providers; Core-facing catalog operations are
issue #6's decision.

### Open Library (from research #1)

| Operation | Endpoint(s) | Runtime notes |
| --- | --- | --- |
| Candidate discovery | `/search.json` with fielded params (`title=`, `author=`, `isbn=`, optional `language:` MARC code), fixed small `fields` allowlist, small `limit` | Never send a bare `q` shorter than the observed 3-character minimum; prefer fielded parameters. Do not trust search rank as evidence |
| Identifier resolution | `/isbn/{isbn}.json` then Edition read | Runtime follows the 302 and preserves requested/canonical. A missing ISBN yields an HTML 404 → `no_record`, not a decode failure |
| Work/Edition read | `/works/{key}.json`, `/books/{key}.json` | Detect `/type/redirect` JSON records and issue a second plan for the canonical key, preserving both references |
| Edition expansion | `/works/{key}/editions.json` with `offset`/`limit` (default 50) | Page with the `next` link or explicit offsets; each page is a separate cacheable detail plan. Never treat search `edition_key` as a language-filtered subset |
| Attestation extraction | Edition records | `title`/`subtitle` on an Edition connected by `works[].key` are edition attestations; `languages` provide Content Language only when exactly one is recorded; `translation_of`, `work_titles`, `other_titles` are clues, not attestations |

Decoder invariants: Edition and Work records must carry `key` and `type`;
`languages`, `translation_of`, `work_titles`, `other_titles`, `authors`,
`isbn_13`, `subtitle`, and even `title` may be absent and are tolerated.
Responses are UTF-8 even without an explicit `charset`.

### Wikidata (from research #2)

| Operation | Endpoint(s) | Runtime notes |
| --- | --- | --- |
| Candidate discovery | `wbsearchentities` (`action=wbsearchentities`), `language=zh`, optional `zh-hant` retry | Search results are clues, never attestations |
| Entity reads and classification | `wbgetentities` in batches of ≤50 | Classify Work / Edition / Other from P31; preserve ranks, qualifiers, references; resolve redirects and preserve requested + resolved QID |
| Work edition expansion | Fixed SPARQL Shape 2 (bound `VALUES ?work`) | Constant query text; only the bound QID changes. On WDQS failure/timeout, fall back to the Work's P747 values plus entity reads |
| Identifier resolution | Fixed SPARQL Shape 3 or CirrusSearch `haswbstatement:P212=` fallback | Result is an Edition candidate that must still pass classification |
| Attestation extraction | `p:P1476` statements on qualifying Editions, rank not deprecated | Title Language comes from the monolingual text tag or the P407 qualifier; P1680 qualifiers are subtitles; labels/aliases/descriptions/sitelinks never attest a title |

Decoder invariants: Action API and `Special:EntityData` share one entity JSON
shape, and SPARQL JSON is a second fixed shape. Unknown properties and entity
fields are ignored; statement references are preserved as provenance.
Deprecated claims are excluded from ordinary evidence; conflicts among
preferred/normal claims become warnings.

### Failure mapping to source states

| Runtime/decoder outcome | Source warning / state on the catalog surface |
| --- | --- |
| `ok` / `no_record` | Data or a no-record contribution; may combine with other sources |
| `source_failure` `timeout` | Per-source deadline exceeded; partial state with a source warning |
| `source_failure` `rate_limited` | Source throttled; partial state with a warning; no retry storm |
| `source_failure` `malformed` | Upstream data unreadable; warning, never fabricated evidence |
| `source_failure` `upstream_error` | Selected 5xx exhausted or non-retryable server error |
| `source_failure` `permission_denied` | Configuration/permission diagnostic mapped by the CLI layer |
| `cancelled` | User or overall-deadline cancellation; no source warning treated as failure |

## Security and permission rules

- **Host allowlist enforced in code.** The runtime refuses any non-`https`
  URL and any host outside the configured allowlist before fetching, and
  re-checks every redirect target. This is defense in depth beneath the Deno
  permission manifest.
- **Identified User-Agent.** Runtime config carries
  `book-title-lookup/<version> (+<project URL>; <contact>)`. Contact comes
  from `BOOK_TITLE_CONTACT`; the composition root reads configuration and
  hands the finished string to Providers. Providers never read environment
  variables themselves (issue #5 D6).
- **Narrow Deno permissions.** Provider processes need outbound network only
  to the allowlisted catalog hosts plus read/write on the cache/config roots.
  No `-A`; no subprocess, FFI, arbitrary filesystem, or listening socket.
  The runtime contains no environment access.
- **No secrets in providers.** The MVP uses no credentials for either source;
  the Google key name is reserved and never read. Debug output never logs
  request bodies, headers, or cache entries; secrets and authorization headers
  are always redacted.
- **TLS defaults.** Certificates are not disabled or pinned beyond platform
  defaults.
- **Cache hygiene.** Never write merged conclusions or a Resolved Work; never
  write error responses; quarantine corrupt entries rather than guessing.

## Fixture and contract-test seams

Providers tests are fixture-backed; live source checks stay in the separate
low-volume smoke suite (product spec). The seams this design fixes:

1. **Deterministic runtime harness.** Contract tests run `ProviderRuntime`
   against an injected `fetch` stub plus fake `RuntimeEffects` (`now`,
   `random`, and a controllable `delay`). No test waits on a real timer or
   touches a live source.
2. **HTTP contract fixtures.** Each fixture is a raw response envelope
   recorded with source, requested/final URL, fetched-at timestamp, status,
   content type, and decoder version (research #1 guidance). Required cases:
   - Open Library: `200` search with docs; `200` zero-result search; JSON
     `404` missing key; HTML `404` unknown ISBN; `422` too-short `q`;
     `302` ISBN redirect; merged-key `/type/redirect` record; paginated
     `/works/{key}/editions.json` with a `next` link; unknown extra fields;
     `429` with `Retry-After`; retryable `5xx` then success.
   - Wikidata: `wbsearchentities` result with a `match` block; batch
     `wbgetentities` with ranks/qualifiers/references; deprecated identifier
     pair; SPARQL JSON rows from Shape 2; SPARQL `429` with `Retry-After`;
     WDQS failure fallback behavior.
   - Transport: malformed JSON, invalid UTF-8 bytes, non-JSON content type,
     redirect off-allowlist, redirect loop, network error before response.
3. **Policy assertions.** For scripted sequences assert: retry count ≤2 and
   only for eligible classes; `Retry-After` honored; budget exhaustion stops
   retries; cancellation during spacing/backoff/fetch returns `cancelled`;
   concurrency never exceeds the policy; spacing honors the virtual clock;
   redirect hops consume slots and re-check allowlist; cache writes happen
   only for terminal data/negative/identifier responses; decode failures are
   not cached.
4. **Cache contract tests.** Fresh hit performs no fetch; stale entry used
   only with an offline/stale allowance and labeled stale; corrupt and
   decoder-version-mismatch entries quarantine and refetch (D5); cache
   identity differs when any meaning-changing query parameter differs.
5. **Live smoke suite.** A small opt-in suite with an identified User-Agent,
   serialized requests, and current-date assertions runs the acceptance corpus
   at low volume; it is not part of routine tests.

## Consequences for implementation

- The first provider vertical slice builds `runtime/` as one module and one
  OL workflow against fixtures before Wikidata; runtime policy is exercised
  by the contract harness before any endpoint mapping.
- Type sketches here are refined test-first with the first vertical slice, as
  `docs/architecture.md` requires; they are documentation, not a frozen public
  API.
- The file-entry `CacheStore` implementation is authorized to proceed on the
  issue #5 D8 contract; physical store details, directory roots, user-visible
  cache commands, and compile-time path grant handling remain with issue #10.
- Provider code introduces **no new dependency** and no environment reads.
- Runtime default values (retries, spacing, budgets, redirect cap, backoff)
  live as named constants beside `runtime/` so the live smoke suite can
  confirm them against documented source etiquette.
- Source workflows that need a second request (Open Library
  `/type/redirect`, indirect candidate discovery; Wikidata WDQS fallback)
  reuse the source budget and rate-limiter through the same runtime; a
  workflow may never bypass the runtime to call `fetch`.
- Because the catalog surface (#6), reconciliation (#7), the application
  state/effect seam (#13), and implementation ordering (#14) remain open,
  this decision intentionally does not fix those interfaces; it only removes
  their dependence on provider transport mechanics.

## Risks and open verification points

- **Manual redirect behavior under Deno fetch** (`redirect: "manual"`,
  `Location` access on the response) should be confirmed in a throwaway probe
  before the runtime is coded; contract fixtures assume standard
  `opaque-redirect` semantics.
- **Rate-limit defense without headers**: Open Library exposes no documented
  rate headers; spacing and identification are the only defense and should be
  tuned against the live smoke suite.
- **Budget sensitivity**: paging Open Library Editions for very large Works
  (hundreds of Editions) can exceed the 8 s source budget; the workflow should
  stop paging on budget pressure with a warning rather than fail the whole
  source.
- **Decoder version drift**: Open Library warns its schema is not stable; the
  decoder-version stamp keeps cached bodies from silently changing shape but
  will quarantine cache entries after intentional decoder changes, which is a
  deliberate refetch rather than a correctness risk.
- **Wikidata WDQS variability**: the fixed-shape queries are optional and
  cached; a slow or down WDQS degrades to P747/entity reads with a source
  warning, never a total source failure.
