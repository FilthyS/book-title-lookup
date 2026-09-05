# Deno Persistence and Permissions

## 1. Purpose and Scope

This document answers the persistence question raised in Issue #5 for Book Title Lookup:

> Which stable Deno 2.9 runtime or standard-library facilities should locate cross-platform config/cache directories, perform atomic file replacement, coordinate concurrent cache access, read constrained environment variables, and preserve least-privilege behavior in compiled executables?

The decision applies to the platform layer inside `packages/providers` (raw HTTP response cache, platform configuration, cache locations) and to the directory and permission policy consumed by `apps/tui` and `distribution/`.

The MVP constraints from `docs/product-spec.md` and `docs/architecture.md` that bound this decision are:

- Config and cache live in the operating system's standard per-user locations, never in the repository.
- The cache stores raw HTTP responses plus metadata, never merged conclusions or a Resolved Work.
- Cache files are one JSON entry per hashed request identity; writes go to a temporary file and replace the target atomically.
- A cache port keeps a future SQLite implementation possible without changing Core.
- Offline mode may return stale entries only when the entry is explicitly labeled stale.
- Normal tasks never use `-A`; the app needs outbound network only to configured catalog hosts, read/write only to its own config/cache paths, and environment access only to documented variables.
- Permissions must be preserved when running under `deno run` and in `deno compile` executables.
- User-visible failure states are structured outcomes, not thrown strings.

Throughout this document, "Resolved Work", "Source Record", "cache entry", "stale", "offline mode", and "schemaVersion" follow the project glossary and specification. The term "entry" below means one stored raw HTTP response envelope, not a bibliographic Work.

## 2. Evidence Conventions

This document separates:

- **G — Documented guarantee**: a statement made by a primary reference such as the Deno manual/API, the JSR `@std` documentation, or the cited Microsoft, POSIX, Apple, or freedesktop specification.
- **O — Observed behavior**: behavior established from the repository state and product documents read for this issue. No experimental probes of Deno internals, filesystem behavior, or third-party APIs were run for this document. Statements not found in a cited primary source are never presented as probe results.
- **I — Engineering inference**: a reasoned conclusion from documented guarantees, product constraints, and the project's local single-user threat model. Inferences are labeled and are the smallest number needed to choose a baseline.

All citations were retrieved on **2026-09-05**. Deno facilities are evaluated against the stable Deno 2.9 runtime and the stable standard-library line documented at that date.

## 3. Findings

### 3.1 Cross-platform directory discovery

The product requires the cache in the OS standard per-user cache directory and the user config file in the OS standard per-user config directory.

Deno 2.9 exposes no documented runtime API for "the user's config directory" or "the user's cache directory" as a single portable global (`O`; none is present in the `Deno` runtime API references cited in Section 9). The runtime itself has an internal preference for its own module cache, but no equivalent public primitive is part of the stable runtime surface. The stable `@std` packages likewise document path string helpers, not platform directory policies [13, 14]. Therefore the project must implement a small, dedicated directory locator.

The platform policies that should be encoded are documented by the platform references:

- **Windows**: Per-user application state is placed under the per-user AppData areas. Roaming state belongs under `%APPDATA%` and non-roaming, machine-local state such as caches belongs under `%LOCALAPPDATA%` [17]. Microsoft documents these known folders and notes that applications should prefer the Known Folder API for authoritative resolution [17]. Environment variables remain the practical discovery channel available to a scripted, dependency-light Deno process; Deno has no documented `SHGetKnownFolderPath`-equivalent API without FFI (`I`).
- **Linux and other freedesktop systems**: `$XDG_CONFIG_HOME` or `~/.config` for config, and `$XDG_CACHE_HOME` or `~/.cache` for cache [16]. A relative value for either variable is defined as ignored by the specification [16].
- **macOS**: config belongs in `~/Library/Application Support` and cache in `~/Library/Caches` [24]. macOS does not define an XDG footprint for third-party command-line tools; applying freedesktop rules on macOS is a behavioral choice, not an OS requirement.

