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

## License

[MIT](./LICENSE)

