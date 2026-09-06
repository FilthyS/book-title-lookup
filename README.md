# Book Title Lookup

[![Test](https://img.shields.io/github/actions/workflow/status/FilthyS/book-title-lookup/build.yml?branch=main&label=test)](https://github.com/FilthyS/book-title-lookup/actions/workflows/build.yml)
[![Build](https://img.shields.io/github/actions/workflow/status/FilthyS/book-title-lookup/build.yml?branch=main&label=build)](https://github.com/FilthyS/book-title-lookup/actions/workflows/build.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Find evidence-backed titles of the same written work across languages.

Search for a title, confirm the book you mean, and find titles used by published
editions in other languages.

## Quick start

[Deno 2.9 or newer](https://docs.deno.com/runtime/getting_started/installation/)
is required.

```console
git clone https://github.com/FilthyS/book-title-lookup.git
cd book-title-lookup
deno task start
```

This opens the interactive terminal interface.

## Command-line usage

Search once and return JSON:

```console
deno task start search --title 百年孤独 --json
```

Add filters when needed:

```console
deno task start search --title 百年孤独 --author "Gabriel García Márquez" --language en
```

List all commands and options:

```console
deno task cli:help
```

## Documentation

- [Data sources and accuracy](./docs/data-sources.md)
- [Configuration, development, and builds](./docs/development.md)
- [Product specification](./docs/product-spec.md)
- [Architecture and design](./docs/architecture.md)
- [Project issues](https://github.com/FilthyS/book-title-lookup/issues)

## Build from source

```console
deno task build
```

The [GitHub Actions build workflow](https://github.com/FilthyS/book-title-lookup/actions/workflows/build.yml)
also compiles Windows, Linux, and macOS binaries automatically.

## Credits

Bibliographic data comes from [Open Library](https://openlibrary.org/) and
[Wikidata](https://www.wikidata.org/).

## License

Book Title Lookup is available under the [MIT License](./LICENSE).
