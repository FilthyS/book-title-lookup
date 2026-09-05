# Deno TUI candidate research

Research input for [issue #3][] ("Compare Deno TUI candidates"), which feeds
prototype [issue #9][] ("Choose the TUI rendering strategy"). This document
compares credible full-screen TUI approaches for the Book Title Lookup MVP
against the requirements in `docs/product-spec.md` and
`docs/architecture.md`. It does not choose the final strategy; it narrows the
field and specifies what the disposable prototype for issue #9 must prove.

[issue #3]: https://github.com/FilthyS/book-title-lookup/issues/3
[issue #9]: https://github.com/FilthyS/book-title-lookup/issues/9

## 1. Question and required behavior

Issue #3 asks which maintained Deno-native, cross-runtime, or thin-renderer
approaches are credible candidates for the required full-screen TUI when
assessed for Deno 2.9 compatibility, Windows support, Unicode width handling,
testability, permissions, dependency health, and `deno compile` support.

The acceptance surface comes from `docs/product-spec.md` ("TUI Workflow",
"CLI Behavior") and `docs/architecture.md` ("TUI State Model", "TUI Framework
Spike", "Permissions", "Distribution"). The MVP needs:

- a keyboard-first full-screen interface with alternate screen, resize-driven
  layout, and terminal restoration after normal exit, Ctrl+C, and unexpected
  errors;
- Chinese title input, including IME composition, deletion, and cursor
  movement on Windows Terminal;
- correct column width for Chinese, Japanese, combining marks, and emoji;
- a pure `update(state, message)` reducer with terminal work kept in effects so
  tests do not need a physical terminal;
- least-privilege Deno operation (no `-A`; no subprocess, FFI, arbitrary
  filesystem, or listening-socket permission) and `deno compile` distribution
  through the ADR-0003 platform binaries;
- a minimum supported terminal size of 60×16;
- non-interactive modes never start the full-screen TUI.

The "TUI Framework Spike" section explicitly asks for: (1) Chinese IME input,
deletion, and cursor movement; (2) correct Chinese, Japanese,
combining-character, and emoji width; (3) resize-driven layout; (4)
alternate-screen support; (5) terminal restoration after Ctrl+C and exceptions;
(6) pure-state compatibility; (7) memory-backed or deterministic tests; (8)
least-privilege Deno operation; (9) locked dependencies and `deno compile`
compatibility; (10) no lingering raw mode or hidden cursor. The architecture
also names the candidate categories to include: a maintained Deno-native
framework, an older full-widget Deno framework, and a thin project-owned ANSI
renderer, and says Ink is not assumed compatible merely because Deno supports
many npm packages.

## 2. Method, environment, and evidence rules

### 2.1 Environment and retrieval date

All source material was retrieved on **2026-09-05** (UTC-04:00 local). GitHub
issue timestamps and release metadata in this repository are consistent with
that date.

| Item | Value |
| --- | --- |
| Working tree | `research/issue-3` branch of FilthyS/book-title-lookup |
| Deno | `2.9.6` stable, `x86_64-pc-windows-msvc` (verified `deno --version`) |
| gh | `2.85.0` |
| Host OS | Windows x64 |
| TTY | Worker runs non-interactive; `stdin`/`stdout` are not terminals |

### 2.2 Evidence types

The document labels every substantive claim:

- **[V] Verified** — observed in this environment (type check, compile, run,
  measured width) or read directly from an upstream primary source cited in
  section 9 (README, package manifest, CI workflow, issue, release).
- **[I] Inference** — reasoned from verified facts but not demonstrated in a
  real terminal session.
- **[P] Prototype** — explicitly deferred to the disposable issue #9 prototype,
  because interactive terminal behavior cannot be demonstrated from a
  non-interactive worker.

Interactive behaviors (IME composition, real-terminal resize and cleanup, raw
mode in a TTY) are deliberately marked **[P]**; that is exactly the evidence
the architecture says must come from the #9 spike, not from source reading.

### 2.3 Throwaway probes

Probes were written under `%TEMP%\issue3-probes\probes` and compiled under
`%TEMP%\issue3-probes\out` / `probes2` — outside the repository. No production
code or dependency was added to the repository. Each probe imports a candidate
and either prints an API marker or measures a width corpus. Probe commands
were `deno check`, `deno run`, and `deno compile` against Deno 2.9.6.

Two Deno 2.9 behaviors surfaced during probing and affect every npm-based
candidate:

- **Minimum dependency age.** Deno 2.9 refuses to resolve a dependency
  published less than 24 hours earlier unless `--min-dep-age=0` is passed or a
  shorter `minimumDependencyAge` is configured. This blocked `jsr:@david/dax@0.50.0`
  on the day of its release during probing. **[V]** This is a real, documented
  supply-chain gate and matters for fresh releases and lockfile reproducibility.
- **npm install layout.** Importing `npm:` packages requires a `node_modules`
  directory (`"nodeModulesDir": "auto"` in `deno.json` or `deno install`).
  **[V]** `deno check`/`deno run` rejected npm imports without it.

## 3. Candidates assessed

Candidate set (final):

| Candidate | Kind | Latest assessed version | Published | Activity | License | Direct deps |
| --- | --- | --- | --- | --- | --- | --- |
| Cliffy (`jsr:@cliffy/*`) | Deno-native interactive prompt toolkit | v1.2.1 (2026-06-04) | JSR | maintained | MIT | small @cliffy/@std set |
| Dax (`jsr:@david/dax`) | Deno-native shell/prompt toolkit | 0.50.0 (2026-09-04) | JSR + npm | maintained | MIT | small @david/@std set |
| deno_tui (Im-Beast) | Deno-native full-widget TUI | 2.1.11 (2024-01-29) | deno.land/x | stale since 2024 | MIT | 0 |
| Ink + React | Cross-runtime (Node npm under Deno) React-for-CLI | Ink 7.1.1 (2026-07-16); React 19.2.0 (2025-10-01) | npm | maintained | MIT | 26 direct + React peer |
| blessed | Node full-widget curses-like library | 0.1.81 (2015-09-03) | npm | dormant | MIT (npm field); GitHub reports NOASSERTION | 0 |
| neo-blessed | blessed fork for Node | 0.2.0 (2018-06-13) | npm | dormant | MIT | 0 |
| Thin project-owned renderer | ANSI renderer on Deno core APIs | n/a | n/a | project-owned | project MIT | 0 planned |

Rejected before the matrix: line-prompt-only libraries that do not target
full-screen multi-panel interfaces (for example `@clack/prompts` 1.7.0,
2026-07-03, four direct deps **[V]**). They are not credible full-screen TUI
frameworks and add no unique value over Cliffy/Dax for the non-TUI CLI parts.
Ink is shortlisted as the main cross-runtime full-screen candidate and is not
assumed compatible; that is decided by evidence below and by prototype #9.

## 4. Candidate evidence

### 4.1 Cliffy — Deno-native maintained prompt toolkit

- Repo `c4spar/cliffy` (formerly deno-cliffy); JSR packages `@cliffy/command`,
  `@cliffy/prompt`, `@cliffy/keypress`, `@cliffy/ansi`; MIT. Latest release
  v1.2.1 on 2026-06-04; ~1,175 stars at retrieval. **[V]**
- Deno 2.9.6 probe: `deno check` passes; `deno compile` succeeds and the
  compiled binary prints its marker without runtime permissions. **[V]**
- Windows: CI matrix runs `deno v1.x`, the checked-in Deno version, Node, and
  Bun across macOS, Windows, and Ubuntu; `@cliffy/prompt` publishes Windows
  integration snapshots (e.g. `*_test.ts.windows.snap`). **[V]**
- Width: `@cliffy/table`'s Unicode width table is the same run-length/Unicode
  15.0 table algorithm as `jsr:@std/cli/unicode-width` (content compared); it
  is code-point based, not grapheme based. Measured through the identical std
  algorithm it returns 8 columns for the family ZWJ emoji that renders in 2.
  See section 5. **[V]**
- Input: `@cliffy/keypress` performs raw key decoding; prompts are interactive
  line-oriented widgets. No alternate-screen (buffer 1049) usage was found in
  the code base. **[V]** Cliffy is not a full-screen multi-panel renderer; its
  prompts manage lines in the normal buffer. **[I]**
- Fit: healthy, Deno-native, but only supplies prompt-style interactions, not
  the full-screen screens/lists/panels the product needs. Useful as a
  reference for input/width code, not as the full-screen framework.

### 4.2 Dax — Deno-native maintained shell/prompt toolkit

- Repo `dsherret/dax`; MIT. Release 0.50.0 on 2026-09-04 (day of research);
  ~1,494 stars at retrieval. **[V]**
- Deno 2.9.6 probe: `deno check` passes (with `--min-dep-age=0` on release
  day); `deno compile` succeeds and the binary runs. **[V]**
- Windows: CI matrix macOS/Windows/Ubuntu on Deno 2.x. **[V]**
- Console: line prompts (`alert`, `confirm`, `multiSelect`, `progress`,
  `prompt`, `select`); its own key decoder (`readKeys`); opens `/dev/tty` or
  `CONIN$` as a fallback when stdin is piped. **[V]** No alternate-screen,
  full-screen layout engine exists in Dax. **[V]**
- Width: text styling/measurement helpers come from `@david/console-static-text`
  and width handling is prompt-scoped. **[V]**
- Fit: like Cliffy, healthy Deno-native building blocks for prompt/CLI flows,
  not a full-screen framework. The `CONIN$`/`/dev/tty` fallback would need a
  `--allow-read`-style grant that conflicts with least privilege if prompts
  ran under piped stdin; irrelevant if the TUI only starts from a real TTY. **[I]**

### 4.3 deno_tui — Deno-native full-widget framework (older, unmaintained)

- Repo `Im-Beast/deno_tui`; MIT; module `https://deno.land/x/tui@2.1.11`.
  Release 2.1.11 on 2024-01-29; repository last pushed 2024-11-19; ~306
  stars at retrieval. **[V]**
- Claimed Deno-native full-widget TUI: Canvas, components (Button, Input,
  Combobox, Table, ...), signal-based reactivity, zero runtime dependencies,
  keyboard/mouse input, alternate buffer usage (`\x1b[?1049h`). **[V]**
- Deno 2.9.6 probe: module imports and type-checks (`deno check` passes),
  `deno compile` succeeds, and the compiled binary runs. deno.land/x still
  serves the module at retrieval. **[V]**
- Maintainability: no release for ~20 months before retrieval; own CI workflow
  only runs Ubuntu, uses an odd Deno version matrix, and requires `--unstable`
  for check/test, signaling a pre-Deno-2 codebase. **[V]**
- Width: measured `textWidth` on the acceptance-style corpus is wrong for
  combining marks and emoji/ZWJ (see section 5); the helper iterates UTF-16
  code units and uses an is-fullwidth-code-point-era range check, while a
  separate grapheme regex is only used when multi-code-point support is
  enabled for object sizing. **[V]**
- Resize: polls `Deno.consoleSize()` on an interval on Windows and listens for
  `SIGWINCH` elsewhere. **[V]**
- Input: hand-rolled raw decoder over `stdin.setRaw` with xterm sequence
  references; not IME-aware by construction. **[I]**
- Fit: the only actively-coded Deno-native full-widget example, but stale, with
  measured width defects and Windows input behavior that is untested upstream.

### 4.4 Ink + React — cross-runtime React-for-CLI (npm under Deno)

- Repo `vadimdemedes/ink`; MIT. Ink 7.1.1 released 2026-07-16; ~39,814 stars
  at retrieval; React peer `>=19.2.0` and `@types/react`; React 19.2.0
  released 2025-10-01; `engines.node >=22`. **[V]**
- 26 direct runtime dependencies (package manifest), including
  `react-reconciler@0.33`, `yoga-layout@~3.2.1` (WASM-based layout, per Ink
  source comment and successful Deno initialization), `string-width`,
  `ansi-escapes`, `chalk`, and many small ANSI utilities. **[V]**
- Feature surface (README, v7.1.1): alternate-screen mode through
  `render(<App/>, { alternateScreen: true })`; non-interactive detection;
  incremental output; `useInput`, `usePaste`, `useWindowSize`, focus manager;
  kitty keyboard protocol auto-detection; Ctrl+C `exitOnCtrlC`; terminal
  "suspension" hooks that restore raw mode/cursor/alternate screen. **[V]**
- Input: Ink expects a Node `process.stdin` stream exposing `setRawMode` and
  parses keypresses with an enquirer-derived parser. Deno's Node-compat layer
  exposes `process.stdin.setRawMode` as a function in 2.9.6. **[V]** Whether
  it works identically to Node in a real Windows Terminal TTY is **[P]**.
- Deno 2.9.6 probes:
  - `deno check` passes with explicit `@types/react`. **[V]**
  - `deno compile` results were inconsistent on this Windows x64 host:
    one successful 84.9 MB binary (default lock mode), then two crashes with
    `tokio-runtime-worker ... has overflowed its stack`, exit `-1073741571`
    (`0xC00000FD`), including when recompiling the identical source with
    `--allow-env`. jsr-only and no-dependency compiles were stable in the same
    session. **[V]**
  - The successful compiled binary fails at runtime with
    `NotCapable: Requires env access to "NODE_ENV"` because React reads
    `process.env.NODE_ENV` at import. Starting the binary therefore requires a
    compile-time environment grant; verifying the granted build on a real
    terminal is part of #9. **[V]**
- Windows/Deno track record: the Ink repo CI runs only on Ubuntu (Node 22/24).
  Deno issue denoland/deno#33011 documents `npm:ink` TUI apps on Windows 10
  showing garbled output and ignoring keyboard input (including Ctrl+C) in
  Deno 2.7.6+, fixed in a later 2.7/2.8 release. **[V]** This is a real
  regression history for exactly the target combination (Ink under Deno on
  Windows).
- Fit: the most feature-complete full-screen route and the one Ink path the
  architecture demands evidence for; risks are Deno/npm compile reliability,
  permission footprint, and opaque Windows input handling.

### 4.5 blessed and neo-blessed — Node full-widget legacy libraries

- `chjj/blessed`: MIT license text in repo and `"license": "MIT"` in its
  package manifest (GitHub's license API reports `NOASSERTION` for the
  repository); npm 0.1.81 published 2015-09-03 with no release since; last
  push 2024-03; ~11,884 stars; 256 open issues at retrieval; zero npm
  dependencies; `engines.node >= 0.8`; CommonJS. **[V]**
- `embarklabs/neo-blessed`: 0.2.0 published 2018-06-13; last push 2021-04;
  ~411 stars; MIT; zero npm dependencies. **[V]**
- Windows: blessed README ("Windows Compatibility") states there is no mouse
  or resize event support on Windows and historically required
  `terminal: 'windows-ansi'`. **[V]**
- Width: blessed includes East Asian width and combining tables but requires
  `fullUnicode` to render East Asian double-width, surrogate pairs, and
  combining characters (otherwise they are replaced). Measured `strWidth` in
  Deno returns 1 for 😀 (expected 2 in a modern terminal), 2 for the 🇯🇵
  flag, and 4 for the family ZWJ emoji (expected 2). Its width data is a
  2015-era table. **[V]**
- Deno 2.9.6 probes: CJS import works at runtime (`deno run` prints the
  blessed marker) only with `// @ts-nocheck` (no type declarations);
  `deno compile` crashed with the same stack-overflow exit in both lock modes. **[V]**
- Fit: rejects itself on stale maintenance, Windows resize/mouse limitations,
  width defects, and a CommonJS/Node architecture that fights Deno tooling.

### 4.6 Thin project-owned ANSI renderer

- Definition for this research: an `apps/tui`-owned renderer that writes ANSI
  to `Deno.stdout`, owns raw input decoding, cursor/alternate-screen handling,
  and its own measurement helpers, with only small, audited Deno std building
  blocks (e.g. `@std/fmt` for color/stripping, `@std/cli/unicode-width` as a
  codepoint-width table). No full TUI framework dependency.
- Deno 2.9.6 API surface verified in this environment: `Deno.stdin.setRaw` and
  `Deno.addSignalListener` exist; `Deno.consoleSize()` works only when stdin,
  stdout, and stderr are attached to a terminal (it throws with a clear error
  otherwise). `jsr:@std/cli@1.0.32` exposes `unicode-width`;
  `jsr:@std/fmt@1.0.10` is the current std formatting package. **[V]**
- Deno compile of a no-dependency probe is stable and the binary runs without
  any runtime permission. **[V]**
- The renderer would have to implement or import: grapheme-aware width
  measurement (see the measured gap in section 5), Windows console input and
  IME handling, resize polling/listening, alternate screen, and terminal
  restoration. That is a small, testable surface for this product's screens
  (form, candidate list, title groups, source details), and it keeps all
  terminal code on the Deno-native side of the architecture. **[I]**

## 5. Unicode width measurements

Measured on Deno 2.9.6 (non-TTY host) on 2026-09-05. "Expected" is the column
count a typical modern terminal (Windows Terminal, iTerm2, GNOME Terminal)
uses; the expected values themselves are **[I]** until issue #9 verifies them
on the real terminal.

Corpus: `百年孤独`, `小王子`, `1984`, `中文abc`, `a\u0300b` (combining),
`e\u0301x` (combining), 😀, 🇯🇵, family ZWJ emoji
`👨‍👩‍👧‍👦`, `café`.

| Renderer / algorithm | CJK (百年孤独) | combining (àb) | 😀 | 🇯🇵 | family ZWJ emoji | café |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Expected (modern terminal) | 8 | 2 | 2 | 2 | 2 | 4 |
| `@std/cli/unicode-width` (std 1.0.32; same algorithm as Cliffy's table) | 8 | 2 | 2 | 2 | **8** | 4 |
| `string-width@8.2.2` (used by Ink) | 8 | 2 | 2 | 2 | **2** | 4 |
| blessed `unicode.strWidth` (0.1.81) | 8 | 2 | **1** | 2 | **4** | 4 |
| deno_tui `textWidth` (2.1.11) | 8 | **3** | 2 | **4** | **11** | 4 |

Interpretation:

- Codepoint/East-Asian-width tables (std/Cliffy, deno_tui) measure CJK BMP
  correctly but do not aggregate grapheme clusters; the family ZWJ emoji is
  over-counted (std 8, deno_tui 11) and combining marks are handled
  inconsistently (deno_tui counts them as 1, producing 3 instead of 2).
- `string-width@8.2.2`, the measurement engine behind Ink, returns the expected
  values for this corpus, including grapheme clusters.
- blessed and deno_tui, the legacy full-widget options, mis-measure at least
  one category in the corpus even though their CJK BMP output is right.
- Conclusion **[V]/[I]**: the full-screen renderer must use grapheme-aware
  width logic (segmentation + per-grapheme East Asian width) and must verify
  the terminal's own rendering on Windows Terminal. A code-point-only table is
  not sufficient for the product's title corpus even though most CJK title text
  is BMP.

## 6. Deno 2.9 probe summary

| Probe | Result | Evidence |
| --- | --- | --- |
| `deno check` Cliffy `@cliffy/prompt@1.2.1` | pass | type check |
| `deno check` Dax `@david/dax@0.50.0` | pass (with `--min-dep-age=0` on release day) | type check |
| `deno check` deno_tui `deno.land/x/tui@2.1.11` | pass | type check |
| `deno check` Ink `npm:ink@7.1.1` + React 19.2 | pass (needs `@types/react`) | type check |
| `deno check` blessed `npm:blessed@0.1.81` | pass only with `// @ts-nocheck` (untyped CJS) | type check |
| `deno run` all of the above (module load) | pass | runtime load |
| `deno compile` no-dependency probe | pass; binary runs without permissions | compile |
| `deno compile` Dax / Cliffy / deno_tui (JSR/deno.land only) | pass; binaries run | compile |
| `deno compile` npm-containing probes (string-width, Ink, blessed) | intermittent stack-overflow crash `0xC00000FD`; string-width and Ink each succeeded once in lock mode; blessed failed in both attempts | compile |
| Compiled Ink binary (successful build) | fails at startup without env access to `NODE_ENV`; granted-build runtime deferred to #9 | compiled run |
| `Deno.consoleSize()`, `Deno.stdin.setRaw`, `Deno.addSignalListener` | present; `consoleSize` throws without a terminal | API probe |

Verified facts table (selected):

| # | Fact | Basis |
| --- | --- | --- |
| V1 | Deno 2.9.6 exposes raw mode, console-size, and signal-listener APIs; console-size requires a TTY | probe |
| V2 | Deno 2.9 enforces a 24-hour minimum dependency age by default | probe error + docs URL |
| V3 | Cliffy, Dax, deno_tui, Ink import and type-check under Deno 2.9.6 | probe |
| V4 | JSR/deno.land-only entry points compiled reliably; npm-containing entry points compiled unreliably in this environment | probe |
| V5 | Compiled Ink cannot start without an environment permission because React reads `NODE_ENV` (granted build not re-run here due to compile flakiness) | probe |
| V6 | Ink README documents alternate-screen, resize, and input features; Ink CI only runs on Ubuntu Node 22/24 | upstream source |
| V7 | Cliffy CI and Dax CI run on macOS/Windows/Ubuntu | upstream source |
| V8 | deno_tui is unreleased since 2024-01 and unpushed since 2024-11; its CI is Ubuntu-only and `--unstable`-era | upstream source |
| V9 | blessed README documents no mouse or resize support on Windows; blessed 0.1.81 dates to 2015 | upstream source |
| V10 | Deno issue #33011: Ink TUI under Deno on Windows regressed in 2.7.6 (fixed by PR #32999, closed 2026-03-26) | upstream source |
| V11 | Width corpus measurements in section 5 | probe |

## 7. Decision matrix

Legend: `Y` verified yes; `Y*` yes with a caveat (footnote); `P` must be
proven by the #9 prototype; `N` verified no / absent; `n/a` not applicable.
Inference is called out in the Notes row.

| Criterion | Cliffy | Dax | deno_tui | Ink+React | blessed | neo-blessed | Thin renderer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deno 2.9 import/type-check | Y | Y | Y | Y* (needs React types) | Y* (ts-nocheck) | P (not separately probed; blessed lineage) | Y |
| `deno compile` (this env) | Y | Y | Y | P — flaky (1/3 OK, 2 crashes) | N (crashed) | P (same lineage) | Y |
| Windows support | Y (CI) | Y (CI) | Y* (claimed; no Windows CI) | P (community evidence; no Windows CI; #33011 history) | N (no resize/mouse per docs) | N | P (project must build/test) |
| Unicode/grapheme width (corpus) | Y* codepoint table only (same as std; ZWJ over-count) | Y* codepoint table only (prompt-scoped) | N (measured defects) | Y* (string-width measured correct) | N (measured defects) | N | P — must implement grapheme-aware measurement |
| Raw input / IME | P | P | P | P | P (Windows-limited) | P | P |
| Resize / cleanup | n/a (not full-screen) | n/a | Y* (poll on Windows; alt buffer) | Y* (features exist; Deno path unproven) | N (no Windows resize) | N | P |
| Deterministic testability | Y (own tests; line prompts) | Y (own tests) | P (component render logic testable, but no virtual-terminal seam) | Y* (own render-to-string/tests; Deno run unproven) | N (screen/render loop is Node-tty-bound) | N | Y (render to memory buffers by design) |
| Least-privilege fit | Y for prompts (stdin only) | Y* (CONIN$ fallback needs a file grant when piped) | Y* (README says none; unproven) | N — React reads `NODE_ENV`, so env permission is required at minimum | N (Node process model; env/fs access) | N | Y (no dependency; choose exact Deno grants) |
| Dependency health / license | Y MIT; active | Y MIT; active | N MIT; stale | Y MIT; active upstream, but Deno path risky | N MIT; dormant 2015 release | N MIT; dormant 2018 release | Y MIT project-owned; no third-party |
| Full-screen + pure-state fit | N (line prompts only) | N (line prompts only) | Y* (full-widget, but signals model differs from planned reducer) | Y* (component model; architecture boundary needs adaptation) | Y* (full-widget but Node-centric) | Y* | Y (owns render; pure reducer stays in app layer) |

Notes by candidate:

- Cliffy/Dax: excellent maintained Deno-native building blocks and reference
  implementations, but neither provides the full-screen multi-panel renderer
  the product needs, so neither is a full TUI candidate. They remain options
  for non-TUI prompt flows only.
- deno_tui: real Deno-native full-widget code that type-checks and compiles on
  Deno 2.9, but unmaintained for ~20 months, with measured width defects and no
  upstream Windows coverage. High downstream risk.
- Ink: the strongest full-screen feature set and the measurement behavior the
  product wants, but under Deno it currently has an unstable `deno compile`
  path, a mandatory environment permission, a Node-22-oriented runtime, a
  26-package dependency tree, and a documented Deno/Windows regression history.
- blessed / neo-blessed: dormant, Windows-limited, untyped CommonJS, and
  already measured as width-defective; rejected.
- Thin renderer: no dependency risk, exact permission story, deterministic
  render-to-memory tests, and stable `deno compile`; costs are implementation
  ownership of input decoding, width logic, and Windows console behavior.

## 8. Explicit rejection reasons

1. **blessed 0.1.81** — no npm release since 2015-09-03 and a dormant repo
   (last push 2024-03, 256 open issues); README documents no mouse or resize
   support on Windows; measured width defects (emoji width 1, ZWJ family 4);
   CommonJS without types; `deno compile` crashed in this environment. License
   metadata is inconsistent (MIT text, GitHub `NOASSERTION`).
2. **neo-blessed 0.2.0** — blessed lineage with npm release from 2018-06-13 and
   last push 2021-04; inherits blessed's architecture and Windows limitations
   with even less activity.
3. **deno_tui 2.1.11** — unmaintained since 2024; measured width defects
   (combining 3 instead of 2, flag 4 instead of 2, ZWJ family 11 instead of 2);
   Ubuntu-only CI and pre-Deno-2 `--unstable` workflows; no upstream Windows or
   IME evidence. Keeping it would make a stale, buggy third-party layer the
   terminal foundation of a least-privilege compiled product.
4. **Cliffy 1.2.1 and Dax 0.50.0 as the TUI framework** — both are maintained,
   Deno-native, and compile cleanly, but both are line-prompt/shell toolkits
   without an alternate-screen full-screen layout engine. Adopting either as
   "the TUI" would still require writing the full-screen renderer; their prompt
   widgets do not express the product's screens/state model.
5. **Clack prompts and other prompt-only npm libraries** — same reasoning as
   above; no full-screen capability and no benefit over Deno-native options for
   the non-TUI CLI.
6. **Any framework that requires `-A` or broad grants** — Ink at minimum
   requires environment access (`NODE_ENV`) when compiled; blessed and React
   bring Node `process` semantics. The product's permission contract
   (`docs/architecture.md` Permissions) rules these out unless a narrow,
   verified grant list is demonstrated.
7. **Ink as a default adoption (not yet rejected)** — Ink is *shortlisted for
   proof*, not selected: `deno compile` reliability in this environment,
   required environment grants, and Windows/Deno input behavior must each pass
   a disposable prototype before adoption. If they do not, the fallback is the
   thin renderer.

## 9. Shortlist for issue #9 and decisive risks

Recommended shortlist for the disposable prototype (issue #9), in evaluation
order:

1. **Thin project-owned ANSI renderer** (Deno core APIs plus small, audited
   std helpers; grapheme-aware width logic).
2. **Ink 7.1.1 + React 19.2 under Deno** (the main framework counterfactual
   that the architecture requires evidence about).

deno_tui, blessed, and neo-blessed are **not shortlisted** (rejection reasons
above). If the #9 prototype eliminates both shortlisted routes, the research
should reopen with new candidates; this document gives the evidence bar for
that.

Decisive risks to carry into #9:

| Risk | Likelihood / impact | Evidence and mitigation |
| --- | --- | --- |
| `deno compile` of npm-containing entry points is unstable on Deno 2.9.6 Windows x64 (stack overflow, `0xC00000FD`) | Observed in this environment | V4. Recompile same source repeatedly in #9; also test on the target CI images. If unstable, npm routes (Ink) are disqualified for the ADR-0003 binary distribution. |
| Compiled Ink requires environment permission (`NODE_ENV`) | Confirmed | V5. Decide whether a documented narrow env grant is acceptable; otherwise reject Ink. |
| Ink/Deno Windows input regressions | Real history | denoland/deno#33011. #9 must exercise keyboard + Chinese IME on the exact Deno/Terminal versions. |
| Grapheme vs codepoint width for ZWJ emoji and combining marks | Confirmed for several helpers | Section 5. Renderer must segment graphemes and measure per grapheme; verify against Windows Terminal rendering. |
| IME composition semantics under raw mode and ConPTY | Unknown for every candidate | All raw-input paths are marked [P]; #9 runs the exact Windows Terminal scenario before selection. |
| Legacy full-widget options are stale and width-defective | Confirmed | V8, V9, section 5. Removed from shortlist. |
| Fresh-version supply-chain gate | Confirmed (Deno 2.9 policy) | V2. Pin exact versions, commit a lockfile, and allow 24 h after release before adoption. |

## 10. Concrete acceptance plan for prototype issue #9

Prototype **must be disposable** (outside `apps/`, not published) and **must
not add repository dependencies**. Create two throwaway harnesses that share
one pure `update(state, message)` reducer and one synthetic event vocabulary:

- Variant A — thin ANSI renderer: writes to an injected output buffer and
  reads a byte stream decoder so the same code runs against a memory stream in
  tests and a real terminal in the manual session.
- Variant B — Ink under Deno: an Ink component tree driven by the same reducer
  messages; its output and input go through Ink's own rendering, so the pure
  layer stays testable while Ink owns terminal I/O.

Machine: Windows Terminal on Windows 10/11 with the target Deno version and
Simplified Chinese IME installed. Run `deno task fmt:check`-style hygiene and
commit nothing from the prototype.

### 10.1 Steps that must run

1. `deno check` and `deno test` for both harnesses in CI-style mode.
2. `deno compile -o <name> <entry>` (locked dependencies, no `--no-lock`) for
   both variants, repeated at least three times each on the same machine;
   record binary size, success/failure, and crash exit codes.
3. Run each compiled binary from a normal PowerShell/Windows Terminal prompt
   without `-A` and with the narrowest permission flags the harness needs.
4. Manual Windows Terminal session covering criteria 1–10 below.
5. Re-run the manual session after `Ctrl+C`, after an uncaught exception path,
   and after a forced resize to below 60×16.

### 10.2 Acceptance criteria (maps to architecture spike items 1–10)

| # | Check | Pass condition |
| --- | --- | --- |
| 1 | Chinese IME input, deletion, cursor movement | Microsoft Pinyin commits text into the search field; Backspace deletes a committed character (not a byte); arrow keys move by grapheme without artifacts; no crash during or after composition. |
| 2 | Unicode width | Render fixture lines for 百年孤独, 小王子, 森, e\u0301, a\u0300b, 😀, 🇯🇵, 👨‍👩‍👧‍👦 and compare column positions to Windows Terminal's own rendering; no overlap, truncation, or misalignment at 60×16 and 120×40. |
| 3 | Resize layout | Resize 120×40 → 60×16 → 40×10 → back; content reflows; below 60×16 shows the product's size message instead of corrupted layout. |
| 4 | Alternate screen | Start with scrollback visible (`git log` on screen); the TUI shows a clean screen and exiting restores the original scrollback content. |
| 5 | Restoration after Ctrl+C and exceptions | After Ctrl+C and after a forced uncaught error, cursor is visible, echo is restored, raw mode is off, and the alternate screen is left; verify with a follow-up `deno eval`-style console check and visually. |
| 6 | Pure-state compatibility | The identical reducer drives both variants; no terminal I/O occurs inside `update`; navigation/cancel/stale-response unit tests pass without a terminal. |
| 7 | Deterministic tests | Memory-backed render assertions (exact line snapshots for a fixed terminal size) and synthetic byte-stream input tests pass on every supported OS in CI. |
| 8 | Least privilege | Both harnesses run with no `-A`; list the exact Deno flags each requires (Variant B must justify any env/other grant, e.g. `NODE_ENV`); any grant outside documented product variables is a fail for that variant. |
| 9 | Locked deps + `deno compile` | deno.lock committed; compile succeeds reproducibly (see step 2); the binary runs standalone without a Deno install on the target machine. |
| 10 | No lingering raw mode or hidden cursor | After every exit path in step 5, the terminal accepts typed input with echo and shows the cursor; automated probe confirms console mode flags are restored. |

### 10.3 Decision gate

Adopt Variant B (Ink under Deno) only if it passes 1–10 with reproducible
compiles and an acceptable permission list; otherwise adopt Variant A (thin
renderer). Record the measured numbers, compile success rate, permission list,
and any Windows Terminal quirk in issue #9, and decide the trade-offs the human
accepts. This research anticipates the thin renderer as the lower-risk default,
with Ink as the option that earns adoption only through prototype evidence.

## 11. Sources

All retrieved 2026-09-05.

- Book Title Lookup: `docs/product-spec.md`, `docs/architecture.md`,
  `docs/adr/0003-distribute-deno-binaries-through-npm.md`,
  `.scratch/mvp-implementation/issues/03-*.md` (historical snapshot),
  GitHub issues #3 and #9 — https://github.com/FilthyS/book-title-lookup/issues
- Cliffy repo/releases — https://github.com/c4spar/cliffy (v1.2.1 release),
  https://jsr.io/@cliffy/prompt , `table/unicode_width.ts` at
  https://github.com/c4spar/cliffy/blob/main/table/unicode_width.ts
- Dax repo/releases — https://github.com/dsherret/dax (0.50.0 release),
  https://jsr.io/@david/dax
- deno_tui repo — https://github.com/Im-Beast/deno_tui (2.1.11 release),
  module https://deno.land/x/tui@2.1.11/mod.ts
- Ink repo/readme — https://github.com/vadimdemedes/ink (v7.1.1 release),
  https://www.npmjs.com/package/ink
- blessed repo — https://github.com/chjj/blessed , npm
  https://www.npmjs.com/package/blessed
- neo-blessed repo — https://github.com/embarklabs/neo-blessed , npm
  https://www.npmjs.com/package/neo-blessed
- React — https://www.npmjs.com/package/react (19.2.0); yoga-layout —
  https://www.npmjs.com/package/yoga-layout (3.2.1); string-width —
  https://www.npmjs.com/package/string-width (8.2.2); std modules —
  https://jsr.io/@std/cli (1.0.32), https://jsr.io/@std/fmt (1.0.10)
- Deno docs for the minimum dependency age gate —
  https://docs.deno.com/go/minimum-dependency-age (hint emitted by Deno 2.9.6)
- Deno issue #33011 "npm:ink TUI apps broken since v2.7.6" and fix PR #32999 —
  https://github.com/denoland/deno/issues/33011

Probe sources are throwaway files under `%TEMP%\issue3-probes\`; they are not
part of the repository and may be deleted by the host.
