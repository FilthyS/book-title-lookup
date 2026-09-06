# Book Title Lookup

Find evidence-backed titles of the same written work across languages.

Book Title Lookup starts with a title—initially a Chinese title—identifies the
written work the user means, and then finds titles used by published editions in
other languages. It is a bibliographic lookup tool, not a machine translator.

## Status

The MVP is under active development. The TUI and command-line application can be
run from source, but no npm package has been released yet.

## What it does

- Searches by Chinese title, with optional author, ISBN, year, and target
  language filters.
- Asks the user to confirm the written work instead of silently choosing the
  first search result.
- Groups attested titles by language.
- Shows the editions and sources supporting each title.
- Distinguishes Verified, Probable, and Ambiguous evidence.
- Continues with clearly marked partial results when a source is unavailable.
- Supports an interactive full-screen TUI and JSON output for scripts.

Machine-generated title translations, accounts, reading history, and a hosted
web service are outside the MVP.

## Getting started

[Deno 2.9 or newer](https://docs.deno.com/runtime/getting_started/installation/)
is required when running from source.

```console
git clone https://github.com/FilthyS/book-title-lookup.git
cd book-title-lookup
deno task start
```

Running `deno task start` without a command opens the full-screen TUI.

## Usage

Search non-interactively:

```console
deno task start search --title 百年孤独 --json
```

Add optional filters:

```console
deno task start search --title 百年孤独 --author "Gabriel García Márquez" --language en
```

See every command and option:

```console
deno task cli:help
```

## Build

Build a standalone binary for the current supported host:

```console
deno task build
```

For prerequisites, configuration, validation, cross-platform builds, and
release-shaped artifacts, see the
[development and build guide](./docs/development.md).

## Documentation

- [Product specification](./docs/product-spec.md)
- [Domain language](./CONTEXT.md)
- [Architecture](./docs/architecture.md)
- [Data sources and accuracy](./docs/data-sources.md)
- [Architecture decisions](./docs/adr/)
- [Development and build guide](./docs/development.md)

Project planning and discussion live in
[GitHub Issues](https://github.com/FilthyS/book-title-lookup/issues).

## Credits

Book Title Lookup relies on bibliographic data and infrastructure maintained by:

- [Open Library](https://openlibrary.org/) and the
  [Internet Archive](https://archive.org/)
- [Wikidata](https://www.wikidata.org/) and the
  [Wikimedia Foundation](https://wikimediafoundation.org/)
- The [Deno](https://deno.com/) project

Catalog records are community-maintained and may be incomplete or incorrect.
Every result retains its source so it can be checked. This project is not
endorsed by Open Library, the Internet Archive, Wikidata, or the Wikimedia
Foundation.

## License

Book Title Lookup is available under the [MIT License](./LICENSE).
