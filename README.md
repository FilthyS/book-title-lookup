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

## Development

Deno 2.9 or newer is recommended.

```console
deno task fmt
deno task fmt:check
```

Implementation tasks will be added when the workspace packages are scaffolded.
The dependency lockfile will be committed once dependencies are introduced.

## License

[MIT](./LICENSE)

