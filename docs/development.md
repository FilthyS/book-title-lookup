# Development and Build Guide

This guide contains source-tree, permission, validation, and distribution
details. The [README](../README.md) remains focused on the product and the
shortest path to using it.

## Prerequisites

- Deno 2.9 or newer
- Git
- Node.js 18 or newer only for npm launcher tests and package inspection

The dependency lockfile is committed. The Deno workspace contains:

```text
apps/tui
packages/core
packages/providers
```

The TUI is the composition root. Core owns the domain model and lookup use
cases. Providers own catalog adapters, HTTP runtime policy, and caching.

## Run from source

Start the interactive TUI:

```console
deno task start
```

The `start` task grants only the application environment allowlist and catalog
hosts. Filesystem access is granted because the cache and configuration roots
are resolved for the current user at runtime; application seams constrain the
paths actually used.

Run a one-shot lookup:

```console
deno task start search --title 百年孤独 --json
```

Inspect maintenance commands:

```console
deno task cli:help
deno task start config show
deno task start cache list
deno task start cache show <digest>
deno task start cache clear
```

### Runtime settings

The application reads this closed environment-variable set:

| Variable | Purpose |
| --- | --- |
| `BOOK_TITLE_CONTACT` | Optional contact included in the catalog User-Agent |
| `BOOK_TITLE_CACHE_DIR` | Override the response cache directory |
| `BOOK_TITLE_OFFLINE` | Force cache-only behavior |
| `BOOK_TITLE_LOG_LEVEL` | Set diagnostic verbosity |
| `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | Locate Unix configuration and cache roots |
| `LOCALAPPDATA`, `APPDATA`, `USERPROFILE` | Locate Windows configuration and cache roots |

Providing `BOOK_TITLE_CONTACT` is recommended for identified live-source
requests.

## Validate changes

```console
deno task fmt
deno task fmt:check
deno task lint
deno task check
deno task test
deno task test:launcher
```

The launcher contract suite is separate from the fast test task because it
invokes Node and performs a one-off Deno compile.

The coordinator-authorized live smoke test contacts Open Library:

```console
deno task test:live-smoke
```

## TUI layout prototype

The throwaway terminal-native layout comparison is intentionally separate from
the production renderer:

```console
deno task prototype:tui
```

Use `1`, `2`, and `3` or the Left/Right keys to switch layouts. Use Up/Down to
select a candidate and Enter to inspect the sample title groups. The prototype
uses only text, box-drawing characters, and basic ANSI emphasis; it performs no
network requests.

Print all candidate layouts without entering raw terminal mode:

```console
deno task prototype:tui -- --print
```

## Build a native binary

Compile for the current supported host:

```console
deno task build
```

The binary is written under:

```text
dist/binaries/<platform-package>/<binary-file>
```

Compile an explicit supported target:

```console
deno run --allow-run=deno --allow-read --allow-write \
  distribution/scripts/compile.ts --target <deno-target>
```

Supported Deno targets:

- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`

## Build release-shaped npm artifacts

These commands only build and verify local artifacts. They cannot publish:

```console
deno run --allow-env=BOOK_TITLE_RELEASE_VERSION --allow-run=npm,git \
  --allow-read --allow-write distribution/scripts/pack.ts --dry-run --stubs

deno run --allow-read --allow-write distribution/scripts/manifest.ts

deno run --allow-run=npm --allow-read --allow-write \
  distribution/scripts/verify.ts
```

Generated package trees and tarballs are written under `dist/`. Version
selection uses `BOOK_TITLE_RELEASE_VERSION`, then an exact `v<version>` tag on
`HEAD`, then the development version.

Publishing is a separate, explicitly authorized operation and is not
implemented by these scripts or tasks. The package topology, target matrix,
launcher contract, and release gates are specified in
[npm release topology](./design/npm-release-topology.md).
