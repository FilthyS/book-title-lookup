# npm Binary Distribution

Research deliverable for GitHub issue #4 鈥?input to ADR #11. Scope: design and constraints for distributing precompiled `deno compile` binaries through npm with a Node launcher, no install-time downloads, and no second application runtime. Primary documentation was retrieved on 2026-09-05; URLs are listed in the Primary References section. This document reports documented behavior and clearly marks every claim that is inference or still requires a probe. No probe results are reported here. Research only: no release workflow or production files are proposed.

## 1. Purpose and Method

The question under investigation:

> What npm package metadata, optional-dependency behavior, platform naming, launcher semantics, signal forwarding, provenance controls, and CI constraints are required to distribute precompiled Deno binaries without postinstall downloads or a second application runtime?

The deliverable translates the established architecture and ADR 0003 into concrete publication mechanics. Method:

- Derive requirements from `docs/architecture.md` (Distribution, CLI and Process Contract, Permissions, Testing) and `docs/adr/0003-distribute-deno-binaries-through-npm.md`.
- State what npm, Node, Deno, and GitHub Actions document as guarantees.
- State what is inference or unresolved, and what must be probed before ADR #11 can be finalized.
- Report no experimental results, because none were run for this research issue.

The central design constraint is: one application runtime (the Deno-compiled binary), one installation channel (npm), a small Node process spawner, no `postinstall` downloads, and no `install` or `postinstall` scripts in any published package.

## 2. Distribution Contract Inherited from Project Documentation

ADR 0003 and `docs/architecture.md` fix the following requirements:

1. npm is the primary installation channel; Deno remains the application runtime.
2. A small npm launcher selects an OS- and architecture-specific optional dependency.
3. The optional dependency contains a `deno compile` binary.
4. The application is not transpiled into Node; Node does not run application logic.
5. npm users do not need to install Deno separately.
6. No binary is downloaded from an npm lifecycle script.
7. Every release produces a launcher package and one package per supported platform at the same version.
8. The same binaries are attached to GitHub Releases.
9. Unsupported platforms fail with an actionable message.
10. Registry publishing requires separate explicit human approval and is never part of a normal build.
11. The npm launcher must pass through arguments, stdio, signals, and exit codes.
12. Windows Terminal behavior must be tested with Chinese input, wide characters, resize, cancellation, and terminal restoration.

The phrase "no second application runtime" has one important nuance: the launcher executes under Node because npm assumes a Node environment, but the launcher only spawns a process and relays process semantics. All bibliographic, terminal, and provider logic runs in the Deno-compiled binary.

## 3. Package Topology

The root launcher package declares platform packages as optional dependencies. Each platform package contains one compiled binary and a tiny CommonJS entry point that exports the binary's absolute path.

```text
book-title-lookup@1.2.3                     root launcher (npm bin)
鈹溾攢鈹€ bin/book-title.js                       Node launcher (spawner only)
鈹溾攢鈹€ package.json
鈹斺攢鈹€ optionalDependencies (exact version)
    鈹溾攢鈹€ book-title-lookup-win32-x64@1.2.3   os: win32, cpu: x64
    鈹溾攢鈹€ book-title-lookup-linux-x64@1.2.3   os: linux,  cpu: x64
    鈹溾攢鈹€ book-title-lookup-darwin-x64@1.2.3  os: darwin, cpu: x64
    鈹斺攢鈹€ book-title-lookup-darwin-arm64@1.2.3 os: darwin, cpu: arm64

book-title-lookup-win32-x64@1.2.3
鈹溾攢鈹€ index.js                                module.exports = path to binary
鈹溾攢鈹€ bin/book-title.exe
鈹斺攢鈹€ package.json

book-title-lookup-linux-x64@1.2.3
鈹溾攢鈹€ index.js
鈹溾攢鈹€ bin/book-title
鈹斺攢鈹€ package.json

book-title-lookup-darwin-x64@1.2.3          same shape
book-title-lookup-darwin-arm64@1.2.3        same shape
```

