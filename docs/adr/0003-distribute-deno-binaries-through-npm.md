---
status: superseded by ADR 0004
---

# Distribute precompiled Deno binaries through npm

> Superseded by
> [ADR 0004: Use Node.js as the only runtime](./0004-use-node-as-the-only-runtime.md).

npm is the primary installation channel, but Deno remains the application
runtime. A small npm launcher selects an OS- and architecture-specific optional
dependency containing a `deno compile` binary. This avoids turning the
application into a dual Node/Deno runtime, does not require users to install
Deno, and avoids install-time binary downloads.

## Considered Options

- Transpile the entire application into a Node.js CLI.
- Require npm users to install Deno separately.
- Download a binary from an npm lifecycle script.
- Publish platform binaries as optional dependencies selected by a launcher.

The platform-package approach was selected despite its release complexity
because it preserves one runtime and supports ordinary `npm install -g` and
`npx` workflows without `postinstall` network execution.

## Consequences

Every release produces a launcher package and one package per supported
platform, all at the same version. The same binaries are also attached to
GitHub Releases. Unsupported platforms fail with an actionable message.
Publishing remains a separately authorized operation.

