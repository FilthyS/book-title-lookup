# npm Release Topology

Frozen design deliverable for GitHub issue #11. It turns the validated npm
distribution mechanics from the issue #4 research document
([docs/research/npm-binary-distribution.md](../research/npm-binary-distribution.md))
and the accepted decision in
[docs/adr/0003-distribute-deno-binaries-through-npm.md](../adr/0003-distribute-deno-binaries-through-npm.md)
into a reproducible release design. This document is the authoritative topology,
naming, metadata, launcher, manifest, gating, and recovery specification for the
release-workflow implementation ticket. It contains no production files or
workflows; those are implemented later from this design.

Open choices are resolved conservatively, as recorded in Section 2. Where the
research marked a behavior as probe-required, this design either removes the
dependency on it or converts it into an implementation-phase validation gate in
Section 11. No design decision here is left open.

## 1. Distribution Contract Carried Forward

ADR 0003, `docs/architecture.md` (Distribution), and issue #4 research fix the
following constraints, which this design does not reopen:

1. npm is the primary installation channel and the only package manager the
   project claims to support.
2. Deno is the application runtime. A published package runs a `deno compile`
   binary and never runs application logic under Node.
3. npm users do not need to install Deno.
4. No binary is downloaded or executed from an npm lifecycle script. Published
   packages have zero lifecycle scripts.
5. Every release publishes a launcher package and one package per supported
   platform at the same version. The same binaries are attached to GitHub
   Releases.
6. Unsupported platforms fail with an actionable message.
7. Registry publishing requires separate, explicit human approval and is never
   part of a normal build.
8. The launcher relays arguments, stdio, signals, and exit codes without
   transforming them.

## 2. Frozen Decisions

| Topic | Frozen resolution |
| --- | --- |
| Package scope | Unscoped package names. Scoping is out of scope for the MVP; a future scope change would be a new distribution identity and is not designed for. |
| Supported package manager | npm only. README and launcher fallback text do not promise pnpm or Yarn behavior. |
| Launcher Node floor | Node `>=18`. Declared in `engines` and enforced by the launcher runtime check. |
| Linux strategy | One `linux-x64` package compiled against the GNU toolchain (glibc). No musl package in the MVP. musl-based systems (for example Alpine) are unsupported and receive the actionable fallback. |
| Launcher-side rehash | Not performed. Distribution integrity relies on npm transport integrity, npm package `integrity`, provenance attestations, and post-publish registry digest comparison. |
| Launcher distribution code | Reserved exit code `70`, distinct from every application outcome code (`0`, `2`, `3`, `4`, `5`, `10`, `130`). |
| Version lockstep | One version stamp per release. Every launcher and platform package, and every pinned `optionalDependencies` entry, carries exactly that version. |
| Provenance | Every published package in a release is provenance-bearing from its first publication of that version. |
| Publish trigger | A separately authorized release operation with explicit human approval. Ordinary build and test tasks are incapable of publishing. |
| Recovery | Publish platform packages first and the launcher last. Failures recover by finishing the wave or bumping forward. Unpublish is excluded from normal recovery. |

## 3. Package Topology and Frozen Names

The launcher package declares one platform package per supported target as an
optional dependency, pinned to the exact release version. Each platform package
contains exactly one compiled binary plus a trivial CommonJS path export. The
platform binary is a data file reached through the platform package `main`; it
is never a `bin` entry.

```text
book-title-lookup@1.2.3                     launcher (npm bin: book-title)
├── bin/book-title.js                       Node launcher (spawner only)
├── package.json
└── optionalDependencies (exact version)
    ├── book-title-lookup-win32-x64@1.2.3   os: win32, cpu: x64
    ├── book-title-lookup-linux-x64@1.2.3   os: linux, cpu: x64
    ├── book-title-lookup-darwin-x64@1.2.3  os: darwin, cpu: x64
    └── book-title-lookup-darwin-arm64@1.2.3 os: darwin, cpu: arm64

book-title-lookup-win32-x64@1.2.3
├── index.js                                module.exports = path to binary
├── bin/book-title.exe
└── package.json

book-title-lookup-linux-x64@1.2.3
├── index.js
├── bin/book-title
└── package.json

book-title-lookup-darwin-x64@1.2.3          same shape; bin/book-title
book-title-lookup-darwin-arm64@1.2.3        same shape; bin/book-title
```

### 3.1 Naming rule (frozen)

The names are final and unscoped:

- launcher: `book-title-lookup`
- platform package rule: `<launcher-name>-<os>-<cpu>`