The topology depends on a documented npm behavior: packages whose `os`/`cpu` (and where supported, `libc`) metadata does not match the installing platform are skipped when they are optional dependencies, and a normal install continues. This is the same mechanism npm itself uses for platform-specific native packages.

### 3.1 Naming Rule and Scope Fallback

The name rule for a platform package is:

```text
<root-package-name>-<process.platform os token>-<cpu token>
```

Mapping the four planned packages:

| npm name suffix | `os` field | `cpu` field | Deno target |
| --- | --- | --- | --- |
| `-win32-x64` | `win32` | `x64` | `x86_64-pc-windows-msvc` |
| `-linux-x64` | `linux` | `x64` | `x86_64-unknown-linux-gnu` |
| `-darwin-x64` | `darwin` | `x64` | `x86_64-apple-darwin` |
| `-darwin-arm64` | `darwin` | `arm64` | `aarch64-apple-darwin` |

The npm `os` tokens must match the values used by npm's platform check, which correspond to Node `process.platform` values (`win32`, `darwin`, `linux`). They are not free-form names. `cpu` tokens correspond to `process.arch` values (`x64`, `arm64`).

Fallback if scope or naming differs: the `optionalDependencies` keys and the platform packages' `name` fields must match exactly. If the project later adopts a scope, the consistent rule becomes:

```text
@<scope>/<root-name>
@<scope>/<root-name>-<os>-<cpu>
```

Scoping must be decided before first publication. Renaming a published package is effectively a permanent fork of distribution identity; npm does not provide a rename operation that preserves history or existing dependents. A scope would not change any launcher logic except the strings in `optionalDependencies` and the module specifier.

## 4. `package.json` Sketches

### 4.1 Root launcher package

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

Key points:

- `optionalDependencies` entries are pinned to the exact release version, never `^` or `~`. This is the mechanism that keeps the root launcher and platform binaries in lockstep even when versions are consumed beside other packages.
- The launcher file needs an executable bit and a `#!/usr/bin/env node` shebang when packed; npm creates the platform-appropriate bin links from the `bin` map.
- `engines.node` documents a floor. npm only warns on `EBADENGINE` unless the user configures `engine-strict`, so `engines` is documentation and a runtime guard, not an install-time guarantee.
- "commonjs" is deliberate: a launcher should avoid `"type": "module"` dependency resolution surprises under older npm-generated shims.

### 4.2 Platform package

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

`index.js` is intentionally trivial:

```js
"use strict";
const path = require("node:path");
module.exports = path.join(__dirname, "bin", "book-title.exe");
```

For Linux and macOS the referenced file name is `book-title` with no extension.

Platform packages should not declare a `bin` entry. The compiled binary must be started by the root launcher so that a single documented entry point owns argument, stdio, and signal semantics. A platform package should also not declare `optionalDependencies` of its own.

### 4.3 `os`, `cpu`, `libc`, and `engines` semantics

- `os`: an array of allowed operating systems. npm checks values against the installing platform.
- `cpu`: an array of allowed CPU architectures.
- `libc`: an array of allowed libc implementations. npm added libc-aware filtering in a modern npm release; package managers that predate that support ignore the field. The exact minimum npm version must be confirmed during the probe phase.
- Linux detection of libc at runtime in the launcher is available through `process.report.getReport().header.glibcVersionRuntime`; presence on glibc Linux and its absence elsewhere must be probed for the supported Node versions.

When a package's constraints do not match, npm prints an `EBADPLATFORM`-style warning. For optional dependencies the install continues and the package is omitted. This is the documented mechanism the topology relies on, and the reason an unsupported-platform install can still succeed at npm level while producing a launcher that must explain the failure at runtime.

## 5. Launcher Semantics

### 5.1 Role

The launcher has exactly these responsibilities:

1. Resolve and validate the platform package.
2. Spawn the Deno binary with the user's arguments.
3. Relay stdio unmodified.
4. Relay termination signals where the platform permits.
5. Exit with the binary's exit code, or reproduce death-by-signal on POSIX.
6. Print actionable diagnostics on stderr if the binary is missing or the platform is unsupported.

The launcher must not render TUI state, read stdin itself, transform output, or manage the terminal. The terminal belongs to the child.

