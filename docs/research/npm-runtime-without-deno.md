# npm Runtime Without Deno

Research deliverable for migrating Book Title Lookup from a Deno application
distributed through npm to a Node.js application installed and run through npm.
Repository observations are against commit `b240c9a`. Primary documentation and
registry metadata were retrieved on 2026-09-06.

This document is research and a migration recommendation. It does not change
the accepted runtime, package topology, or release process by itself. Those
changes require a superseding ADR and implementation work.

## 1. Executive Decision

**Verdict: the migration is feasible and should be straightforward if the
project accepts a weaker runtime permission boundary.**

The recommended target is:

- Node.js 22 or newer as the only application runtime;
- one root npm package with one `book-title` executable;
- ESM TypeScript in the repository;
- a non-minified JavaScript bundle in the published package;
- npm for dependency locking, scripts, packing, and publication;
- TypeScript for type checking, esbuild for the release bundle, Node's built-in
  test runner with `tsx` for TypeScript execution, and Biome for formatting and
  linting;
- no Deno installation in development, CI, or production;
- no install-time scripts, binary downloads, platform packages, or Node
  launcher process.

The published shape becomes:

```text
book-title-lookup@<version>
├── package.json
├── README.md
├── LICENSE
├── THIRD_PARTY_NOTICES
└── dist/
    ├── book-title.js
    └── book-title.js.map
```

npm creates the POSIX link and Windows command shims for the `book-title` entry
in the package's `bin` field. `book-title` then runs directly in the user's
Node process [11].

### 1.1 Important scope clarification

The current design already satisfies the narrower requirement "npm users
should not have to install Deno." `deno compile` embeds a Deno runtime into each
platform binary, and the Node launcher only selects and spawns that binary
[20].

This proposal satisfies the stronger requirement "Deno should not be the
application runtime at all." It replaces the embedded Deno runtime with the
Node runtime the npm user already has. That is worthwhile if the goal is to
simplify development and distribution, reduce package size, or remove the
four-binary release matrix. It is not necessary merely to remove a separate
Deno installation prerequisite.

### 1.2 The decision that must be accepted

The current compiled application has broad read/write access because its
per-user directories are only known at runtime, but it has a narrow network
host allowlist, a narrow environment-variable allowlist, and no subprocess
grant. A normal Node 22/24 npm executable has ambient process authority:

- any environment variable can be read;
- any network host can be contacted;
- filesystem and subprocess APIs are available to loaded code.

Node's stable Permission Model in Node 22 and 24 restricts filesystem,
subprocess, worker, addon, and related capabilities when the user starts Node
with `--permission`. It does **not** restrict network or environment access in
those releases, npm packages cannot reliably impose the user's Node flags, and
Node explicitly describes the model as a trusted-code "seat belt," not a
malicious-code security boundary [6, 7].

The project's closed environment reader and filesystem seam should remain:
they continue to constrain first-party behavior and make it testable. A
dependency-free runtime bundle also limits the code present in the installed
artifact. Neither is equivalent to Deno's enforced host and environment-name
grants.

**Recommendation:** proceed with Node if simplifying npm-native operation is
the priority, and explicitly accept the permission-model change in the
superseding ADR. If enforced network-host and environment-name isolation is a
non-negotiable requirement, retain the current compiled-Deno architecture.

## 2. Method and Evidence

This document distinguishes:

- **G — documented guarantee:** behavior stated in primary Node, npm,
  TypeScript, esbuild, or package documentation;
- **O — observed:** repository structure, source searches, or the limited
  disposable probes described below;
- **I — inference/recommendation:** an engineering conclusion from guarantees
  and observations.

No repository source or configuration was changed for a runtime probe.

### 2.1 Limited probes

Two disposable checks were run outside the repository:

1. `string-width@8.2.2` under Node passed all ten samples in the committed
   display-width corpus: CJK, ASCII, mixed text, combining marks, emoji, a flag
   pair, a ZWJ family, and accented Latin text.
2. `new TextDecoder("gb18030")` under Node 24.18.0 on Windows decoded the
   committed CP936 byte pair `d6 d0` as `中`.

These establish library/API compatibility for those examples only. They do
not establish how bytes arrive from a real Windows Terminal session. That
remains a required native manual gate.

The registry query `npm view book-title-lookup` returned `E404` on 2026-09-06.
This means no public package resolved under that name at query time; it is not
a reservation or a guarantee that publication will succeed later.

## 3. Current-State Inventory

The migration is smaller than the amount of Deno-oriented documentation
suggests.