The product treats these policies as the baseline but permits one product-level environment override for the cache and, where a CLI flag eventually exists, applies the documented precedence **CLI flag > environment variable > user config file > built-in default** [architecture.md]. Directory *roots* are never themselves read from the config file; doing so would create a circular dependency during config discovery (`I`).

### 3.2 Environment override precedence and constrained reads

The environment variables used by the MVP are the documented product variables and a closed list of platform-discovery variables:

- Product variables (documented in `docs/architecture.md`, planned set): `BOOK_TITLE_GOOGLE_API_KEY`, `BOOK_TITLE_CONTACT`, `BOOK_TITLE_CACHE_DIR`, `BOOK_TITLE_OFFLINE`, `BOOK_TITLE_LOG_LEVEL`. `BOOK_TITLE_GOOGLE_API_KEY` is reserved for the deferred Google Books adapter and is not read by the MVP.
- Platform-discovery variables, an implementation list that must be documented alongside the product variables: on Windows `LOCALAPPDATA`, `APPDATA`, and `USERPROFILE` as a fallback source for AppData derivation; on Linux/macOS `HOME`; on Linux additionally `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`.

Deno's granular environment permission grants access by variable name [1, 2]. `Deno.env.get(name)` is the constrained read operation; `Deno.env.toObject()` reads the whole environment and is not used [4]. Because Deno evaluates an environment permission as allowed-or-denied for the requested variable name, the code must declare the full union of names above in its permission manifest whenever a single artifact is expected to run on more than one operating system. Platform-specific release artifacts may narrow the union to the variables that platform actually reads.

Precedence rules for the cache root:

1. Explicit cache override — product `BOOK_TITLE_CACHE_DIR` (and a future CLI flag above it).
2. Platform cache environment inputs — `XDG_CACHE_HOME` on Linux, none on macOS, `LOCALAPPDATA` on Windows.
3. Platform fallback — `~/.cache` on Linux, `~/Library/Caches` on macOS, derived AppData Local on Windows.
4. If the active platform cannot produce a usable base directory, the locator returns a typed `unsupported environment` failure rather than silently selecting `/tmp`, the working directory, or the executable directory.

A relative `BOOK_TITLE_CACHE_DIR` is rejected as invalid configuration; cache roots are absolute paths after resolution. The values of `HOME`, `XDG_*`, and the Windows AppData variables are not product settings. A user who overrides them is deliberately relocating the platform baseline; the locator must resolve the override once at process start, never re-read it mid-session, and never mirror it into domain code (`I`).

### 3.3 Directory creation and security

The application must ensure its two directories exist, with owner-only access on Unix-like systems. The relevant documented primitives are `Deno.mkdir` with `recursive: true` and `mode` [10], and `Deno.stat`/`Deno.realPath` for pre-checks [API]. `@std/fs/ensure-dir` composes `Deno.mkdir` and is acceptable, but it offers no security behavior beyond the underlying call [13].

Guideline for the baseline:

- Create each directory as `mode 0o700`, recursive where needed [10]. `mode` is applied only where the platform models POSIX modes; Windows directories inherit the ACL of the containing per-user profile [10, 17].
- Do not `chmod` an already-existing directory. A user may have chosen custom permissions intentionally; the application only reports and refuses unsafe states that it defines, such as a world-writable cache root.
- Resolve and canonicalize the chosen root after creation and before opening files. At the persistence seam, verify containment by computing a path relative to that root and rejecting absolute results and any `..` segment; a raw string-prefix check would incorrectly accept a sibling such as `cache-evil`.
- On Windows, relying on the per-user AppData inheritance is sufficient for a local single-user tool (`O` threat model: no multi-user or hostile-local-user requirement appears in the MVP).

These security rules address the "directory creation/security" part of the question without pretending Deno provides Windows ACL editing.

### 3.4 Atomic file replacement

The design goal is: readers of an entry see either the complete previous entry or the complete new entry, never a partial entry, and a process crash does not leave a truncated entry at the final path.

Deno provides the building blocks, not a packaged whole-file atomic writer:

- `Deno.makeTempFile` creates a uniquely named temporary file [9].
- `Deno.FsFile.sync`/`syncData` flushes buffered file contents to stable storage [7].
- `Deno.rename` replaces the destination [8].
- Stable `@std/fs` documents move and ensure-style helpers but does not document a durable atomic-write helper covering write, flush, and replace as one operation [13].

The semantics of the final rename are platform-documented:

- POSIX `rename()` atomically replaces an existing destination file: there is no observable moment where the destination is missing [22, 23]. A file opened at the destination before replacement continues to reference the old object; a process opening after replacement sees the new object.
- On Windows, replacement is implemented through the Win32 move/replace machinery [18, 19]. NTFS and the Win32 API do not give Deno a documented POSIX-style guarantee that the destination is *never observed missing* during replacement. The relevant documented contract is that the replacement must contend with other open handles and share modes; `CreateFile` callers control sharing via share modes such as `FILE_SHARE_DELETE` [20]. Rust's standard library, which underlies Deno, opens files with delete sharing enabled (`I`; inferable from the language runtime and Windows share-mode documentation, not from a Deno probe). Consequently a Deno reader holding an entry open can normally coexist with a concurrent replace, and the reader continues to read the old complete object.

The durable-write procedure chosen as the baseline is:

1. Create a temporary file **in the same directory** as the final entry using `Deno.makeTempFile({ dir })` [9]. A same-directory temp avoids cross-device rename failure (`EXDEV` on Unix) and keeps the rename local to one filesystem object (`I`).
2. Write the complete entry payload to the temp file.
3. Call `sync` (or `syncData`, if the platform document permits and future benchmarking prefers it) before closing [7].
4. Close the file.
5. Call `Deno.rename(temp, final)` [8].
6. On Windows, if the rename fails because of a transient sharing/access condition, retry with bounded jitter; a local antivirus or search indexer can hold a handle briefly [20]. The retry budget is part of the file seam, not the source HTTP deadline.

Because Deno exposes no portable directory-descriptor sync in the documented stable APIs reviewed (`O`: no such entry in the Deno API or `@std` references), the procedure cannot, from documentation alone, claim crash-durable *preservation of the rename itself* on every filesystem. POSIX documents that `fsync` applies to file data and metadata of the file, not to the parent directory entry [23]. The strongest honest guarantee is therefore:

- **I (process-crash safety of the entry object)**: absent a machine or storage failure, terminating the writer before or after the rename should leave the final path pointing to a complete old or new entry. Termination before the rename may also leave an orphaned temp file. The cross-platform test matrix must verify this inference, especially on Windows.
- **I (power-loss durability of the rename)**: whether the renamed directory entry itself survives a power loss depends on filesystem journaling and directory metadata flushing, which the project cannot control through the documented Deno surface. The application therefore does not promise that a final path always survives sudden power loss; a missing entry is a cache miss and a refetch. This is acceptable for a cache.
- **G (no torn reads)**: readers never observe a half-written final entry.
- **I (Windows readers)**: a reader should open, read the full small JSON entry, and close promptly; it must not hold a write handle across the replace. This makes Windows behavior converge on the POSIX reader model.

### 3.5 Windows-specific behavior

Windows raises the following documented and inferred risks:

- Replacement of an existing file requires the new name not be held open in a way that denies delete sharing [20].
- `MoveFileExW`/`ReplaceFileW` do not make the same atomic-visibility statement that POSIX `rename` makes [18, 19, 22]. The cache seam therefore must not rely on "a reader can never observe a missing file" on Windows. It should treat a transient missing final path exactly like a cache miss and retry the network fetch, which is already the product's recovery behavior.
- Temporary files and final files live under the same per-user AppData directory, so Windows ACL behavior is inherited and consistent [17].
- File paths may be long; the project stores only hashed names plus a short metadata suffix beneath the app root, keeping paths comfortably inside Windows length limits (`I`).

A platform fixture must exercise Windows replacement with an open handle and with simulated sharing contention in CI rather than only on POSIX.