| Package name | `os` field | `cpu` field | Binary file |
| --- | --- | --- | --- |
| `book-title-lookup-win32-x64` | `win32` | `x64` | `bin/book-title.exe` |
| `book-title-lookup-linux-x64` | `linux` | `x64` | `bin/book-title` |
| `book-title-lookup-darwin-x64` | `darwin` | `x64` | `bin/book-title` |
| `book-title-lookup-darwin-arm64` | `darwin` | `arm64` | `bin/book-title` |

The npm `os` values are Node `process.platform` values (`win32`, `linux`,
`darwin`) and the `cpu` values are Node `process.arch` values (`x64`, `arm64`);
they are the tokens npm's platform filter checks, not free-form names.

There is no alternative or fallback package name. The `optionalDependencies`
keys in the launcher and the `name` fields of the platform packages are the same
literal strings; a mismatch is a release-blocking validation error. Because
registry identity is immutable in practice, these names are fixed before first
publication and never renamed.

## 4. Supported Target Matrix (frozen)

The MVP supports exactly four targets and publishes exactly four platform
packages:

| npm package | Deno compile target | GitHub Actions runner |
| --- | --- | --- |
| `book-title-lookup-win32-x64` | `x86_64-pc-windows-msvc` | `windows-latest` (x64) |
| `book-title-lookup-linux-x64` | `x86_64-unknown-linux-gnu` | `ubuntu-latest` (x64, glibc) |
| `book-title-lookup-darwin-x64` | `x86_64-apple-darwin` | `macos-15-large` (Intel x64) |
| `book-title-lookup-darwin-arm64` | `aarch64-apple-darwin` | `macos-14` (arm64) |

Runner labels are the implementation-time values to use where the architecture
matches; if a hosted runner architecture changes, the label is adjusted while
the target matrix above stays fixed. `linux-arm64`, Windows ARM64, and musl
Linux are not MVP targets. `book-title-lookup-linux-x64` is compiled against
glibc; systems without glibc, including Alpine/musl distributions, are
unsupported and receive the launcher fallback message, not a silent failure.

Cross-compilation detail is decided at implementation time by the build worker:
if `deno compile` produces all four targets from one host, native runners are
used for smoke tests only; if a target must be built natively, its runner builds
that target. In either case the produced binary for each target must be smoke
tested on a runner matching the target (Section 11.3).

## 5. Package Metadata (frozen)

### 5.1 Launcher package

```json
{
  "name": "book-title-lookup",
  "version": "1.2.3",
  "description": "Find attested titles of the same book across languages.",
  "license": "MIT",
  "type": "commonjs",
  "bin": {
    "book-title": "bin/book-title.js"
  },
  "files": [
    "bin/"
  ],
  "engines": {
    "node": ">=18"
  },
  "optionalDependencies": {
    "book-title-lookup-win32-x64": "1.2.3",
    "book-title-lookup-linux-x64": "1.2.3",
    "book-title-lookup-darwin-x64": "1.2.3",
    "book-title-lookup-darwin-arm64": "1.2.3"
  }
}
```

Rules:

- `optionalDependencies` entries are the exact release version, never `^`, `~`,
  or a range. This is the lockstep mechanism.
- `type: "commonjs"` is frozen. The launcher avoids ESM resolution surprises in
  npm-generated shims.
- The launcher file carries a `#!/usr/bin/env node` shebang and the executable
  bit in the packed tarball; npm creates the platform-appropriate bin links
  (POSIX symlink, `.cmd`, and PowerShell shims on Windows).
- `engines.node` documents the `>=18` floor. npm only warns on `EBADENGINE`
  unless the consumer enables `engine-strict`, so the launcher also performs a
  runtime version check and prints an actionable message when Node is older.
- The launcher package declares no lifecycle scripts and no runtime
  dependencies beyond its platform optional dependencies.

### 5.2 Platform package

```json
{
  "name": "book-title-lookup-win32-x64",
  "version": "1.2.3",
  "description": "Platform binary for book-title-lookup (win32/x64).",
  "license": "MIT",
  "type": "commonjs",
  "main": "index.js",
  "files": [
    "index.js",
    "bin/"
  ],
  "os": [
    "win32"
  ],
  "cpu": [
    "x64"
  ]
}
```

The Linux and macOS variants use the same shape with their own `name`, `os`,
`cpu`, and description.

`index.js` is frozen as a trivial path export:

```js
"use strict";
const path = require("node:path");
module.exports = path.join(__dirname, "bin", "book-title.exe");
```

For Linux and macOS the referenced file name is `book-title` without an
extension.

Rules:

- No `bin` entry on a platform package; the launcher is the single documented
  entry point and owns process semantics.
- No `optionalDependencies`, no dependencies, no lifecycle scripts.
- No `libc` field in the MVP because only one Linux package (glibc) exists and
  npm version-dependent `libc` filtering is not needed.
- Unix platform packages ship `bin/book-title` with the executable bit set in
  the tarball. Windows ships `book-title.exe`, where the executable bit is
  irrelevant.
- The `files` lists above are the complete published content. Tarballs contain
  no lockfiles, build cache, source maps, editor files, or credentials.

## 6. Node Launcher Contract (frozen)

### 6.1 Responsibilities

The launcher:

1. checks the Node runtime version against the `>=18` floor;
2. resolves the platform package from `process.platform` and `process.arch`
   through a fixed table of the four supported names;
3. requires the exact platform package name inside `try/catch`;
4. validates that the exported binary path exists and is a regular file;
5. spawns the binary with the user's arguments, inherited environment, and the
   current working directory;
6. relays stdio unmodified;
7. relays termination signals on POSIX;
8. exits with the child's exit code, or reproduces death-by-signal on POSIX;
9. prints an actionable diagnostic on stderr and exits with code `70` on any
   distribution failure.

The launcher does not render TUI state, read stdin, buffer or transform stdout
or stderr, or perform network I/O. It never writes to stdout on success paths,
so `--json` output from the binary stays clean.

### 6.2 Resolution and spawn skeleton

```js
"use strict";
const { spawn } = require("node:child_process");

const PLATFORM_PACKAGES = {
  win32: { x64: "book-title-lookup-win32-x64" },
  linux: { x64: "book-title-lookup-linux-x64" },
  darwin: { x64: "book-title-lookup-darwin-x64", arm64: "book-title-lookup-darwin-arm64" },
};

const DISTRIBUTION_ERROR = 70;

function resolveBinaryPath() {
  const pkg = PLATFORM_PACKAGES[process.platform]?.[process.arch];
  if (!pkg) {
    throw new Error(
      `unsupported platform ${process.platform}/${process.arch}; ` +
      `supported: win32/x64, linux/x64, darwin/x64, darwin/arm64`,
    );
  }
  const binaryPath = require(pkg); // throws if the optional dependency is absent
  const stat = require("node:fs").statSync(binaryPath);
  if (!stat.isFile()) {
    throw new Error(`binary is not a regular file: ${binaryPath}`);
  }
  return binaryPath;
}

function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) {
    console.error(`book-title: requires Node.js >= 18 (found ${process.version})`);
    process.exit(DISTRIBUTION_ERROR);
  }

  let binaryPath;
  try {
    binaryPath = resolveBinaryPath();
  } catch (err) {
    console.error(
      `book-title: ${err.message}\n` +
      "Install the matching platform package by installing book-title-lookup\n" +
      "without --omit=optional. Supported platforms: win32/x64, linux/x64,\n" +
      "darwin/x64, darwin/arm64.",
    );
    process.exit(DISTRIBUTION_ERROR);
  }

  const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });

  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGHUP", () => forward("SIGHUP"));

  child.on("error", (err) => {
    console.error(`book-title: cannot start binary: ${err.message}`);
    process.exitCode = DISTRIBUTION_ERROR;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? DISTRIBUTION_ERROR;
    }
  });
}

main();
```

Notes:

- `require(pkg)` keeps resolution inside npm's normal dependency graph; the
  launcher never scans `node_modules`.
- `stdio: "inherit"` attaches the child to the launcher's own descriptors,
  which is what a full-screen TUI requires and what keeps pipes correct for
  non-TTY automation.
- On POSIX, when the child dies from a signal, Node reports `code === null`;
  reproducing death by the same signal lets the parent shell observe the
  conventional status. On Windows, Ctrl+C is a console control event delivered
  to the attached processes and does not follow the POSIX model; the manual
  Windows Terminal checklist in Section 11.5 validates restoration behavior.
- The application's outcome codes (`0`, `2`, `3`, `4`, `5`, `10`, `130`) pass
  through unmodified. Code `70` is reserved for launcher-level distribution
  failure and is produced only by the launcher.
- No launcher-side checksum or hash verification is performed (Section 2).

### 6.3 Unsupported and incomplete installs

Two distinct situations produce the same actionable result with exit code `70`:

1. the platform is not in the fixed matrix (for example `linux-arm64`); or
2. the matching optional dependency was omitted because the consumer installed
   with `--omit=optional`, an incompatible package-manager setting, or a
   partial node_modules.

The fallback message lists the supported matrix and instructs installing
without `--omit=optional`. It never prints a Node module-not-found stack trace
and never attempts a best-effort spawn of a non-matrix binary.

## 7. Version Stamp and Artifact Manifest (frozen)

### 7.1 Single version stamp

Each release has exactly one version, chosen once and applied everywhere:

- the git tag `v<version>` on the release source commit;
- the `version` field of the launcher and every platform package;
- every `optionalDependencies` entry in the launcher;
- the release's GitHub Release assets;
- the artifact manifest.

No checked-in file holds a separate, divergent version. The release tooling
derives every version reference from the single stamp, and validation fails if
any package version or pinned optional dependency differs from it.

### 7.2 Artifact manifest (frozen)

The build produces, per release version, an artifact manifest recording for
every package in the wave:

- package name;
- exact version;
- packed tarball file name;
- tarball SHA-256;
- npm `integrity` value (sha512);
- the ordered list of files in the tarball with per-file sizes;
- the Deno version used for `deno compile`;
- the `deno compile` target per platform package;
- per-binary size and file hash.

Validation rules:

- the manifest is complete before any package is published; CI fails if any
  platform package is missing;
- post-publish verification compares the published registry digest and
  `dist.integrity` against the manifest;
- a sudden binary size change is a review signal, not an automatic blocker.

## 8. Build-versus-Publish Separation (frozen)

Ordinary builds are structurally incapable of publishing.

- Build and test tasks produce workspace verification, compiled binaries,
  tarballs, and the artifact manifest. They hold no registry credentials, no
  OIDC publish permission, and have no code path that calls `npm publish`.
- Publication is a separate operation: a dedicated release job/workflow that
  (a) runs only from an explicit, human-approved release trigger or workflow
  dispatch carrying a validated `v<version>` stamp, (b) runs under a protected
  environment that requires explicit human approval, and (c) is the only place
  where the publish credential exists.
- A publish job never runs from an ordinary push, pull request, or schedule.
- The dry-run/tarball gates in Section 11 run before the protected publish job
  and also inside it, so the artifact actually published is the artifact that
  was inspected.

## 9. Provenance and Permissions (frozen)

- Every package in a release — the launcher and every platform package — is
  published with npm provenance from its first publication of that version.
  Provenance cannot be added after first publication, so the first publish of a
  version is always provenance-bearing.
- The publish job runs on GitHub Actions against the public npm registry with
  OIDC. The least-privilege permission block for the publish job is
  `contents: read` and `id-token: write`; `id-token: write` is scoped to the
  publish step, and no broader token is needed for provenance.
- The npm automation token is a granular, scope-limited token stored as a
  repository secret and used only by the publish step. It is never used by
  build/test jobs.
- Post-publish verification runs in a separate read-only job that reads from
  the public registry, so publishing credentials are never reused there.
- Every published package has zero lifecycle scripts and the launcher performs
  no network I/O, per Section 5 and 6.

## 10. Publish Order, Retry, and Recovery (frozen)

The registry is content-addressed and version-immutable. The fixed order is:

1. Build all platform packages and the launcher from the same stamped source.
2. Run the full pre-publication gate set (Section 11).
3. Publish every platform package at `x.y.z`.
4. Verify from the public registry that every platform package version exists
   with the expected integrity.
5. Publish the launcher package at `x.y.z` last.

Launcher-last ordering closes the only dangerous window: the launcher never
references a platform version that is not yet visible, so no consumer can
install an incomplete wave through the launcher.

Failure classes and recovery:

- Failure before any publish: no registry state changed; fix and rerun.
- Failure mid-wave with the launcher unpublished: some platform packages exist
  at `x.y.z`. Publish the missing platform packages at the same version, then
  publish the launcher. Harmless intermediate states (orphan platform packages
  with no launcher referencing them) are by design.
- Ambiguous failure (upload may have completed without client confirmation):
  query the registry (`npm view <package>@<version>`) and compare the published
  digest and integrity against the local manifest. A match means the publish is
  complete; a mismatch means the version cannot be reused with different content
  and the release moves to a forward bump.