### 5.2 Binary resolution

Resolution order:

1. Read `process.platform` and `process.arch`.
2. Map them through a fixed table to a platform package name (`book-title-lookup-win32-x64`, and so on).
3. On Linux, optionally inspect `glibcVersionRuntime` to distinguish glibc from musl if musl packages are adopted.
4. `require` the platform package inside a `try/catch`.
5. Validate that the exported path exists and is a regular file.
6. On any failure, write an actionable message to stderr and exit with a reserved distribution error code.

The launcher must not discover binaries by scanning `node_modules`. Requiring the exact module name keeps resolution inside npm's normal dependency graph and avoids accidentally executing a binary from an unrelated installation.

### 5.3 Spawn behavior

```js
const { spawn } = require("node:child_process");

const binaryPath = resolveBinaryPath(); // throws an actionable Error
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});
```

- `process.argv.slice(2)` preserves the exact arguments, including flags, `--`, and positional CLI values.
- `stdio: "inherit"` attaches the child directly to the parent's stdin, stdout, and stderr descriptors. This is required for a full-screen TUI (raw mode, cursor control, alternate screen) and keeps pipe behavior correct for non-TTY automation because the descriptors, not Node buffers, are shared.
- The child inherits the environment and current working directory by default; the launcher must not alter them.
- The launcher must not consume stdin, because the TUI owns the terminal.

### 5.4 Signal forwarding and exit-code propagation

The child should remain in the same process group as the launcher so that a terminal Ctrl+C reaches both processes. On POSIX, the launcher also forwards `SIGINT`, `SIGTERM`, and `SIGHUP` explicitly so that signals sent only to the launcher process still reach the child.

Recommended skeleton, to be confirmed by probes:

```js
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
  process.exitCode = 70; // launcher-level distribution error, reserved
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
```

Documented and inferred points:

- On POSIX, when a child exits because of a signal, Node reports `code === null` and a `signal` string. Reproducing death by the same signal (`process.kill(process.pid, signal)`) is the way to let the parent shell observe the conventional 128+signal status rather than a synthetic code.
- On Windows, `child.kill()` terminates the process; Windows does not have POSIX signals. Ctrl+C in a console is delivered as a console control event to processes attached to the console. The launcher must not assume `child.kill("SIGINT")` behaves like POSIX. The exact Windows Ctrl+C behavior when a Node parent spawns a native child with inherited stdio must be probed on Windows Terminal as part of the acceptance checklist.
- The launcher should wait for the child to exit before exiting itself. If the launcher exits immediately on a signal while the child is still performing cleanup, npm or a shell may consider the command finished and the terminal may be restored before the child finishes.
- The application's documented exit codes (0, 2, 3, 4, 5, 10, 130) are owned by the Deno binary and must pass through unmodified.
- A missing platform package is not one of the application's semantic outcomes. It is a distribution failure. The launcher should use a reserved launcher-only code (the sketch uses 70) so that scripts can distinguish "binary distribution problem" from lookup outcomes. This reservation should be recorded as an ADR #11 input.

### 5.5 Unsupported platform and omitted optional dependency

Two distinct runtime cases must produce the same actionable result:

1. The platform is not in the matrix (for example `linux-arm64` before such a package ships).
2. The user installed with `--omit=optional`, or the package manager omitted the optional dependency for another reason.

In both cases the launcher prints to stderr a message listing supported platforms and explaining that `book-title-lookup` must be installed without `--omit=optional`, then exits with the launcher-level error code. This mirrors the ADR consequence: unsupported platforms fail with an actionable message, not a module-not-found stack trace.

### 5.6 `--json` and non-TTY guarantees

These guarantees belong to the Deno binary and are preserved automatically when stdio is inherited:

- diagnostics to stderr;
- JSON data to stdout;
- no prompts under `--json`;
- no full-screen TUI for non-TTY output.

The launcher must not introduce its own stdout output on success paths, because that would corrupt `--json` output. All launcher diagnostics belong on stderr.

## 6. Package-Manager Installation Behavior

