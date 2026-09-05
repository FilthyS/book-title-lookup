# Book Title Lookup

Find attested titles of the same book across languages.

> [!NOTE]
> The project is in its design and initial scaffolding stage. No npm package or
> runnable lookup application has been released yet.

Book Title Lookup starts with a title—initially a Chinese title—and identifies
the written work before looking for titles used by real editions in other
languages. It is a bibliographic lookup tool, not a machine title translator.

## Planned MVP

- English full-screen TUI and non-interactive CLI
- Search by Chinese title with optional author, ISBN, and publication year
- Interactive work disambiguation
- One or more target-language filters
- Evidence-backed titles grouped by language
- Source details and explainable evidence levels
- Open Library and Wikidata integration
- Partial results when one source is unavailable
- Local HTTP cache and stale-cache offline fallback
- Stable JSON output for scripts
- Windows, Linux, and macOS builds
- npm installation through platform-specific precompiled Deno binaries

Machine-generated title suggestions, accounts, query history, a hosted backend,
and a public provider plugin API are explicitly outside the MVP.

## Design

- [Domain language](./CONTEXT.md)
- [Product specification](./docs/product-spec.md)
- [Architecture](./docs/architecture.md)
- [Data-source evaluation](./docs/data-sources.md)
- [Architecture decisions](./docs/adr/)

## Repository Shape

The planned Deno workspace has three members:

```text
apps/tui
packages/core
packages/providers
```

The TUI is the composition root. Core owns the domain model and lookup use
cases. Providers own external API, HTTP, and cache concerns. There is no local
or hosted HTTP service in the MVP.

## Data Sources and Accuracy

Open Library is the primary bibliographic source. Wikidata supplements identity
and edition evidence. Their records are community-maintained and may be
incomplete, duplicated, incorrectly merged, or incorrectly classified.

Every returned title must retain its source and evidence. The application does
not claim that the recommended result is an official, exclusive, or universally
preferred translation.

This project is not endorsed by Open Library, the Internet Archive, Wikimedia,
or Google.

## Issue Tracker

Tickets, status, dependencies, assignment, and discussion live on
[GitHub Issues](https://github.com/FilthyS/book-title-lookup/issues). See the
[issue tracker governance](./docs/agents/issue-tracker.md) for labels and the
worker lifecycle.

## Development

Deno 2.9 or newer is recommended. The dependency lockfile is committed.

The root `deno.json` defines the workspace members `apps/tui`,
`packages/core`, and `packages/providers` plus the shared task surface.
Every task runs without `-A`; runtime permissions follow the closed
environment allowlist and the resolved fixture/cache roots.

```console
deno task fmt          # format workspace sources
deno task fmt:check   # fail when formatting drifts
deno task lint        # lint workspace sources
deno task check       # type-check workspace sources
deno task test        # run workspace tests
```

The maintenance CLI is runnable from source:

```console
deno task cli:help       # deno run apps/tui/src/main.ts --help
deno task cli:version    # deno run apps/tui/src/main.ts --version
deno run apps/tui/src/main.ts config show [--json]
deno run apps/tui/src/main.ts cache list|show <digest>|clear [--json]
```

The current build implements the configuration/cache seam, the maintenance
surface (`config show`, `cache list`, `cache show`, `cache clear`, `--help`,
`--version`, and the global options), and the Open Library vertical slice:
`search`, `resolve`, and `titles` dispatch through Core's catalog service
composed over the real Open Library adapter, runtime, and HTTP cache.
Fixture-backed CLI contract tests inject the module-level fake explicitly;
the production composition root defaults to the real source.

Real-source lookup requires the matching grants, for example:

```console
# coordinator-authorized live smoke; identified runs require a contact
deno task test:live-smoke
# or run the CLI directly against Open Library with a scratch cache
$env:BOOK_TITLE_CACHE_DIR="./cache-tmp"; $env:BOOK_TITLE_CONTACT="you@example.com"
deno run --allow-net=openlibrary.org apps/tui/src/main.ts search --title 百年孤独 --json
```

### Distribution (build only; never publishes)

The distribution slice packages the application as release-shaped artifacts
and runs the dry-run/tarball gates (ticket #20 / section 6.6;
docs/design/npm-release-topology.md). None of the commands below can publish:
there is no `npm publish` path, no registry token, and no publish workflow.

**Single version stamp.** Every package in a release carries exactly one
version, derived in precedence order:

1. the `BOOK_TITLE_RELEASE_VERSION` environment variable (explicit override), then
2. the exact git tag `v<version>` on `HEAD`, then
3. the default development stamp, in lockstep with the app's `0.1.0` version.

The source templates under `distribution/npm/` keep the placeholder `0.0.0`;
only generated (stamped) copies under `dist/` carry a real version.

**Launcher contract tests** run the real Node launcher against a native stub
binary and are excluded from the fast `deno task test` suite (they need `node`
and a one-off `deno compile`). Run them with the dedicated root task that CI
and the verify workflow invoke:

```console
deno task test:launcher
```

**Compile, pack (dry-run), manifest, verify.** Compile a target with
`deno compile` (native smoke runs the result directly, product gate G10). On a
single non-native host, pass `--stubs` to fill the other platform packages
from the committed fixture stubs so the whole tarball/manifest pipeline can be
exercised without cross-compiling:

```console
# native win32/x64 compile (product gate G10)
deno run --allow-run=deno --allow-read --allow-write \
  distribution/scripts/compile.ts --target x86_64-pc-windows-msvc

# produce npm package trees + tarballs under dist/ (never publishes)
deno run --allow-env=BOOK_TITLE_RELEASE_VERSION --allow-run=npm,git \
  --allow-read --allow-write distribution/scripts/pack.ts --dry-run --stubs

# write the artifact manifest (names, versions, tarball digests, file lists)
deno run --allow-read --allow-write distribution/scripts/manifest.ts

# re-check npm pack dry-run file lists, tarball hashes, and the manifest
deno run --allow-run=npm --allow-read --allow-write \
  distribution/scripts/verify.ts
```

Inspect the resulting tarballs under `dist/tarballs/` (file lists, the launcher
shebang, and Linux/macOS executable bits are enforced on their native runners;
Windows has no POSIX executable bit). The equivalent build and verify gates
run in CI through `.github/workflows/build.yml` and `verify.yml`.

**Publishing stays out of scope.** Publication is a separate, explicitly
authorized operation that is not implemented here and is not part of any
template.

## License

[MIT](./LICENSE)