### 3.1 Runtime-independent majority

Core reconciliation, catalog behavior, provider mapping, HTTP policy, caching
policy, CLI parsing, JSON construction, the coordinator, rendering, and input
decoding are already written against project-owned ports or standard
JavaScript/Web APIs.

The important reusable APIs are all available in supported Node releases:

- `fetch`, `Request`, `Response`, and `Headers`;
- `AbortController`, `AbortSignal`, and `EventTarget`;
- `URL` and `URLSearchParams`;
- `TextEncoder` and `TextDecoder`;
- `crypto` functionality, although the Node adapter should use
  `node:crypto` explicitly;
- `Intl.Segmenter`;
- timers and typed arrays.

Node 22 documents its global Web-compatible API surface, including stable
`fetch` and the cancellation primitives. Provider HTTP behavior should
therefore migrate without a client-library rewrite. The existing deep
provider runtime should continue to own retries, pacing, budgets, redirects,
cache behavior, and cancellation [2].

### 3.2 Direct Deno surface

A repository search found 113 TypeScript files across `apps/`, `packages/`,
and `distribution/`. The 100 application/library files account for
approximately 21,600 lines. Only these application/library files directly use
the Deno namespace:

| File | Deno-specific responsibility | Migration |
| --- | --- | --- |
| `apps/tui/src/main.ts` | args, stdio, TTY state, raw mode, terminal size, signals, platform, exit | Node composition root and TTY adapter |
| `packages/providers/src/platform/env.ts` | allowlisted environment reads and Deno permission errors | `process.env` behind the same reader |
| `packages/providers/src/platform/platform.ts` | Deno OS type/token mapping | explicit `process.platform` mapping |
| `packages/providers/src/cache/fs-seam.ts` | filesystem operations and Deno error classes | `node:fs/promises` adapter and error-code mapping |
| `packages/providers/src/cache/file-entry-store.ts` | default platform lookup | inject or default from `process.platform` |
| `apps/tui/src/json/schema-validate.ts` | reads a JSON schema URL | `readFile` from `node:fs/promises`; currently test-only |

`apps/tui/src/smoke/live-smoke.ts` is a seventh migration site for its process
and scratch-filesystem wiring. `apps/tui/src/tui/input-decoder.ts` only names
Deno in a comment.

This concentration is a direct benefit of the existing `TerminalIo`,
`EnvironmentReader`, `FileSystemSeam`, `Clock`, and `RandomSource` seams. Core
and the provider runtime should not acquire Node imports during the migration.

### 3.3 Test and tooling surface

The larger mechanical change is in the harness:

- 37 files register tests with `Deno.test`;
- those files contain 351 test registrations;
- 32 files import Deno standard-library assertions;
- subprocess tests use `Deno.Command`;
- fixture setup and teardown use Deno filesystem helpers;
- root tasks, workspace metadata, the lockfile, and CI are Deno-based.

The distribution subtree contains 18 tracked files and approximately 2,019
lines. Most of it exists only to compile, package, select, verify, and smoke
four native Deno artifacts. A Node package does not need that topology.

The implementation is therefore expected to change many test/tooling lines
but little domain behavior.

## 4. Runtime Compatibility Findings

### 4.1 Entrypoint and process

| Current construct | Node replacement | Required rule |
| --- | --- | --- |
| `Deno.args` | `process.argv.slice(2)` | Slice once at the executable boundary. |
| `Deno.exit(code)` | assign `process.exitCode` | Let queued stdout/stderr complete; do not force an early exit. |
| `Deno.build.os` | `process.platform` | Map `win32`, `darwin`, and `linux` explicitly. Reject other platforms instead of treating all unknown values as Linux. |
| `Deno.cwd()` | `process.cwd()` | No semantic change. |
| `import.meta.main` | dedicated `bin.ts` entry | Keep importable composition separate from executable side effects. |
| `Deno.Command` | `spawn`/`execFile` from `node:child_process` | Use `process.execPath`, never assume the executable is named `node`. |

The clean entrypoint shape is:

```text
apps/tui/src/main.ts   exports the composed async entry function
apps/tui/src/bin.ts    shebang + process wiring + await entry(argv)
```

The build bundles only `bin.ts`. Tests can import the entry function without
triggering process exit or signal registration.

### 4.2 Standard input, output, and terminal control

Node's documented TTY surface directly covers the project's `TerminalIo`
contract [3]:

- `process.stdin.isTTY` and `process.stdout.isTTY`;
- `process.stdin.setRawMode(true | false)`;
- `process.stdout.columns` and `process.stdout.rows`, or
  `process.stdout.getWindowSize()`;
- the stdout `resize` event;
- raw `Buffer` chunks from stdin, which are `Uint8Array` subclasses;
- writable-stream callbacks and backpressure.

The Node adapter should improve two lifecycle details rather than imitate the
Deno calls line for line:

1. Keep one stdin iterator/subscription for the lifetime of the TUI. Creating a
   new async iterator for every read risks multiple stream consumers.
2. Resolve each `TextWriter.write` only from the stream write callback, and set
   `process.exitCode` after the CLI completes. This lets Node drain output and
   avoids needing synchronous process termination.

The existing `TerminalController.release()` sequencing remains valid:
show the cursor and leave the alternate screen before disabling raw mode.

Node documents that Ctrl+C does not generate `SIGINT` while stdin is in raw
mode. The existing input decoder must therefore continue to translate the
Ctrl+C byte into an interrupt. Process signal listeners still cover externally
delivered termination and non-raw operation [3, 4].

#### Windows input risk

Node documents raw-mode control but does not promise the byte encoding emitted
by every Windows console/ConPTY/terminal combination. The current Deno adapter
selects GB18030 for a Simplified Chinese Windows locale. Do not assume that
Node supplies the same bytes: libuv and the active terminal may instead supply
UTF-8-transcoded bytes.

The migration must preserve the decoder's injected GB18030 tests but decide
the production encoding from a real Node PTY probe. Passing a
`TextDecoder("gb18030")` unit example is necessary but not sufficient.

### 4.3 Signals and exit behavior

Use `process.on(signal, listener)` and `process.off(signal, listener)` around
the same application-owned `AbortController`.

Platform behavior is not identical:

- POSIX supports the normal `SIGINT`/`SIGTERM` lifecycle.
- Windows signal delivery is limited and emulated in places.
- raw-mode Ctrl+C is input, not `SIGINT`.

The application already has the right internal rule: all cancellation becomes
one abort signal and the coordinator owns outcome/exit-code mapping. Preserve
that rule and test externally delivered signals only where the host supports
them.

Do not add a launcher child process. Direct execution avoids the signal and
exit-code forwarding complexity the current npm launcher has to implement.

### 4.4 Environment and platform discovery

Keep `ENV_ALLOWLIST` as the single list of variables first-party application
code is permitted to request. Implement `systemEnvironment.read(name)` as an
indexed `process.env[name]` read.

Normal Node environment reads do not throw a permission error. Consequently:

- a missing variable remains `{ ok: true, value: undefined }`;
- injected `MemoryEnvironment` denial tests may remain useful for consumer
  behavior;
- production environment permission denial is no longer a reachable Node
  outcome unless the project adds an external sandbox;
- normative documentation and tests must not claim Node enforces the
  allowlist.

Map only:

```text
win32  -> windows
darwin -> darwin
linux  -> linux
other  -> unsupported environment
```

The last rule fixes an existing portability hazard exposed by moving from four
filtered platform packages to one portable JavaScript package.

The config/cache directory policy itself does not need to change. Continue
using `APPDATA`/`LOCALAPPDATA`, XDG variables, and `HOME` according to the
already documented precedence. Changing to `os.homedir()` during the runtime
migration would combine two independent policy changes and make cache
compatibility harder to review.

### 4.5 Filesystem and persistence

Implement `NodeFileSystemSeam` with `node:fs/promises` [5]:

| Seam operation | Node primitive |
| --- | --- |
| `mkdir` | `mkdir(path, { recursive, mode })` |
| `stat` | `stat(path)` |
| `openForWrite` | `open(path, "w")` |
| `readTextFile` | `readFile(path, "utf8")` |
| `rename` | `rename(from, to)` |
| `remove` | `rm(path)` |
| `listDirectory` | `readdir(path)` |
| `sync`/`close` | `FileHandle.sync()` / `FileHandle.close()` |

Map filesystem errors by the standard error object's `code`, especially
`ENOENT`, `EACCES`, and `EPERM`, instead of matching messages.

Preserve the current durable-write protocol:

1. create the temporary file in the target directory;
2. write the complete UTF-8 payload;
3. sync it;
4. close it;
5. rename it over the target;
6. retain the bounded Windows contention retry and cleanup behavior.

The Node adapter should loop on `FileHandle.write` until every byte has been
accepted, or use an API whose whole-payload completion is documented. A single
low-level write is not a whole-buffer invariant.