No-rollback policy: a published version cannot be edited, and `npm unpublish`
is time-limited and damages consumers, so it is excluded from normal recovery.
A broken release is handled by `npm deprecate` to mark the version and point at
the fixed release, then publishing the next version in lockstep across all
packages. The phrase "no rollback fiction" is part of the release checklist:
a release can be superseded or deprecated, but it cannot be recalled cleanly.

## 11. Pre-publication Gates and Implementation Validation

These gates are the acceptance evidence for the release-workflow ticket. They
are run in CI before publication and repeat for the exact artifact to be
published.

### 11.1 Dry-run and tarball inspection

1. `npm pack --dry-run` and `npm publish --dry-run` for each package assert the
   packed file list matches the manifest exactly.
2. Extract each tarball and verify: expected files only; the Linux/macOS
   binaries and the launcher carry the executable bit; the launcher has a
   shebang; no lockfiles, cache, source files, or secrets are present; binary
   size is within the recorded budget.
3. Verify the tarball hash matches the manifest value.

### 11.2 Launcher contract tests with stub binaries

Install the launcher tarball with matching local stub platform tarballs in a
clean project and assert on each supported platform:

- CLI arguments reach the binary unchanged;
- stdout carries only the requested output and stderr carries diagnostics;
- a synthetic application exit code (for example `4`) passes through unchanged;
- the launcher never writes to stdout itself.

### 11.3 Native smoke matrix

Run each natively produced binary on a matching runner:

| Platform package | Smoke runner |
| --- | --- |
| `book-title-lookup-win32-x64` | Windows x64 |
| `book-title-lookup-linux-x64` | Linux x64 (glibc) |
| `book-title-lookup-darwin-x64` | macOS x64 |
| `book-title-lookup-darwin-arm64` | macOS ARM64 |

The smoke run executes the binary directly (not through npm) to prove the
compiled artifact works on its native platform.

### 11.4 Omitted-optional and unsupported fallback

- Install the launcher tarball with `--omit=optional` and assert the actionable
  fallback on stderr and exit code `70`.
- Simulate an unsupported platform (or force the launcher's platform table to
  miss) and assert the same fallback and exit code.

### 11.5 Windows Terminal and signal acceptance

The following remain manual acceptance steps because they cannot be fully
automated: Windows Terminal Chinese IME input, deletion and cursor movement;
wide-character, combining-character, and emoji width; resize-driven layout;
alternate-screen support; terminal restoration after Ctrl+C and exceptions;
and POSIX signal behavior under rapid Ctrl+C and SIGTERM. The Windows Ctrl+C
delivery behavior with a Node launcher plus native child using inherited stdio
is validated against this checklist; it does not change any frozen decision in
this document.

### 11.6 Implementation-phase validations

The remaining probe-required items from issue #4 research are converted into
validation gates, not open design choices:

- all four `deno compile` targets build and run native smoke tests;
- the glibc Linux binary's host requirements are documented after a run on a
  representative supported distribution;
- provenance attestations are present for every published package version;
- the launcher's `>=18` floor and signal handling pass the Section 11.5
  acceptance steps.

Results of these validations are recorded by the release-workflow ticket; none
of them may silently alter the frozen matrix, names, metadata, launcher
contract, or recovery policy in this document.

## 12. Residual Risks

- Registry immutability means a corrupt platform tarball cannot be replaced at
  its version; recovery is a lockstep forward version bump (Section 10).
- Optional dependencies are by definition optional; a consumer can always end
  up with a launcher without a binary, and the fallback message plus exit code
  `70` is the mitigation, not a guarantee.
- Linux is the most fragmented target. The MVP deliberately ships glibc x64
  only; kernel and libc floors are validated at implementation time and recorded
  per release together with the Deno compile version.
- Windows console control events are not POSIX signals; terminal restoration is
  guarded by the manual Windows Terminal checklist.
- npm `engines` is advisory unless the consumer enables `engine-strict`, which
  is why the launcher performs its own runtime floor check.
- Provenance attests to where and how a package was built, not to
  bibliographic correctness; the two meanings are never conflated in
  documentation.

## 13. References

Frozen-input constraints (authoritative):

- `docs/architecture.md` — Distribution, CLI and Process Contract, Permissions,
  Testing.
- `docs/adr/0003-distribute-deno-binaries-through-npm.md` — accepted decision.
- `docs/research/npm-binary-distribution.md` — issue #4 research and decision
  inputs resolved in Section 2.
- `docs/product-spec.md` — product and distribution acceptance criteria.

Primary external documentation consulted by issue #4 research is listed in the
research document's Primary References section and is incorporated here by
reference.
