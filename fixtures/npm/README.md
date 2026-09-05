# npm fixture stubs (ticket #20 / section 6.6)

These are **committed stubs only**. The distribution design never commits a
compiled binary (issue #11, task constraint): real `deno compile` binaries are
produced under `dist/` and never checked in.

What each entry is for:

- **Per-platform stub packages** (`book-title-lookup-<os>-<cpu>/`) carry a tiny
  placeholder `bin/` file and a trivial CommonJS `index.js`. The `pack.ts`
  script substitutes these for a missing compiled binary when run with
  `--stubs`, so the full npm packaging, tarball-inspection, and artifact
  manifest pipeline can be exercised on a single non-native host and in
  source CI. They are never shipped and never published.
- **`stub_binary.ts`** is the source compiled at launcher-contract-test time
  (via `deno compile`) into a real, runnable binary on the current host, so
  the launcher's argument/stdout/stderr/exit-code relay can be asserted
  without relying on a shell or on committing an executable.

Both kinds of stub are validated only for packaging mechanics and launcher
behavior. Native smoke of the real compiled binaries (product gate G10 /
npm-release-topology.md section 11.3) runs on CI runners that match each
target and is never replaced by these stubs.
