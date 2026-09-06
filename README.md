# Book Title Lookup

[![Test](https://img.shields.io/github/actions/workflow/status/FilthyS/book-title-lookup/build.yml?branch=main&label=test)](https://github.com/FilthyS/book-title-lookup/actions/workflows/build.yml)
[![Build](https://img.shields.io/github/actions/workflow/status/FilthyS/book-title-lookup/build.yml?branch=main&label=build)](https://github.com/FilthyS/book-title-lookup/actions/workflows/build.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Find evidence-backed titles of the same written work across languages.

Search for a title, confirm the book you mean, and find titles used by published
editions in other languages.

## Quick start

[Node.js 22 or newer](https://nodejs.org/) is required. Install the CLI from
npm; the package contains the complete application and has no runtime
dependencies or install scripts:

```console
npm install --global book-title-lookup
book-title
```

This opens the interactive terminal interface.

To run it without a global install:

```console
npx book-title-lookup
```

## Command-line usage

Search once and return JSON:

```console
book-title search --title 百年孤独 --json
```

Add filters when needed:

```console
book-title search --title 百年孤独 --author "Gabriel García Márquez" --language en
```

List all commands and options:

```console
book-title --help
```

## Documentation

- [Data sources and accuracy](./docs/data-sources.md)
- [Configuration, development, and builds](./docs/development.md)
- [Product specification](./docs/product-spec.md)
- [Architecture and design](./docs/architecture.md)
- [Project issues](https://github.com/FilthyS/book-title-lookup/issues)

## Build from source

```console
git clone https://github.com/FilthyS/book-title-lookup.git
cd book-title-lookup
npm ci
npm run build
```

The build emits the self-contained Node.js executable
`dist/book-title.js`. See the [development guide](./docs/development.md) for
source commands and package verification.

## Credits

Bibliographic data comes from [Open Library](https://openlibrary.org/) and
[Wikidata](https://www.wikidata.org/).

## License

Book Title Lookup is available under the [MIT License](./LICENSE).
