# TUI rendering strategy (issue #9 decision)

Decision from the disposable issue #9 spike: the Book Title Lookup MVP builds
its full-screen TUI on a **thin project-owned ANSI renderer** (the
`variant-a` pattern), not on Ink. The evidence and manual gates that back this
decision are recorded here.

ADR 0004 later moved the renderer's terminal adapter from Deno to Node.js. The
thin-renderer decision, pure reducer boundary, and recorded spike evidence
remain applicable; Deno-specific measurements below are historical.

Inputs:

- research baseline: `docs/research/deno-tui-candidates.md` (issue #3),
- architecture spike criteria: `docs/architecture.md` ("TUI Framework Spike"),
- spike code: `spikes/tui/` (throwaway).

## 1. Decision

Use a thin renderer that owns the small screen set directly on runtime terminal
APIs:

- render frames from the pure reducer into memory and write ANSI to
  `process.stdout` (alternate screen, cursor, clear, reset);
- decode raw `process.stdin` bytes into key tokens with a stateful decoder;
- measure text by grapheme cluster (`Intl.Segmenter` + a per-cluster width
  rule that special-cases ZWJ emoji) instead of a code-point width table;
- keep terminal work in the driver so `update(state, message)` stays pure and
  tests never need a physical terminal.

Ink 7.1.1 + React 19.2 under Deno was built and exercised as the framework
counterfactual (the `variant-b` pattern) and is **not** adopted for
production.

## 2. Environment and evidence rules

Measured on **2026-09-05** from this repository's issue-9 branch on a
non-interactive Windows x64 worker:

| Item | Value |
| --- | --- |
| Host | Windows x64, non-TTY (`stdin`/`stdout` are pipes, not terminals) |
| Deno | `2.9.6` stable (`x86_64-pc-windows-msvc`) |
| Ink / React | `npm:ink@7.1.1`, `npm:react@19.2.0` |
| Lockfile | `spikes/tui/deno.lock` (committed; `nodeModulesDir: auto`) |

Labels used below:

- **[V]** verified in this session or in the linked research document;
- **[P]** deferred to the manual Windows Terminal session because a
  non-interactive worker cannot demonstrate interactive terminal behavior.

## 3. Measured automated evidence

All measured commands ran from `spikes/tui` (root hygiene tasks from the
repository root).

| Check | Result | Notes |
| --- | --- | --- |
| `deno task test` | **41 passed / 0 failed** (~0.5 s) | Deterministic: byte-stream decoder, memory-backed session kernel, render snapshots, width corpus, pure reducer. Regression cases cover a text-only chunk flushing one `text` token and trailing ESC/CSI buffering without spinning. **[V]** |
| `deno task check` | **pass, both variants** (16 modules) | Includes the Ink/React entry point under the documented grants. **[V]** |
| `deno task compile:thin` (3 attempts) | **3/3 success**, each `out/variant-a.exe`, 76.06 MB | Compiles with no permission flags. **[V]** |
| `deno task compile:ink` (3 attempts) | **3/3 success** this session, each `out/variant-b.exe`, 84.92 MB | Contrasts with the issue-3 research session, which observed intermittent `deno compile` crashes for npm/Ink entry points (research V4). Reproducible here today, but the earlier instability is not dismissed by one clean run; it stays a release-gate risk if Ink were adopted. **[V]** |
| Compiled binary smoke run | Both exit `0` with the non-interactive guard message | Confirms the no-TTY path never starts the full-screen TUI. **[V]** |
| Repository hygiene | `deno task fmt:check` pass; `git diff --check` clean | Run at repository root. **[V]** |

Width corpus results (automated; mirrors research section 5): CJK BMP,
combining marks, flag pairs, and ZWJ family all measure to modern-terminal
expectations through grapheme-aware logic. These are numeric/string assertions,
not a visual comparison against Windows Terminal rendering. **[V] for
calculation, [P] for pixel confirmation.**

## 4. Non-interactive and manual limitations

The spike is honest about what its automated suite does **not** prove. This
worker environment has no TTY, so none of the following was observed here, and
none is claimed as passed:

- **Chinese IME composition** — committed text arrives in tests as ordinary
  UTF-8 bytes. Microsoft Pinyin composition (candidate window, commit,
  mid-composition Backspace) is a real Windows Terminal/ConPTY behavior and
  must be exercised by hand on the target machine.
- **Terminal resize** — resize-driven layout is unit-tested through an
  injected `size()`; real window resize events (120×40 → 60×16 → 40×10) are not.
- **Terminal restoration** — alternate-screen entry/exit is asserted as string
  output in the memory-backed session and exercised via a finally block; a
  human must confirm the cursor, echo, raw mode, and scrollback on a live
  terminal after Ctrl+C, an exception path, and normal exit.
- **Pixel-perfect width** — expected widths come from the research corpus and
  terminal conventions, not from measuring a rendered Windows Terminal cell.

Consequently the automated green suite is **not** the IME/resize/restoration
signal. Those remain a named **manual release gate** for the thin renderer
(and would have been for Ink too) with the acceptance checks in research
section 10.2:

- [ ] Windows Terminal + Microsoft Pinyin: compose Chinese, commit into the
      search field, delete by committed character, move by grapheme, no crash;
- [ ] resize 120×40 → 60×16 → 40×10 → back, with the below-minimum size
      message under 60×16;
- [ ] alternate screen entered over visible scrollback and restored on exit;
- [ ] after Ctrl+C and after a forced uncaught error, cursor visible, echo on,
      raw mode off, alternate screen left;
- [ ] width fixtures visually aligned at 60×16 and 120×40.

## 5. Why the thin renderer and not Ink

Rationale for production, from spike evidence plus the research baseline:

| Criterion | Thin renderer (`variant-a`) | Ink under Deno (`variant-b`) |
| --- | --- | --- |
| Deterministic tests | Renders to memory by design; full session runs against injected streams. **[V]** | Pure layer is shared and testable; Ink's own screen I/O is not exercised by the automated suite here. **[V]** |
| Permission footprint | Zero Deno grants for source or compiled binary. **[V]** | Compiled binary requires `--allow-env` for React's `NODE_ENV` reads plus the env/sys grants in `compile:ink`. **[V]** |
| Dependency and compile story | No third-party runtime deps; 3/3 reproducible compiles. **[V]** | 26-package npm tree under Deno; compiled 3/3 here but earlier research observed intermittent compile crashes on the same host class (V4), plus `node_modules` auto-install for `deno check`. **[V]** |
| Windows/Deno history | Project-owned; Windows behavior is exercised via the named manual gate. | Ink's own CI is Ubuntu-only; Deno issue denoland/deno#33011 documented a Deno/Windows Ink regression (research V10). **[V]** |
| Fit to the product screens | Search field + candidate/title-group list is a small, fully owned surface. **[I]** | Component/layout engine is more than the product needs and adds an opaque input/parser layer. **[I]** |

The architecture constraints that decide this (research section 7) are
least-privilege operation, deterministic pure-state tests, locked dependencies
with reliable `deno compile`, and no terminal I/O inside `update`. The thin
renderer satisfies all of them with owned, auditable code; Ink's value (rich
layout, focus, kitty-keyboard parsing) is not needed for the product's screens
and its Deno/Windows/compile risks are borne by a third party.

## 6. Risks and follow-ups

- The manual release gate in section 4 is the remaining evidence. If the thin
  renderer fails an interactive criterion on Windows Terminal, reopen this
  decision with the specific failure; do not silently ship a falsely-passed
  IME/resize/restoration claim.
- Compile reproducibility for the Ink counterfactual was clean in this session
  but was not in the earlier research session; if Ink is ever reconsidered,
  its compile stability and Windows input behavior must be re-measured first.
- The thin decoder handles committed text and the control/CSI vocabulary the
  product needs; novel sequence families (bracketed paste, kitty keyboard,
  mouse) are out of scope until a real feature requires them.