### 6.1 npm (documented baseline)

npm is the reference package manager for this design:

- Optional dependencies that do not match the platform's `os`/`cpu`/`libc` are skipped with an unsupported-platform warning, and npm continues.
- Matching optional dependencies are installed normally.
- `npm install --omit=optional` omits all optional dependencies, producing the runtime fallback described above.
- npm verifies package integrity from the lockfile/registry `integrity` field by default.
- npm creates bin shims from the root package's `bin` map: a POSIX symlink/script on Unix-like systems, and `.cmd` plus PowerShell shims on Windows.

This behavior is the documented foundation of the platform-optional-dependency pattern and must be exercised with tarball-based install tests before release.

### 6.2 pnpm

pnpm supports `os`, `cpu`, and (in current versions) `libc`-aware resolution and `supportedArchitectures` configuration. pnpm's lockfile representation and its handling of platform-specific optional dependencies differ from npm's. The behavior relevant to this design, including whether an installing user gets exactly one matching platform package and whether `--omit=optional` or equivalent settings are honored, must be confirmed by probe. pnpm-specific claims are therefore marked as inference until probed.

### 6.3 Yarn

Yarn Classic's and Yarn Berry's handling of `os`/`cpu`/`libc` optional dependencies is not assumed equivalent to npm. In particular, Yarn's Plug'n'Play resolution changes how `require("book-title-lookup-linux-x64")` resolves. Package-manager parity is not an MVP blocker because npm is the reference channel, but the README and launcher fallback message should not promise Yarn/pnpm behavior until it is probed.

### 6.4 Consequence: the launcher is the safety net

All three package managers have some path that omits an optional dependency. The publication design must therefore treat npm's optional-dependency skipping as the supported mechanism and the launcher's actionable message as the required backstop. A release must never assume that every install is complete.

## 7. Executable Bits, Windows Shims, and Tarballs

- npm derives the top-level command from the `bin` map in the root package. On Windows, npm generates a shell shim (`book-title`), a cmd shim (`book-title.cmd`), and a PowerShell shim (`book-title.ps1`) in `node_modules/.bin` (or the global prefix bin directory). These shims invoke the Node launcher; they are not the Deno binary.
- The Deno binary inside a platform package is not a `bin` entry. It is a data file referenced through `main`.
- Unix platform packages need the binary file to be executable in the packed tarball. Windows packages need a `.exe`, where the executable bit is irrelevant.
- npm normalizes some file modes when packing. The project must assert, in tarball tests, that:
  - `book-title.js` carries a shebang and is executable after install;
  - the Linux and macOS `bin/book-title` files have the executable bit in the tarball;
  - no files beyond the declared `files` lists appear in the tarballs;
  - tarballs contain no lockfiles, cache directories, source maps from unrelated code, editor files, or credentials.
- Tarball inspection is performed with `npm pack` (and `npm pack --json` where available), followed by extraction and mode checks. `npm publish --dry-run` performs the same packaging logic and is the final pre-publication gate.

## 8. Deno Compile Target Matrix

`deno compile` produces a self-contained executable. The targets required by the topology:

| npm package | `deno compile --target` |
| --- | --- |
| `book-title-lookup-win32-x64` | `x86_64-pc-windows-msvc` |
| `book-title-lookup-linux-x64` | `x86_64-unknown-linux-gnu` |
| `book-title-lookup-darwin-x64` | `x86_64-apple-darwin` |
| `book-title-lookup-darwin-arm64` | `aarch64-apple-darwin` |

Open points to confirm against Deno documentation at implementation time:

- whether `deno compile` cross-compiles every supported target from a single host, or whether some targets must be built on native runners;
- whether musl Linux targets (`*-unknown-linux-musl`) are supported for `deno compile` output, which determines whether a separate musl npm package is possible;
- the glibc linkage of the GNU-target binary, which determines whether `book-title-lookup-linux-x64` runs on Alpine/musl distributions;
- the compiled binary's minimum host requirements (for example, older Linux kernels or macOS version floors).

The Linux libc question is a genuine decision input to #11, not a detail:

- Option A: publish one Linux x64 package, target the GNU toolchain, and treat musl distributions as unsupported with an actionable message or a GitHub Release asset fallback.
- Option B: publish separate glibc and musl packages named distinctly (for example `...-linux-x64` and `...-linux-x64-musl` or `...-linux-x64-gnu`), with `libc` metadata where the package manager supports it and launcher-side runtime detection where it does not.

Option B raises the release complexity materially and depends on Deno producing a musl `deno compile` output. The probe phase must determine Deno's actual musl support before ADR #11 can choose.

## 9. Lockstep Versions and Checksums

### 9.1 Version lockstep

The invariant from ADR 0003 is: the root launcher package and every platform package have the same version in a release.

Enforcement mechanisms:

- one release stamp (a single version decided once per release);
- `optionalDependencies` pinned to that exact version in the root package;
- a build manifest that records, per version: package name, tarball name, tarball SHA-256, npm `integrity` (sha512), file list, and per-file sizes;
- CI failing if any platform package is missing from the manifest.

### 9.2 Integrity and checksums

npm records `integrity` in lockfiles and verifies it on install by default. That protects installs against tampering during transport. The registry also publishes the tarball with its own digest. The project should additionally keep the build manifest described above so that post-publish verification can compare the published `dist.integrity` and tarball digest against locally computed values.

An extra launcher-side checksum check (the launcher recomputing a file hash before spawn) is possible but expensive for large binaries. It is not required given npm integrity and Sigstore-backed provenance; whether to add it is an ADR #11 input. If adopted, the checksum must be embedded at build time and must not become a release-blocking mismatch on platforms where the binary is legitimately signed or modified by the distributor.

## 10. Provenance, Attestations, and Least-Privilege Tokens

### 10.1 npm provenance

npm's provenance publication is the mechanism that ties a published tarball to the exact GitHub Actions workflow run that produced it.

Documented conditions:

- publication must happen through GitHub Actions;
- the publishing workflow/job must have OIDC permission (`id-token: write`);
- publishing must target the public npm registry;
- provenance is attached at `npm publish` time with the `--provenance` flag;
- provenance cannot be added to a version after it was first published, so the first publish of each version must already be provenance-bearing.

The resulting attestation lets consumers verify where and how the package was built. Verification paths include inspecting the published attestation metadata and npm's signature verification commands. The exact verification commands and output shapes must be exercised in CI post-publish checks.

### 10.2 GitHub Actions least privilege

The publish job should be the only job with `id-token: write`, and only for the step that publishes:

```yaml
permissions:
  contents: read
  id-token: write
```

Recommended controls:

- the publish job runs only from a protected environment (for example a `release` environment) that requires explicit human approval, satisfying the repository rule that publishing is a separately authorized operation;
- the publish job is gated on an explicit release trigger or an approved workflow dispatch with a validated version, not on every push;
- the npm automation token is a granular access token limited to the publishing scope, stored as an Actions secret, and used only in the publish step;
- no broader repository write token is needed for provenance; provenance uses OIDC rather than a long-lived signing key;
- after publish, verification runs from a separate job that reads from the public registry so that publishing credentials are not reused.

### 10.3 Supply-chain posture

Because the platform package binaries are the security-sensitive payload:

- provenance must be attached to every package in a release, including every platform package, not only the root launcher;
- every package must have zero lifecycle scripts (`install`, `postinstall`, `preinstall`) so that no code executes at install time;
- the launcher must contain no network code;
- CI must publish tarballs built from clean, tagged source with locked development dependencies.

## 11. Release Order, Retry, Recovery, and No-Rollback Fiction

### 11.1 Publish order

The registry is content-addressed and version-immutable. The required order is:

1. Build all platform packages and the root launcher from the same source stamp.
2. Run tarball and launcher contract tests.
3. Publish every platform package at version `x.y.z`.
4. Verify from the public registry that every platform package version exists with the expected integrity.
5. Publish the root launcher package at `x.y.z` last.

Root-last ordering closes the only dangerous window: the root package must never reference a platform version that is not yet visible. If a user installs `book-title-lookup@x.y.z` before its platform packages are published, npm may resolve an incomplete set of optional dependencies.