### 3.6 Crash consistency and orphaned temporary files

A crash may occur at any point in Section 3.4. The recovery policy at next startup is:

- Detect files matching the project's temp naming shape that are older than a defined threshold and unlink them. This is safe because the directory is private and temp names are owned by the project.
- Do not eagerly delete young temp files; another live process may currently be at step 5 (`I`).
- If the final entry is missing and the network is available, treat the entry as absent and refetch. If offline, report the outcome as no usable cached entry and surface the source status, consistent with the product's existing offline/stale rules.

The cache stores raw responses plus metadata: source, status and relevant headers, fetch time, freshness deadline, body, schema/decoder version, and stale state. Because the cache stores no Resolved Work or recommended Title Group, a lost last write degrades to a refetch, never to a stale bibliographic conclusion.

### 3.7 Bounded concurrent cache access without portable advisory locks

The MVP is a local, low-volume, single-user tool. Multiple writers to the same entry are possible but narrow: two provider requests with the same normalized identity, or two user processes (for example a TUI and a CLI) using the same cache concurrently.

Findings:

- Deno's stable runtime does not document a portable advisory file-locking API (`flock`/`LockFileEx`); `@std` does not document one either [1, 2, 13]. The project must therefore not design around portable advisory locks.
- SQLite is the future option that *does* bring a documented, portable locking strategy for more complex needs; the architecture explicitly keeps a cache port so a later SQLite implementation is possible without changing domain code [architecture.md]. The issue-5 baseline is the file-per-entry implementation, not SQLite.
- The project will not emulate locks with lock files, lock directories, or PID files. Such schemes fail on crashes without additional cleanup and are not documented primitives on either platform family (`I`).

Baseline concurrency contract:

1. **In-process**: the provider composition layer keeps an in-memory table of in-flight requests keyed by normalized request identity. Concurrent requests for the same identity await the same underlying fetch/write. This bounds duplicate network traffic and duplicate writes within one process.
2. **Cross-process**: no mutual exclusion is attempted. Two processes may write the same key concurrently. Each write is whole-file and atomic by rename, so every final state is one complete entry from one writer. Concurrent writers are "last-complete-writer wins". Conflict between two *successful* responses for the same raw request is benign because the cached object is a raw response envelope, not a reconciled Source Record.
3. **Readers**: read the complete entry, close, then interpret. A rename that occurs during or after the read does not invalidate the data read, per POSIX semantics and Windows delete-sharing behavior described above.
4. **Write throughput**: file writes are serialized through a single small per-process queue in the cache seam so that temp-file creation and rename never overlap from the same process. The seam does not claim cross-process serialization.
5. **Failure classification**: transient access/rename failures on Windows are retried with jitter; persistent failures become typed cache failures, which the provider layer maps to source warnings, not to fabricated titles.
6. **Freshness**: search responses 24 hours, details 7 days, negative results 1 hour remain metadata attached to entries. Concurrency never recomputes these values on behalf of another writer.

This satisfies "bounded concurrent cache behavior without pretending portable advisory locks exist."

### 3.8 Corruption recovery

Corruption is defined as an entry whose JSON envelope cannot be parsed, whose schema/decoder version is unsupported, whose request-identity hash does not match the key, or whose body fails the source decoder for that entry type.

Policy:

- A corrupted entry is a **cache miss**, never a fallback to guessing a bibliographic identity (application principle in `docs/product-spec.md`).
- On detection, the entry is quarantined (moved aside into a project-owned quarantine subdirectory) or deleted, and a warning is emitted on stderr. Quarantine is preferred when disk space allows so users can inspect the cache; the `cache clear` operation removes both quarantine and temp litter.
- When online, recovery is a normal refetch. When offline, the outcome is the existing "partial" or "failed" state with a source warning; no entry is invented.
- Because the cache is keyed by normalized request identity and stores raw responses, a corrupt body cannot corrupt a Recommendation or Evidence Level. This is a structural guarantee of the architecture rather than an additional code path.

