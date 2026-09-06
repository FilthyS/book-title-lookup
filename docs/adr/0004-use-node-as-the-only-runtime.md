---
status: accepted
---

# Use Node.js as the only runtime

Book Title Lookup is authored, tested, built, and distributed for Node.js 22 or
newer. The npm package contains one bundled JavaScript executable exposed as
`book-title`. It has no runtime dependencies, platform-specific optional
packages, lifecycle install scripts, or downloaded binaries.

This decision supersedes
[ADR 0003](./0003-distribute-deno-binaries-through-npm.md).

## Context

The precompiled-binary design preserved a Deno source runtime while presenting
npm as the installation channel. In practice that required four architecture
packages, a JavaScript launcher, native compilation jobs, and synchronized
release versions. The application already uses portable web APIs and narrow
filesystem, environment, terminal, and process seams, so this release topology
cost more than the runtime distinction was worth.

## Considered options

- Keep Deno source execution and publish precompiled platform packages.
- Publish a Node launcher that invokes an installed Deno runtime.
- Maintain separate Deno and Node entry points.
- Make Node.js the sole runtime and bundle one JavaScript CLI.

The single-runtime Node design was selected because ordinary `npm install -g`
and `npx` workflows can install the same artifact on every supported platform.
It also removes launcher selection logic and native cross-compilation without
introducing install-time code execution.

## Consequences

- `package.json` and `package-lock.json` are the task, dependency, and version
  sources of truth.
- Production runtime access uses Node APIs behind the existing application
  seams.
- esbuild bundles application code and runtime libraries into
  `dist/book-title.js`; source maps and third-party notices ship beside it.
- CI validates Node 22, inspects the npm file list, and installs and runs the
  packed artifact on Windows, Linux, Intel macOS, and Apple Silicon macOS.
- Users must have Node.js 22 or newer. There is no standalone native binary.
- Publishing remains explicitly authorized and is not part of routine builds.