The underlying rename and filesystem semantics remain operating-system
semantics. Moving from Deno's Rust-backed call to Node's libuv-backed call does
not turn Windows replacement into POSIX replacement; the existing Windows
retry and native contention tests remain necessary.

### 4.6 HTTP and randomness

Keep global `fetch` as the injected provider transport. Do not introduce Axios,
Ky, or another retrying client: the provider runtime already centralizes the
policies those libraries tend to duplicate.

Run all provider fixture contracts unchanged after the test harness migration,
then run the existing live Open Library smoke test under Node. In particular,
compare:

- response status and headers used in cache metadata;
- redirect handling;
- abort and timeout classification;
- gzip/content decoding;
- deterministic JSON output and warnings.

Replace global `crypto.getRandomValues` in the production adapter with explicit
`node:crypto` functions such as `randomBytes` and `randomInt`. This removes
reliance on the status of Node's global Web Crypto binding and avoids modulo
bias in integer generation. Keep `RandomSource` unchanged so no caller knows
which runtime supplies entropy.

### 4.7 Unicode width and text decoding

There is one production JSR import:

```ts
import { unicodeWidth } from "@std/cli/unicode-width";
```

Replace it with `string-width`, retain the project-owned grapheme API, and run
the complete renderer corpus. `string-width@8.2.2` declares Node 20 or newer,
is MIT licensed, and passed the ten committed corpus samples in the limited
probe. Bundling it also removes the need for a JSR-to-npm registry bridge [19].

Keep `Intl.Segmenter` and the `KeyDecoder` boundary. Official Node builds expose
the WHATWG text encodings needed for GB18030, but supported encodings can
depend on how Node was built with ICU. The package should support official
Node releases, test the minimum Node release in CI, and fail clearly if a
required decoder is unavailable.

## 5. Permission and Security Consequences

This is the only architectural regression, rather than a mechanical API
translation.

| Capability | Current compiled Deno artifact | Recommended Node npm artifact |
| --- | --- | --- |
| Filesystem | Broad read/write grant; project seam constrains intended paths | Ambient by default; project seam constrains intended paths |
| Environment | Runtime-enforced closed list | Closed first-party reader, not runtime-enforced |
| Network | Runtime-enforced catalog-host list | Any host available to loaded code |
| Child processes | Not granted | Available unless an external Node permission invocation or OS sandbox denies it |
| Installed runtime code | First-party graph plus compiled dependencies | First-party bundle plus bundled width dependency |
| Install scripts | None | None |

Mitigations in the Node design:

1. Publish a bundle with zero runtime npm dependencies.
2. Keep an explicit `files` allowlist and inspect the tarball.
3. Define no `preinstall`, `install`, `postinstall`, or `prepare` lifecycle
   script.
4. Keep the environment and filesystem seams closed and covered by tests.
5. Import Node built-ins through explicit `node:` specifiers.
6. Lock build dependencies and use automated update review.
7. Generate an SBOM or dependency inventory for the bundle and include
   third-party notices.
8. Publish with npm provenance from a protected release environment.
9. Continue mapping real OS permission failures to structured outcomes.

Rejected mitigation: make the executable restart itself under
`node --permission`. This adds a launcher process and signal complexity,
requires dynamic read grants for npm's installation/cache paths, is not
transparent across all npm shims, and still does not restore Node 22/24
network-host or environment-name restrictions.

## 6. Build and Package Recommendation

### 6.1 Supported Node versions

Set:

```json
"engines": {
  "node": ">=22"
}
```

Node 22 and 24 are supported LTS lines at the research date. Node 20 is
end-of-life and should not be a new baseline. Test the oldest accepted Node 22
release behavior and the current Node 24 LTS line [1].

Do not set the floor merely from syntax emitted by the bundler. The effective
floor must also cover stable `fetch`, test tooling, ICU behavior, and the
project's support window.

### 6.2 Source modules

Keep ESM and the existing explicit `.ts` relative imports in source. This
avoids mechanically rewriting hundreds of correct Deno-style relative
specifiers. TypeScript supports checking this style through
`allowImportingTsExtensions`; it can also rewrite relative extensions when
JavaScript emit is desired [16, 17].

