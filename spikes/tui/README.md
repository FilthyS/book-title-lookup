# Issue #9 TUI rendering spike (throwaway)

Disposable comparison of two TUI rendering routes for Book Title Lookup while
[issue #9][] ("Choose the TUI rendering strategy") is open. The spike never
becomes production code; its conclusion and evidence are recorded in
[docs/design/tui-rendering-strategy.md](../../docs/design/tui-rendering-strategy.md)
and the research baseline in
[docs/research/deno-tui-candidates.md](../../docs/research/deno-tui-candidates.md).

Both variants share one pure reducer and fixture corpus under `shared/` and
differ only in their rendering/input layers:

| Path | Route |
| --- | --- |
| `shared/` | Pure `update(state, message)` model, demo corpus, grapheme helpers |
| `variant-a/` | Thin project-owned ANSI renderer + raw byte-stream decoder |
| `variant-b/` | Ink 7.1.1 + React 19.2 under Deno, driven by the same reducer |

Layout of `variant-a/`: `decoder.ts` maps raw stdin bytes to key tokens
(stateful across chunks so UTF-8 and escape sequences split by reads are
reassembled), `kernel.ts` runs the session from injected input/output,
`render.ts` + `width.ts` paint frames and measure grapheme display width,
`ansi.ts` owns the alternate-screen lifecycle. `variant-a/main_a.ts` and
`variant-b/main_b.ts` are the interactive entry points.

## Exact commands

Run from `spikes/tui` unless noted. Root tasks (`fmt`, `fmt:check`) come from
the repository root `deno.json`.

```powershell
# Deterministic automated tests (memory-backed render, synthetic bytes, reducer)
deno task test

# Type-check both variants
deno task check

# Compile both variants (no grants needed for variant-a; the Ink variant needs
# the documented env/sys grants because React reads NODE_ENV etc at import)
deno task compile:thin     # -> out/variant-a.exe
deno task compile:ink      # -> out/variant-b.exe

# Interactive run (must be from Windows Terminal so stdin/stdout are a TTY)
deno run --no-prompt variant-a/main_a.ts
deno run --no-prompt `
  --allow-env=NODE_ENV,TERM_PROGRAM,TERM,TMUX,CI,CONTINUOUS_INTEGRATION,TF_BUILD,DEV,INK_SCREEN_READER,COLUMNS `
  --allow-sys=osRelease `
  variant-b/main_b.ts

# Interactive run of the compiled binaries from Windows Terminal
.\out\variant-a.exe
.\out\variant-b.exe

# Repository hygiene (run from the repository root)
deno task fmt:check
git diff --check
```

## Behavior notes

- Non-interactive stdin/stdout never starts the full-screen TUI: each entry
  point prints a guard message to stderr and exits `0`. This is deliberate and
  matches the CLI contract, and it is why the spike tests are synthetic rather
  than terminal-driven.
- Typed text is decoded from raw bytes in `variant-a/decoder.ts`: a chunk is
  flushed as one `text` token when the chunk ends, and an incomplete trailing
  ESC/CSI/UTF-8 sequence buffers until the next chunk instead of spinning.
- Compilation outputs and dependency installs are throwaway:
  `node_modules/`, `out/`, and `*.exe` are git-ignored (`spikes/tui/.gitignore`);
  `deno.lock` is committed so dependency resolution is reproducible.
- Chinese IME composition, resize behavior, and terminal restoration are
  Windows Terminal **manual** checks, not automated assertions; see the
  strategy document for the named release gate.

[issue #9]: https://github.com/FilthyS/book-title-lookup/issues/9