### 11.2 Retry and partial-failure recovery

Publish failures fall into classes:

- Failure before any package is published: no registry state changed; rerun after fixing the cause.
- Failure mid-wave: some platform packages at `x.y.z` exist. Recovery is to publish the missing platform packages at the same version and then the root launcher. This is safe because the root package was not yet published and no consumer could have installed the incomplete wave through the root package.
- Ambiguous failure: `npm publish` performs the upload but the client does not receive confirmation. Retrying the same version may produce a conflict response rather than success. Recovery requires querying the registry (`npm view <package>@<version>`) and comparing the published tarball digest and integrity against the local manifest. If they match, treat the publish as complete; if they do not, the version cannot be reused with different content.

No multi-package atomic transaction exists on the registry. The wave must be designed so that every intermediate state is either harmless (a few orphan platform packages at a version with no root launcher referencing it) or recoverable (finish the wave).

### 11.3 No-rollback fiction

A published version cannot be edited. npm's unpublish facility is time-limited and damages consumers; it must not be part of the normal recovery plan, and repository documentation should say so explicitly. Broken releases are handled by:

- `npm deprecate` to mark a package version as broken and point consumers at the fixed version;
- publishing a new version `x.y.(z+1)` (or `x.(y+1).0`) for every package in lockstep;
- documenting the incident.

The phrase "no rollback fiction" should appear in the release checklist: a release can be superseded or deprecated, but it cannot be recalled cleanly, so pre-publication gates carry the safety burden.

## 12. CI Build and Test Matrix

The distribution CI should contain at least these jobs:

1. **Workspace verification**: `deno task fmt:check`, lint, type check, and automated tests for core, providers, and TUI/CLI, on the supported Deno version.
2. **Binary build**: produce the four `deno compile` targets, recording output size, file hash, and the exact Deno version. If Deno cross-compiles all targets from one host, a single Linux runner can produce all binaries and native runners are only needed for smoke tests.
3. **Native smoke matrix**: run each natively produced binary on a matching runner:

| Platform package | Expected runner |
| --- | --- |
| `win32-x64` | Windows x64 runner |
| `linux-x64` | Linux x64 runner |
| `darwin-x64` | macOS x64 runner |
| `darwin-arm64` | macOS ARM64 runner |

   The macOS ARM64 runner label must be confirmed at implementation time because hosted runner architecture availability changes.

4. **Launcher contract matrix**: on each runner, install a root launcher tarball paired with stub platform packages (and, in a second case, with the platform package omitted) and assert:
   - CLI arguments reach the binary unchanged;
   - stdout carries only the requested output;
   - stderr carries diagnostics;
   - a synthetic exit code passes through unchanged;
   - Ctrl+C (manual or scripted where the runner supports it) restores the terminal and exits conventionally on Windows Terminal;
   - the unsupported/omitted fallback message appears on stderr with the reserved code.
5. **Publish job**: single job, protected environment, `id-token: write`, publishes platform packages then the root launcher.
6. **Post-publish verification**: from a separate job with read-only credentials, for every package at the release version, assert: version exists; tarball digest matches the manifest; provenance attestation exists; a clean `npm install` of the root package on each supported runner produces a working `book-title` command.

Windows Terminal manual checks (Chinese IME input, wide-character rendering, resize, alternate screen, terminal restoration) cannot be fully automated and remain part of the acceptance checklist rather than the CI matrix.

## 13. Security Controls

- Zero lifecycle scripts in every published package. No `postinstall` downloads, no `preinstall` logic, no `install` scripts. This is both a distribution principle and an attack-surface reduction.
- The launcher performs no network I/O and reads no environment secrets.
- Publish tokens are granular, scope-limited, stored as repository secrets, and used only in the publish step.
- Provenance is attached to all packages through OIDC, and the publish job grants `id-token: write` only where needed and `contents: read` otherwise.
- CI builds from tagged source with locked dependencies; devDependencies are not published because `files` restricts package content.
- Post-publish verification compares published digests to the locally recorded build manifest.
- A documented residual risk: npm integrity protects transport, and provenance ties the tarball to the build, but neither protects against a compromised maintainer environment or a compromised publish credential. Environment protection rules and human approval gate mitigate this.
- A second residual risk: Node module resolution can be influenced by adjacent `node_modules` directories. Since the launcher requires a declared optional dependency of its own package, this risk is low, but the launcher should still validate that the resolved path is a regular file before spawning.

