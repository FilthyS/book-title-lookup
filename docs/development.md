# Development and Build Guide

This guide contains source-tree, permission, validation, and distribution
details. The [README](../README.md) remains focused on the product and the
shortest path to using it.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Git

Install the exact development dependency graph from the committed lockfile:

```console
npm ci
```

The TypeScript source tree contains:

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
npm start
```

Node.js is the only runtime. The application reads the closed environment
allowlist below and application seams constrain the cache and configuration
paths it uses.

Run a one-shot lookup:

```console
npm start -- search --title 百年孤独 --json
```

Inspect maintenance commands:

```console
npm run cli:help
npm start -- config show
npm start -- cache list
npm start -- cache show <digest>
npm start -- cache clear
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
npm run fmt
npm run fmt:check
npm run lint
npm run check
npm test
npm run build
npm run verify:package
npm run smoke:install
```

`verify:package` inspects the exact `npm pack --dry-run` file list and rejects
runtime dependencies, optional platform packages, and install lifecycle
scripts. `smoke:install` creates a real tarball, installs it into a temporary
prefix, and exercises `book-title --version`, `--help`, and non-TTY startup.

The coordinator-authorized live smoke test contacts Open Library:

```console
npm run test:live-smoke
```

## TUI layouts

Candidate and title-group screens provide two terminal-native layouts:

- `stacked` is the default and separates each choice with box-drawing lines;
- `compact` shows one condensed row per choice.

Press `Tab` on either screen to switch layouts for the current session. Both
layouts scroll around the active selection when the result set is larger than
the available terminal space.

## Build the Node.js CLI

Build the self-contained JavaScript executable:

```console
npm run build
```

The build bundles application code and runtime libraries into:

```text
dist/book-title.js
dist/book-title.js.map
```

The artifact requires Node.js 22 or newer and runs unchanged on Windows, Linux,
macOS, and other Node-supported platforms:

```console
node dist/book-title.js --version
```

## Inspect the npm artifact

These commands only build and verify a local artifact. They cannot publish:

```console
npm run build
npm run verify:package
npm pack
```

The tarball contains `package.json`, the two `dist/` artifacts, project
documentation, and license notices. It contains no platform-specific packages,
runtime dependencies, or lifecycle scripts. npm links the `book-title` command
to `dist/book-title.js`.

Publishing remains a separate, explicitly authorized operation. The runtime
migration decision is recorded in
[ADR 0004](./adr/0004-use-node-as-the-only-runtime.md).