### 3.9 Constrained environment reads and precedence recap

The locator module must be the only code that reads platform environment variables. Rules:

- Use `Deno.env.get(name)` for each enumerated name [4]; never `toObject()`.
- Product overrides obey: **CLI flag (when defined) > environment variable > config file > built-in default**, per the architecture.
- Platform variables (`HOME`, `XDG_*`, Windows AppData variables) are not products of this precedence chain; they are inputs to the default category only.
- `BOOK_TITLE_GOOGLE_API_KEY` is not read until the Google adapter exists, at which point the permission manifest and the documented variable list change together.
- A missing environment variable equals "use the next fallback", except for variables that are required on the active platform (for example Windows with no `LOCALAPPDATA` and no derivable `USERPROFILE`); that case is the typed unsupported-environment failure.

### 3.10 Permissions under `deno run` and `deno compile`

Deno documents that permissions can be granted per permission class and that environment and network permissions can be narrowed by name/host [1, 2]. Compiled executables bake those grants at compile time; interactive runtime prompt behavior is not relied upon in non-interactive automation [3]. Least-privilege operation therefore means enumerating exactly:

- Environment variable names: the product list plus the platform list in Section 3.2. For the MVP, `BOOK_TITLE_GOOGLE_API_KEY` is excluded because it is never read.
- Network hosts: only the catalog hosts the MVP actually contacts — `openlibrary.org` and its search host, and `wikidata.org`, `www.wikidata.org`, and `query.wikidata.org` where applicable. Host allowlists are exact, not suffix-globbed.
- Read/write paths for `deno run`: the config dir and the cache dir resolved for the current process, expressed as precise absolute path grants.

For `deno run`, the manifest is fully enforceable, and tests run with a manifest that grants only the fixture directories plus the exact environment names. This is the primary least-privilege boundary for development, CI, and fixture-backed tests.

For `deno compile`, Deno resolves path allowlists at compile time [3]. A released binary cannot know an arbitrary end user's profile-derived cache/config paths at compile time. Therefore a strict per-path grant cannot, from the documented Deno surface, be expressed for a prebuilt shared binary whose default roots are the end user's runtime-computed OS directories. This is a genuine residual gap, not an implementation omission. The baseline handles it as follows:

- The persistence layer routes every filesystem operation through a narrow sealed seam (Section 3.12). The seam always re-canonicalizes and re-checks that the target path is beneath one of the two resolved roots, so the application never writes outside its declared footprint by mistake regardless of the process-level grant.
- Product documentation will state that source execution and self-compiled builds use exact path grants, and that prebuilt release binaries (Issue #10) must either (a) wait for a Deno path-denial/placeholder facility that allows runtime-scoped path grants, or (b) accept the documented broader compile-time filesystem grant limited by the sealed seam and by denied environment/network surfaces. Option (b) is a release decision, not a Core decision; #10 owns it. Environment and network grants remain narrow in every artifact.

The compiled manifest itself — even under option (b) — never includes `-A` semantics: environment stays limited to the enumerated names and network to the enumerated hosts. Those narrow surfaces survive compilation [1, 2, 3].

Known documented Deno behaviors relevant to failure outcomes:

- If a permission is required but not granted, the operation throws a `PermissionDenied`-class error that the CLI layer maps to a structured outcome [1, 2, 5]. The product maps configuration/permission failures to the documented exit-code classes rather than letting them surface as unlabeled stack traces.
- `Deno.permissions.query`/`request` exist for runtime inspection [5], but compiled executables do not get interactive prompts, so the application must not depend on `request` succeeding in release artifacts [3].

### 3.11 Failure outcomes

The file/cache seam distinguishes, as typed outcomes:

- `stored` — entry written and renamed.
- `hit_fresh` / `hit_stale` — complete entry available with its freshness metadata; stale is only returned when allowed (offline or explicit user tolerance) and is always labeled.
- `miss` — no entry; network refetch is legal.
- `corrupt` — entry unreadable; quarantine/delete and refetch.
- `permission_denied` — mapped to a diagnostic plus exit code rather than a bibliographic result.
- `unsupported_environment` — no usable platform root.
- `cancelled` — an AbortSignal reached the operation; no entry is half-written (the temp is removed or left for reclamation).

These map to the product's source-level outcomes ("partial", "all sources failed", "cancelled", and warnings), not to book outcomes such as candidates or Title Lookup results.

### 3.12 Stable seams

No production code appears in this document; the seams are described for ticket boundaries.

- **Directory locator** (`providers/platform`): pure function of platform plus a closed environment-read list. Returns config root, cache root, and diagnostics. No Core dependency.
- **Entry-file store** (the implemented cache port): operations are store-level and opaque: write-complete-entry, read-entry, delete/clear, quarantine-corrupt, reclaim-temp. The store speaks in entry outcomes (Section 3.11), never in HTTP or bibliography types.
- **Cache port** (Core-facing): the interface the architecture already reserves for a future SQLite implementation. Core depends only on this port's outcome types.
- **Environment allowlist**: a single exported constant set so the permission manifest and the runtime reads cannot drift. The distribution build consumes the same constant when constructing compile flags.
- **State/update boundary** (affected only tangentially): network effects emit messages carrying request IDs; cache outcomes are effects that emit the same message kinds so the TUI reducer remains pure.

## 4. Concrete Recommended Baseline

1. Implement a `providers/platform` directory locator that implements Section 3.1 exactly: Windows `%LOCALAPPDATA%`+`%APPDATA%`; macOS `~/Library/Caches`+`~/Library/Application Support`; Linux freedesktop `XDG_*` with `~/.config` and `~/.cache` fallbacks. App root directory name: `book-title-lookup`.
2. Allow one product override, `BOOK_TITLE_CACHE_DIR`, for the cache root. Apply the documented CLI > env > config > default precedence to product settings; platform variables never masquerade as product settings.
3. Ensure directories with `Deno.mkdir`/`@std/fs/ensure-dir` at `0o700`; never repair existing permissions; canonicalize and verify every file operation stays beneath the resolved roots.
4. Implement atomic entry writes with the documented procedure: same-directory unique temp file, write, flush (`Deno.FsFile.sync`), close, `Deno.rename`, Windows transient-failure retry with jitter.
5. Do not use advisory locks, lock files, PID files, or any emulation. Use per-key in-flight deduplication inside one process and whole-file atomic replacement across processes. "Last complete writer wins" is the only cross-process guarantee.
6. Treat recovery as a cache problem: complete old/new entries survive a process crash; orphaned temps are reclaimed when old; a final name lost to sudden power loss is a miss and a refetch. Never cache Resolved Works or recommendations.
7. Recover corruption by quarantine/delete plus refetch; corrupted data never becomes evidence.
8. Read environment variables only through the named const allowlist and only via `Deno.env.get`.
9. Permissions: `deno run` and CI use exact path, name, and host manifests. `deno compile` artifacts keep narrow environment and network surfaces; the filesystem footprint is enforced at the sealed seam, and Issue #10 records the compile-time dynamic-path limitation as an explicit release decision.
10. Keep the SQLite option open behind the existing cache port. No SQLite in the MVP baseline.

## 5. Decisions Unblocking Issues #8 and #10

These decisions are the durable artifacts of Issue #5.

- **D1 (Directory roots)**: The platform table in Section 3.1 is accepted as the specification for config and cache locations. The app directory name is `book-title-lookup`. `BOOK_TITLE_CACHE_DIR` is the single product override for the cache root.
- **D2 (Locator shape)**: Directory discovery lives behind a dedicated `providers/platform` locator. No Core or domain code computes filesystem locations, reads `HOME`, or inspects Windows AppData variables.
- **D3 (Atomic write contract)**: An entry write is same-directory temp creation, complete write, flush, close, rename, with Windows transient retry. An entry read is open-read-close. The port documents that the rename step is the atomicity boundary.
- **D4 (Concurrency contract)**: No advisory locks anywhere in the file-entry implementation. Per-process in-flight deduplication plus last-complete-writer-wins is the contract for this baseline; a future SQLite port may provide a different documented concurrency model behind the same Core-facing port.
- **D5 (Corruption contract)**: Corrupt entries are cache misses; quarantine-or-delete and refetch are the only recovery paths. No corrupted data can enter domain reasoning by construction.
- **D6 (Environment contract)**: The environment allowlist is a closed constant: product variables (MVP: `BOOK_TITLE_CONTACT`, `BOOK_TITLE_CACHE_DIR`, `BOOK_TITLE_OFFLINE`, `BOOK_TITLE_LOG_LEVEL`) plus platform variables (`HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and on Windows `LOCALAPPDATA`, `APPDATA`, `USERPROFILE`). `BOOK_TITLE_GOOGLE_API_KEY` is added only when the Google adapter is implemented.
- **D7 (Run/test permission baseline)**: All development, fixture, and CI runs use exact grants derived from the same allowlist constant as the code. No test uses `-A`.
- **D8 (For Issue #8)**: Issue #8 may implement the file-entry store and the Core-facing cache port using Sections 3.4–3.8 and 3.11 as its behavioral contract, without waiting on any further permission or locking research.
- **D9 (For Issue #10)**: Issue #10 must treat compile-time path grants as static. A prebuilt release binary cannot express a runtime-computed per-user directory grant through the documented Deno 2.9 surface, so #10 records either (a) a revisit trigger if Deno adds runtime-scoped path grants or path denial lists, or (b) an explicit release risk acceptance: narrow environment/network surfaces plus a filesystem footprint enforced by the sealed seam rather than by the process-level permission manifest. The executable must never use `-A`-style unrestricted permissions on environment or network in any option.

## 6. Fixture and Platform Test Matrix

All tests are fixture-backed; none depend on live sources. Each test isolates the locator by setting the relevant allowlisted environment variables to fixture values before process start.

| Case | Assertion | Platforms |
| --- | --- | --- |
| Default roots | Linux: `XDG_CONFIG_HOME`/`XDG_CACHE_HOME`, else `~/.config`/`~/.cache`; macOS: `~/Library/Application Support`, `~/Library/Caches`; Windows: `%APPDATA%`, `%LOCALAPPDATA%` | Linux, macOS, Windows |
| Product override | `BOOK_TITLE_CACHE_DIR` wins over platform defaults; relative value rejected as invalid config | all |
| Precedence | Where a CLI override exists: CLI > env > config file > default | all |
| Unsupported environment | Required platform var missing → typed `unsupported_environment`, not a silent fallback | all; simulated by unsetting vars |
| Directory creation/security | Root created `0o700` (POSIX), pre-existing dirs untouched, canonical paths under root | all |
| Atomic replacement | Concurrent readers see whole old or whole new entry; no partial content, no missing-name window asserted on Windows | all; Windows semantics separately |
| Crash simulation | Kill a writer at random intervals; entry is old-complete or new-complete; temp reclamation on next start | Linux, Windows |
| Windows rename contention | A helper holds an entry open without delete sharing; writer retries with jitter and eventually succeeds | Windows only |
| Cross-process concurrency | N processes write same and distinct keys; all survive; every final entry parses whole | all |
| Corruption recovery | Truncated, garbage, wrong-version, wrong-hash entries → miss, quarantine/delete, refetch online; distinct warning offline | all |
| Constrained env reads | Running without a specific env permission produces the mapped outcome, never `toObject()` or unlabeled crash | all |
| Least-privilege manifest | Fixture process with exact grants succeeds; a process denied the cache path or an unlisted env var fails with `permission_denied` mapped to the documented category | all |
| Compile smoke | Compiled artifact starts, resolves fixture roots, missing-permission cases map to structured output; run per platform in release CI | per target platform, Linux/macOS/Windows |

The matrix intentionally includes no test asserting "POSIX-equivalent atomic visibility on Windows." It also includes no live-network test; live smoke tests remain the separate low-volume suite described in the product spec.

## 7. Residual Risks and Revisit Triggers

- **Compile-time dynamic path grants**: Deno 2.9 does not document a way for a prebuilt binary to grant read/write only to a user directory whose path is computed at runtime. Revisit when Deno documents path placeholders, runtime path grants for compiled executables, or path denial lists.
- **Directory-entry durability**: The project cannot fsync a parent directory through the documented Deno API surface. Filesystems and OS configurations differ; a lost last rename may occur after power loss. Consequence is bounded to a cache miss.
- **Windows replacement semantics**: Even with delete-sharing handles and retry/jitter, antivirus or indexer interference can delay renames. The bounded retry list is part of the file seam, and its budget may need tuning on real Windows hardware; manual Windows Terminal checks remain in scope.
- **Environment union in cross-platform artifacts**: Running one source tree on three OSes requires one permission manifest containing all platform variable names, which is a slightly wider environment surface than any single OS needs. Platform-specific compiled artifacts narrow it.
- **`@std` drift**: If a future `@std/fs` gains a documented atomic-write helper with flush and replace semantics, the seam can adopt it without changing the port contract. This document does not assume such a helper exists.
- **SQLite migration**: If the cache later becomes multi-file or requires transactions, the file-entry baseline's guarantees must be re-derived for SQLite's documented locking model. The Core-facing port is unchanged.

## 8. Explicit Non-Choices

The following were considered and rejected for the MVP baseline: portable advisory locks (`flock`/`LockFileEx`) because no Deno or `@std` documented portable API exists; lock-file emulation because crash cleanup is not atomic; SQLite now because the file-per-entry model is sufficient and the port already preserves the option; `Deno.env.toObject()` because it defeats granular environment permissioning; and caching merged conclusions or Resolved Works, which the architecture already forbids.

## 9. References

All references retrieved **2026-09-05**.

1. Deno runtime manual, Permissions — https://docs.deno.com/runtime/manual/basics/permissions/
2. Deno CLI reference, flags — https://docs.deno.com/runtime/reference/cli/flags/
3. Deno CLI reference, compile — https://docs.deno.com/runtime/reference/cli/compile/
4. Deno API, `Deno.env` — https://docs.deno.com/api/deno/~/Deno.env
5. Deno API, `Deno.permissions` — https://docs.deno.com/api/deno/~/Deno.permissions
6. Deno API, `Deno.open` and open options — https://docs.deno.com/api/deno/~/Deno.open
7. Deno API, `Deno.FsFile.sync`/`syncData` — https://docs.deno.com/api/deno/~/Deno.FsFile.syncData
8. Deno API, `Deno.rename` — https://docs.deno.com/api/deno/~/Deno.rename
9. Deno API, `Deno.makeTempFile` — https://docs.deno.com/api/deno/~/Deno.makeTempFile
10. Deno API, `Deno.mkdir` — https://docs.deno.com/api/deno/~/Deno.mkdir
11. Deno API, `Deno.remove` — https://docs.deno.com/api/deno/~/Deno.remove
12. Deno API, `Deno.stat` — https://docs.deno.com/api/deno/~/Deno.stat
13. `@std/fs` documentation — https://jsr.io/@std/fs
14. `@std/path` documentation — https://jsr.io/@std/path
15. `@std/async` documentation (semaphore/retry helpers) — https://jsr.io/@std/async
16. freedesktop, XDG Base Directory Specification — https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
17. Microsoft, Known Folders — https://learn.microsoft.com/en-us/windows/win32/shell/knownfolders
18. Microsoft, `MoveFileExW` — https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw
19. Microsoft, `ReplaceFileW` — https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew
20. Microsoft, `CreateFileW` (share modes) — https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
21. Microsoft, `FlushFileBuffers` — https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
22. POSIX.1-2017, `rename` — https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html
23. Linux man-pages, `rename(2)` and `fsync(2)` — https://man7.org/linux/man-pages/man2/rename.2.html and https://man7.org/linux/man-pages/man2/fsync.2.html
24. Apple, File System Programming Guide — https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