## 14. Dry-Run and Tarball Tests

Pre-publication gates, all runnable in CI:

1. `npm pack --dry-run` (or `npm publish --dry-run`) for each package asserts the file list matches the manifest exactly.
2. Extract each tarball and verify:
   - expected files only;
   - Linux/macOS binaries are executable;
   - the launcher has a shebang;
   - no unexpected directories, lockfiles, source files, or secrets;
   - binary size is within a recorded budget (a sudden size change is a review signal).
3. Local tarball installation tests: install the root tarball with matching local platform tarballs in a clean project and run the launcher against stub binaries that echo arguments and exit with known codes.
4. Omitted-optional test: install the root tarball without optional dependencies and assert the actionable fallback and reserved exit code.
5. Integrity test: compare the packed tarball hash with the value recorded in the build manifest.
6. Before every release, run the full acceptance checklist from the product specification that applies to the distribution channel, including version-string checks and the npm launcher tests for platform, argument, signal, and exit-code behavior.

## 15. Guarantees versus Observations and Inference

### 15.1 Documented (primary sources)

- npm supports `bin`, `os`, `cpu`, `libc`, `engines`, and `optionalDependencies` in `package.json`; the `libc` field is newer and its minimum supported npm version must be confirmed.
- npm skips platform-incompatible optional dependencies with an unsupported-platform warning and continues the install.
- npm generates platform-appropriate bin shims, including `.cmd` and PowerShell shims on Windows.
- npm verifies package integrity from the lockfile on install.
- `npm publish --provenance` exists and requires GitHub Actions, OIDC permission, and the public registry; provenance cannot be attached after first publication of a version.
- Node's `child_process.spawn` supports `stdio: "inherit"`, argument arrays, `error` and `exit` events, and `child.kill()`.
- Node reports child exit either as a code or, on POSIX signal death, as `code: null` with a `signal` string.
- `deno compile` produces self-contained executables and supports a `--target` option.
- The project's own ADR 0003 fixes the npm-channel, platform-optional-dependency, same-version, no-postinstall architecture.

### 15.2 Inference (reasonable but unprobed)

- The exact behavior of every supported npm/pnpm/yarn version at the retrieval date.
- That all four Deno targets can be cross-compiled from a single CI host.
- That provenance attestations are verifiable through the same commands on all supported package-manager versions.
- That the recommended POSIX signal-forwarding pattern behaves cleanly during rapid Ctrl+C and SIGTERM races.

### 15.3 Open, probe-required

- Deno musl support for `deno compile`, and therefore whether a musl Linux npm package is feasible.
- The glibc linkage and minimum host requirements of GNU-target `deno compile` binaries.
- npm's exact minimum version for `libc` field filtering.
- Yarn Classic and Yarn Berry handling of `os`/`cpu`/`libc` optional dependencies, especially under Plug'n'Play.
- pnpm's lockfile behavior and `supportedArchitectures` interaction with this topology.
- Windows Ctrl+C delivery to a Node launcher plus native child with inherited stdio.
- The behavior of `process.report.getReport().header.glibcVersionRuntime` across supported Node versions and platforms.
- macOS ARM64 hosted runner availability and labels for the CI matrix.

No probe results are reported because no probes were executed. The probes above are the minimal set ADR #11 needs before the release workflow is built.

## 16. Concrete Decision Inputs to ADR #11