Use a root `tsconfig.json` approximately along these lines:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "strict": true,
    "target": "ES2023",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["apps/**/*.ts", "packages/**/*.ts", "scripts/**/*.ts"]
}
```

The exact `lib` set should be confirmed by `tsc`; the intent is to type the Web
API provider boundary and Node process adapters without ambient Deno types.

The three nested `deno.json` files do not correspond to separately published
libraries today. Remove them rather than creating npm workspaces with no
consumer. Keep `apps/` and `packages/` as architectural source directories
inside one package.

### 6.3 Why publish a bundle

Use esbuild with [18]:

- entry point `apps/tui/src/bin.ts`;
- `bundle: true`;
- `platform: "node"`;
- `format: "esm"`;
- `target: "node22"`;
- no minification;
- an external source map;
- a Node shebang banner;
- legal comments/notices retained;
- output `dist/book-title.js`.

Then ensure the output is executable on POSIX.

This is preferred over unbundled `tsc` emit because it gives npm one portable
runtime file, absorbs the one Unicode-width dependency, avoids publishing the
internal module tree, and makes the package allowlist easy to verify. Source
module boundaries remain visible and testable in the repository.

TypeScript must still run separately with `--noEmit`; esbuild transpiles but
does not type-check.

### 6.4 Package metadata sketch

The intended shape, with versions omitted because they should be chosen and
locked during implementation:

```json
{
  "name": "book-title-lookup",
  "version": "0.1.0",
  "description": "Find attested titles of the same book across languages.",
  "license": "MIT",
  "type": "module",
  "bin": {
    "book-title": "dist/book-title.js"
  },
  "files": [
    "dist/book-title.js",
    "dist/book-title.js.map",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES"
  ],
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "tsx apps/tui/src/bin.ts",
    "build": "node scripts/build.mjs",
    "check": "tsc --noEmit",
    "test": "node --import=tsx --test",
    "fmt": "biome format --write .",
    "fmt:check": "biome format .",
    "lint": "biome lint ."
  }
}
```

Also add repository, bugs, and homepage metadata before first publication.
Avoid a `main` or `exports` entry until the project intentionally promises a
library API.

Use `package.json` as the release-version source of truth. The release gate
should verify that a `v<version>` tag matches it, and the build should inject
that value into the bundle. Remove duplicated workspace/default versions
instead of porting their drift risk.

### 6.5 Why not publish TypeScript directly

Node 22 can strip erasable TypeScript syntax, but its own documentation says
[8]:

- it ignores `tsconfig.json`;
- it does not transform TypeScript features such as parameter properties;
- type stripping does not type-check;
- file extensions are mandatory;
- Node refuses TypeScript files under `node_modules` to discourage package
  authors from publishing TypeScript as runtime code.

The repository already contains a parameter property, and an npm package is
installed under `node_modules`. Native type stripping is useful for small
developer scripts, not for this published executable. Publish JavaScript.

## 7. Test Migration

Use Node's stable built-in test runner rather than introducing a full test
framework. Node 22 discovers `*_test.ts` files, and `tsx` supplies complete
TypeScript transformation through the documented `--import` hook [8, 9].

### 7.1 Mechanical conversions

1. Replace `Deno.test(name, fn)` with an imported `test(name, fn)` from
   `node:test`.
2. Add a small project-local assertion adapter backed by
   `node:assert/strict`:
   - `assertEquals` -> deep strict equality;
   - `assert` -> truthiness assertion with TypeScript narrowing;
   - `assertMatch` -> regular-expression match;
   - `assertStringIncludes` -> explicit inclusion assertion.
3. Replace test scratch calls with `node:fs/promises` helpers.
4. Replace `Deno.cwd()` with `process.cwd()` and Deno platform tokens with the
   explicit Node mapping.
5. Replace subprocess commands with `spawn` or `execFile`.
6. Run source subprocess tests through `process.execPath` plus
   `--import=tsx`; run package contract tests against the built tarball.

The assertion adapter keeps the migration review focused on runtime behavior
instead of rewriting every expectation into a new assertion style.

### 7.2 Preserve the behavioral contracts

The following gates must remain byte- or behavior-equivalent:

- all committed CLI JSON schemas and snapshots;
- human output and exit codes;
- cancellation and late-outcome dropping;
- stale/offline/cache behavior;
- filesystem corruption, contention, and retry fixtures;
- Unicode width and truncation;
- CP936/GB18030 decoder chunks;
- TUI acquire/release ordering;
- partial output writes;
- environment/config precedence;
- provider request, retry, pacing, and source-budget contracts.

Start with test-file concurrency limited if shared-resource failures appear.
Enable normal Node file-level concurrency only after every scratch path and
global state dependency is shown to be isolated.

### 7.3 Replace permission assertions honestly

Keep injected permission-denial tests for filesystem and settings outcome
mapping. Replace the Deno manifest-drift tests with:

- a static test that first-party environment reads go through
  `EnvironmentReader`;
- a static or lint rule forbidding direct `process.env` access outside the
  Node adapter and build scripts;
- a package scan asserting no install lifecycle scripts;
- bundle dependency and built-in import inspection.

Do not keep a test that claims `ENV_ALLOWLIST` is enforced by Node. It is not.

## 8. Distribution and CI Cutover

### 8.1 Delete obsolete topology

Once Node package contracts pass, remove:

- the root `deno.json` and nested Deno workspace files;
- `deno.lock`;
- the compiled-binary target table;
- all four platform-package templates;
- the CommonJS launcher and launcher contract;
- `deno compile`, binary manifest, and platform-package pack logic;
- Deno setup from GitHub Actions.

Retain and rewrite only the useful release invariants:

- one version;
- explicit package contents;
- executable shebang/mode;
- no lifecycle installers;
- deterministic CLI behavior;
- tarball smoke tests;
- provenance and approval separation.

### 8.2 CI jobs

Recommended pull-request gates:

1. `npm ci`.
2. formatting check.
3. lint.
4. `tsc --noEmit`.
5. Node test suite.
6. esbuild release bundle.
7. `npm pack --dry-run` and tarball content inspection.
8. install the produced tarball with `--ignore-scripts`.
9. run `book-title --version`, help, one fixture-backed JSON lookup, and cache
   config/list commands through npm's generated shim.
10. `git diff --check`.

Run the package smoke on:

- Windows;
- Ubuntu Linux;
- Intel macOS;
- Apple Silicon macOS.

Include Node 22 and Node 24 across the matrix without multiplying every
OS/architecture combination unnecessarily. The bundle is platform-independent;
the native matrix exists to validate process, filesystem, terminal, and npm
shim behavior, not to build different artifacts.

Keep live provider smoke separate, scheduled or manually dispatched, because
external service availability is not a deterministic pull-request gate.

### 8.3 Release

Build and publish the same npm tarball once. Do not define a `prepack`,
`prepare`, or install hook that silently builds or downloads artifacts.
Release automation should:

1. verify the tag and `package.json` version;
2. run all deterministic gates;
3. build in a clean checkout;
4. inspect and smoke the exact tarball [13];
5. publish from a separately approved GitHub environment using npm trusted
   publishing/provenance [14, 15];
6. query the registry and smoke the immutable published version.

The GitHub Release may attach the npm tarball and checksums. It should not
claim to provide a standalone executable: users still need Node. If standalone
downloads later become a requirement, assess that separately.

Node single-executable applications are not part of this migration. Node 22
labels SEA active development, supports one embedded CommonJS script, and
requires platform-specific binary copying, blob injection, and code-signing
steps. Adopting SEA would recreate much of the native artifact matrix this
migration is intended to remove [10].

## 9. Options Considered

| Option | Result | Reason |
| --- | --- | --- |
| **Node adapters + bundled ESM JavaScript** | **Recommended** | Direct npm runtime, one portable package, small explicit runtime surface, existing ports localize the change |
| Node adapters + unbundled `tsc` output | Viable fallback | Uses the official compiler only and TypeScript can rewrite relative `.ts` extensions, but publishes a large internal module tree and leaves runtime dependency handling |
| Publish `.ts` and rely on Node type stripping | Rejected | Node refuses TS in `node_modules`, ignores tsconfig, does not type-check, and cannot transform all syntax already present |
| Add a global `Deno` compatibility shim on Node | Rejected | Hides real process/TTY/filesystem differences behind a broad fake runtime and preserves misleading Deno semantics |
| Keep compiled Deno platform packages | Valid if permissions dominate | Already removes the user's Deno prerequisite and preserves the strongest capability boundary, but retains four packages and the native matrix |
| Node single-executable applications | Deferred | Still platform-specific and active-development in Node 22; solves a standalone-binary problem, not an npm-runtime problem |

## 10. Implementation Plan

### Phase 0 — approve the changed contract

- Record a superseding ADR: Node is the runtime, one npm package is the
  distribution unit, and the Deno host/environment permission boundary is
  intentionally relinquished.
- Fix the supported Node floor and tested release lines.
- Confirm that npm, not standalone binaries, is the primary supported install.

**Exit:** the permission and runtime decisions are explicit, not inferred from
code changes.

### Phase 1 — add the Node toolchain

- Add root `package.json`, `package-lock.json`, `tsconfig.json`, and Biome
  configuration.
- Add `@types/node`, TypeScript, `tsx`, esbuild, Biome, and `string-width` as
  locked development/build dependencies.
- Add `scripts/build.mjs`.
- Keep `.ts` source extensions and verify `tsc --noEmit`.

**Exit:** source type-checks without ambient Deno types except the known
adapter/test migration sites.

### Phase 2 — port runtime adapters

- Split importable composition from `bin.ts`.
- Implement process/TTY I/O and signal wiring.
- Implement `NodeFileSystemSeam`.
- Port the environment reader, platform detection, schema read, random source,
  and live smoke script.
- Reject unsupported Node platforms explicitly.

**Exit:** the built Node entry runs help, version, and noninteractive fixture
commands with expected output.

### Phase 3 — replace the JSR runtime dependency

- Use `string-width` behind the existing project-owned width functions.
- Preserve grapheme-safe truncation.
- Add any newly discovered Unicode cases before changing expected behavior.
- Include third-party notices in the package.

**Exit:** the full rendering and width corpus passes; the dependency is inside
the bundle and absent as a runtime install dependency.

### Phase 4 — migrate tests

- Convert registrations and assertions.
- Port scratch and subprocess helpers.
- Run all 351 behavioral cases under Node.
- Compare committed snapshots byte-for-byte.
- Port the live smoke separately.

**Exit:** Node owns the complete automated suite; Deno is not needed to test.

### Phase 5 — replace distribution

- Produce the one ESM bundle and source map.
- Add package allowlist and tarball verifier.
- Install and run the packed tarball on all supported operating systems.
- Delete launcher/platform package and compile machinery.

**Exit:** `npm install --ignore-scripts <tarball>` creates a working
`book-title` command, and the tarball contains only reviewed files.

### Phase 6 — update normative documentation

- Update `README.md`, `CONTEXT.md`, `docs/architecture.md`, and
  `docs/development.md`.
- Add the superseding ADR instead of rewriting ADR 0003's history.
- Mark `docs/design/npm-release-topology.md` superseded.
- Update permission claims in cache/config and provider-runtime design docs.
- Keep old Deno research as historical evidence, with a short superseded
  banner where readers might mistake it for current guidance.
- Update manual TUI gates and all examples from `deno task` to npm commands.

**Exit:** no normative document claims Deno executes the application or
enforces Node permissions.

### Phase 7 — native acceptance and first release

- Run the automated OS/Node matrix.
- Complete the manual terminal matrix below.
- Reserve/confirm the npm package identity as part of the first approved
  publish.
- Publish with provenance and verify the registry artifact.

**Exit:** users can install and operate the released package with Node/npm and
without Deno.

## 11. Required Acceptance Matrix

### 11.1 Automated

| Area | Required evidence |
| --- | --- |
| Type safety | `tsc --noEmit` on Node-oriented source |
| Unit/contracts | all migrated tests pass on Node 22 and 24 |
| CLI | JSON snapshots and human output remain byte-identical where specified |
| Cache | old cache schema remains readable; atomic replacement and Windows retry contracts pass |
| Package | exact tarball contents, executable bit/shebang, zero install scripts, zero runtime dependencies |
| npm shim | installed `book-title` works on Windows, Linux, Intel macOS, and Apple Silicon |
| Providers | fixture contracts pass; live Open Library smoke passes separately |
| Security intent | direct environment/filesystem access is confined to adapters; bundle inventory is recorded |

### 11.2 Manual terminal gates

Run the installed tarball, not a source command:

- Windows Terminal on Simplified Chinese Windows:
  - enter `百年孤独`;
  - verify CJK, combining marks, emoji, and ZWJ alignment;
  - verify whether input arrives as UTF-8 or CP936/GB18030;
  - resize rapidly in both layouts;
  - press Ctrl+C during a request;
  - quit normally and after an injected failure;
  - verify cursor, echo, line mode, and alternate screen are restored.
- Intel and Apple Silicon macOS terminals:
  - input, resize, Ctrl+C, normal quit, and restoration.
- Linux terminal:
  - input, resize, Ctrl+C, normal quit, and restoration.

The Windows encoding result must be captured as a regression test in the Node
adapter. It is the highest-risk identified runtime-compatibility question that
primary documentation cannot settle.

## 12. Risk Register

| Risk | Impact | Mitigation/gate |
| --- | --- | --- |
| Runtime permission regression | High, architectural | Explicit ADR approval; zero-runtime-dependency bundle; adapter confinement; do not claim sandbox equivalence |
| Windows raw-input encoding differs from Deno | High for Chinese input | Native Windows Terminal probe and captured adapter test before release |
| Output is truncated by forced process exit | High for CLI correctness | await stream writes and use `process.exitCode`, with partial-write subprocess tests |
| Node filesystem errors classify differently | Medium | map stable error codes and retain denial/corruption/contention contracts |
| `fetch` metadata or abort behavior differs | Medium | unchanged provider fixtures plus live smoke |
| ICU-limited Node build lacks GB18030 behavior | Medium | support official Node builds, minimum-version CI, actionable decoder failure |
| Bundled dependency becomes invisible to consumer audit | Medium | lockfile updates, SBOM/inventory, third-party notices, source map, provenance |
| Package name is taken before release | Medium | confirm during approved initial publish; choose a scope before publication if needed |
| Broad migration obscures behavior changes | Medium | keep assertion adapter, preserve snapshots, split adapter/tooling/distribution commits |
| SEA or native binaries creep back into MVP scope | Low | treat standalone distribution as a separate future decision |

## 13. Conclusion

There is no technical need to rewrite the domain, provider runtime, cache
policy, CLI grammar, coordinator, renderer, or input decoder. The existing
ports have already isolated the runtime-specific work.

The simplest coherent migration is one Node ESM application and one npm
package containing one readable JavaScript bundle. It removes the Node
launcher, four optional platform dependencies, embedded Deno runtimes, and
most of the current 2,000-line distribution subsystem. The main work is a
process/filesystem adapter port, a mechanical test-harness conversion, and
native terminal validation.

The migration has one real product tradeoff: Node 22/24 cannot enforce the
same host-scoped network and name-scoped environment permissions as the
compiled Deno artifact. With that accepted and documented, the proposed
implementation is low risk outside the Windows terminal boundary.

## 14. Primary References

1. Node.js, [Node.js Releases](https://nodejs.org/en/about/previous-releases).
2. Node.js 22, [Global objects](https://nodejs.org/docs/latest-v22.x/api/globals.html).
3. Node.js 22, [TTY](https://nodejs.org/docs/latest-v22.x/api/tty.html).
4. Node.js 22, [Process and signal events](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events).
5. Node.js 22, [File system](https://nodejs.org/docs/latest-v22.x/api/fs.html).
6. Node.js 22, [Permissions](https://nodejs.org/docs/latest-v22.x/api/permissions.html).
7. Node.js 24, [Permissions](https://nodejs.org/docs/latest-v24.x/api/permissions.html).
8. Node.js, [Modules: TypeScript](https://nodejs.org/api/typescript.html).
9. Node.js 22, [Test runner](https://nodejs.org/docs/latest-v22.x/api/test.html).
10. Node.js 22, [Single executable applications](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html).
11. npm, [`package.json`: `bin`, `files`, and `engines`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json).
12. npm, [Lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts#life-cycle-scripts).
13. npm, [`npm pack`](https://docs.npmjs.com/cli/v11/commands/npm-pack).
14. npm, [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements).
15. npm, [Trusted publishing](https://docs.npmjs.com/trusted-publishers).
16. TypeScript, [`rewriteRelativeImportExtensions`](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html).
17. TypeScript, [Modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html).
18. esbuild, [Build and bundle API](https://esbuild.github.io/api/#bundle).
19. `string-width`, [package source and documentation](https://github.com/sindresorhus/string-width).
20. Deno, [`deno compile`](https://docs.deno.com/runtime/reference/cli/compile/).

## 15. Repository References

- [`README.md`](../../README.md)
- [`deno.json`](../../deno.json)
- [`apps/tui/src/main.ts`](../../apps/tui/src/main.ts)
- [`apps/tui/src/tui/terminal.ts`](../../apps/tui/src/tui/terminal.ts)
- [`apps/tui/src/tui/width.ts`](../../apps/tui/src/tui/width.ts)
- [`packages/providers/src/platform/env.ts`](../../packages/providers/src/platform/env.ts)
- [`packages/providers/src/cache/fs-seam.ts`](../../packages/providers/src/cache/fs-seam.ts)
- [`distribution/scripts/compile.ts`](../../distribution/scripts/compile.ts)
- [ADR 0003](../adr/0003-distribute-deno-binaries-through-npm.md)
- [npm release topology](../design/npm-release-topology.md)
- [Deno persistence and permissions research](./deno-persistence-and-permissions.md)
- [npm binary distribution research](./npm-binary-distribution.md)