1. Confirm the six package names are final before first publication, including whether the name is scoped, since rename is effectively impossible afterward.
2. Select the Linux strategy: one GNU-target x64 package with actionable unsupported messaging for musl, or separate glibc/musl packages whose feasibility depends on Deno musl compile support.
3. Decide whether the launcher supports only the documented matrix or also a "best-effort spawn" path for future packages such as `linux-arm64`.
4. Reserve a launcher-level exit code for distribution failure (the sketch uses 70) and document that it is distinct from the application's semantic exit codes.
5. Decide whether launcher-side binary hash verification is required in addition to npm integrity and provenance.
6. Define the release stamp source of truth (for example a single `version` file or tag) and the rule that platform packages publish before the root launcher.
7. Specify the provenance policy: all packages provenance-bearing from their first publication, published from a protected environment with `id-token: write` only in the publish job.
8. Adopt the no-rollback policy: deprecate-and-bump forward, with unpublish explicitly excluded from normal recovery.
9. Authorize the probe set in Section 15.3 as the acceptance evidence for the package-manager and Windows signal claims, and record results in the ADR.
10. Confirm the minimum supported Node version for the launcher and document that `engines` is advisory unless consumers enable `engine-strict`.
11. Decide whether pnpm and Yarn are supported claims in the README or explicitly out of scope until probed.

## 17. Residual Risks

- Registry immutability means a corrupt platform tarball cannot be replaced at its version; recovery requires a lockstep version bump across all packages.
- Optional dependencies are, by definition, optional. A consumer environment can always produce a launcher without a binary; the fallback messaging and reserved exit code are the mitigation, not a guarantee.
- npm's install-time platform filtering depends on package-manager versions. The oldest supported npm version must be defined and tested.
- Linux is the most fragmented target: glibc vs musl, kernel floors, and older distribution libc versions can produce runtime failures that pass CI on current runners.
- macOS binary portability across OS versions must be validated on a representative minimum supported macOS version, not only on the newest runner.
- Windows console control events and Node's signal emulation are not equivalent to POSIX signals; terminal restoration after Ctrl+C must be validated manually on Windows Terminal.
- Provenance attests to where and how a package was built; it does not certify bibliographic correctness. Mixing up those two meanings would overstate what distribution guarantees.
- The Deno version used to compile must be recorded per release because future Deno versions may change binary size, target support, or minimum host requirements.

## 18. Primary References

Information state: retrieved 2026-09-05. URLs are the primary documentation locations; subsection anchors are omitted where they are known to move.

### npm

- package.json specification (`bin`, `os`, `cpu`, `libc`, `engines`, `optionalDependencies`): https://docs.npmjs.com/cli/v10/configuring-npm/package-json
- `npm install` (optional dependencies, omit behavior): https://docs.npmjs.com/cli/v10/commands/npm-install
- `npm pack`: https://docs.npmjs.com/cli/v10/commands/npm-pack
- `npm publish` (including `--dry-run` and `--provenance`): https://docs.npmjs.com/cli/v10/commands/npm-publish
- npm provenance statements: https://docs.npmjs.com/generating-provenance-statements
- Signature verification: https://docs.npmjs.com/cli/v10/commands/npm-audit-signatures
- Unpublish policy (time limits and consumer impact): https://docs.npmjs.com/policies/unpublish
- `npm deprecate`: https://docs.npmjs.com/cli/v10/commands/npm-deprecate
- Access tokens and scoped publication: https://docs.npmjs.com/about-access-tokens

### Node.js

- `child_process` (`spawn`, stdio options, `error`/`exit` events, `subprocess.kill`): https://nodejs.org/api/child_process.html
- `process` (platform, arch, argv, exit codes, signal events, `process.kill`): https://nodejs.org/api/process.html

### Deno

- `deno compile` (output, `--target`): https://docs.deno.com/runtime/reference/cli/compile/

### GitHub Actions and OIDC

- Workflow permissions syntax: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions
- OIDC security hardening and `id-token`: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- Hosted runner image and architecture availability: https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners

### Project documentation (authoritative constraints, not external references)

- `docs/architecture.md` 鈥?Distribution, CLI and Process Contract, Permissions, Testing.
- `docs/adr/0003-distribute-deno-binaries-through-npm.md` 鈥?accepted distribution decision.
- `docs/product-spec.md` 鈥?npm launcher and distribution acceptance criteria.
