/**
 * CLI driver for the book-title surface (issue #12/#13).
 *
 * Owns mode selection (help/version/config/cache/lookup), settings
 * resolution for maintenance commands, cache-store construction, the
 * directed coordinator sessions for search/resolve/titles, JSON and human
 * output, stdout/stderr separation, and exit-code mapping. Usage and
 * configuration failures write diagnostics to stderr and exit 2.
 */

import {
  type CacheOperation,
  type GlobalFlags,
  type Invocation,
  parseArgs,
  type ResolveTargetOptions,
  type SearchQueryOptions,
} from "./args.ts";
import { helpTextForScope, usageErrorText } from "./usage.ts";
import {
  cacheCancelledDocument,
  cacheClearDocument,
  cacheListDocument,
  cacheShowDocument,
  configCancelledDocument,
  configShowDocument,
} from "../json/doc-builders.ts";
import { serializeJsonDocument } from "../json/serialize.ts";
import {
  cacheClearHuman,
  cacheListHuman,
  cacheShowHuman,
  configShowHuman,
} from "./human.ts";
import {
  failuresToStderr,
  humanTextForSummary,
  warningsToStderr,
} from "./human-lookup.ts";
import { versionLine } from "../version.ts";
import { resolveSettings, type SettingsFailure } from "../settings/resolver.ts";
import { buildComposedCatalog } from "../catalog/composed-catalog.ts";
import { PROVIDER_DECODER_SCHEMA_VERSIONS } from "../../../../packages/providers/src/openlibrary/config.ts";
import { documentForSummary } from "./json.ts";
import type {
  EnvironmentReader,
} from "../../../../packages/providers/src/platform/env.ts";
import type {
  FileSystemSeam,
} from "../../../../packages/providers/src/cache/fs-seam.ts";
import type {
  PlatformKind,
} from "../../../../packages/providers/src/platform/platform.ts";
import type { Clock } from "../../../../packages/providers/src/cache/clock.ts";
import type {
  RandomSource,
} from "../../../../packages/providers/src/cache/random.ts";
import {
  FileEntryStore,
} from "../../../../packages/providers/src/cache/file-entry-store.ts";
import type {
  CacheShowOutcome,
} from "../../../../packages/providers/src/cache/store.ts";
import type {
  RawResponseEnvelopeV1,
} from "../../../../packages/providers/src/cache/envelope.ts";
import type {
  BookTitleCatalog,
  ExternalReference,
  SourceFailure,
  SourceWarning,
} from "../../../../packages/core/src/module.ts";
import { emptyQueryDraft, type SessionState } from "../coordinator/state.ts";
import { runDirectedSession } from "./directed-session.ts";
import {
  type LookupCommand,
  projectTerminal,
  type TerminalSummary,
} from "../coordinator/projections.ts";
import type { Message } from "../coordinator/messages.ts";

export interface TextWriter {
  write(text: string): Promise<void>;
}

export interface CliDeps {
  readonly stdout: TextWriter;
  readonly stderr: TextWriter;
  readonly env: EnvironmentReader;
  readonly fs: FileSystemSeam;
  readonly platform: PlatformKind;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly signal?: AbortSignal;
  /** The catalog behind lookup commands. When absent, the CLI builds the
   *  real Open Library composition from resolved settings; tests inject the
   *  fixture catalog explicitly. */
  catalog?: BookTitleCatalog;
}

/**
 * Current decoder schema versions for the envelope read verification.
 * One constant in Providers owns the stamps; this re-export prevents drift.
 */
export const CLI_DECODER_SCHEMA_VERSIONS = PROVIDER_DECODER_SCHEMA_VERSIONS;

interface CancelShape {
  readonly json: boolean;
  readonly document: () => object;
}

export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    await deps.stderr.write(usageErrorText(parsed.error));
    return 2;
  }
  return await dispatch(parsed.invocation, deps);
}

async function dispatch(
  invocation: Invocation,
  deps: CliDeps,
): Promise<number> {
  switch (invocation.mode) {
    case "help": {
      await deps.stdout.write(helpTextForScope(invocation.scope));
      return 0;
    }
    case "version": {
      await deps.stdout.write(`${versionLine()}\n`);
      return 0;
    }
    case "no_command": {
      await deps.stderr.write(
        usageErrorText(
          "no command given; the interactive TUI is not available in this build",
        ),
      );
      return 2;
    }
    case "lookup":
      return await runLookup(invocation, deps);
    case "config":
      return await runConfig(invocation.global, deps);
    case "cache":
      return await runCache(
        invocation.operation,
        invocation.digest,
        invocation.global,
        deps,
      );
  }
}

// ---------------------------------------------------------------------------
// Lookup commands (issue #13 directed sessions)
// ---------------------------------------------------------------------------

async function runLookup(
  invocation: Extract<Invocation, { readonly mode: "lookup" }>,
  deps: CliDeps,
): Promise<number> {
  const command = invocation.command;
  if (deps.signal?.aborted) {
    return await writeLookupCancelled(command, deps, invocation.global.json);
  }
  let catalog: BookTitleCatalog;
  if (deps.catalog !== undefined) {
    // Tests and fixture harnesses inject an explicit catalog; production
    // CLI runs use the real two-source composition below.
    catalog = deps.catalog;
  } else {
    const resolved = await createDefaultLookupCatalog(
      invocation.global,
      deps,
    );
    if (!resolved.ok) return resolved.code;
    catalog = resolved.catalog;
  }
  const seed = seedForCommand(invocation);
  const initial = initialMessage(invocation);
  const result = await runDirectedSession({
    seed,
    messages: [initial],
    catalog,
    signal: deps.signal,
  });
  const summary = projectTerminal(command, result.state);
  const exitCode = summary.status === "cancelled" ? 130 : exitCodeFor(summary);
  if (invocation.global.json) {
    await deps.stdout.write(
      serializeJsonDocument(documentForSummary(command, summary)),
    );
  } else {
    await deps.stdout.write(humanTextForSummary(summary));
  }
  if (
    summary.status === "found" || summary.status === "needs_choice" ||
    summary.status === "resolved" || summary.status === "not_found" ||
    summary.status === "titles_found" ||
    summary.status === "no_attested_titles"
  ) {
    await deps.stderr.write(warningsToStderr(summaryWarnings(summary)));
  } else if (summary.status === "failed") {
    await deps.stderr.write(failuresToStderr(summaryFailures(summary)));
  }
  return exitCode;
}

function summaryWarnings(summary: TerminalSummary): readonly SourceWarning[] {
  switch (summary.status) {
    case "found":
    case "needs_choice":
    case "resolved":
    case "not_found":
    case "titles_found":
    case "no_attested_titles":
      return summary.warnings;
    default:
      return [];
  }
}

function summaryFailures(summary: TerminalSummary): readonly SourceFailure[] {
  return summary.status === "failed" ? summary.failures : [];
}

async function createDefaultLookupCatalog(
  global: GlobalFlags,
  deps: CliDeps,
): Promise<
  | { readonly ok: true; readonly catalog: BookTitleCatalog }
  | { readonly ok: false; readonly code: number }
> {
  const settingsResult = await resolveSettings({
    env: deps.env,
    platform: deps.platform,
    fs: deps.fs,
    cli: {
      offline: global.offline ? true : undefined,
      cacheDir: global.cacheDir,
    },
    signal: deps.signal,
  });
  if (!settingsResult.ok) {
    const code = await settingsFailureExit(settingsResult.failure, deps, {
      json: global.json,
      document: () => configCancelledDocument(),
    });
    return { ok: false, code };
  }
  const catalog = buildComposedCatalog({
    settings: settingsResult.settings,
    clock: deps.clock,
    fs: deps.fs,
    random: deps.random,
    platform: deps.platform,
  });
  return { ok: true, catalog };
}

function seedForCommand(
  invocation: Extract<Invocation, { readonly mode: "lookup" }>,
): SessionState {
  if (invocation.command === "search") {
    return searchSeed(invocation.query, invocation.global);
  }
  if (invocation.command === "resolve") {
    return {
      screen: "query",
      goal: { kind: "resolve" },
      draft: emptyQueryDraft(),
      targetLanguages: [],
      notice: null,
    };
  }
  return {
    screen: "query",
    goal: { kind: "lookup" },
    draft: emptyQueryDraft(),
    targetLanguages: invocation.languages,
    notice: null,
  };
}

function searchSeed(
  query: SearchQueryOptions,
  _global: GlobalFlags,
): SessionState {
  const draft = {
    fields: {
      title: { text: query.title, cursor: query.title.length },
      author: {
        text: query.author ?? "",
        cursor: (query.author ?? "").length,
      },
      isbn: { text: query.isbn ?? "", cursor: (query.isbn ?? "").length },
      year: {
        text: query.year === undefined ? "" : String(query.year),
        cursor: query.year === undefined ? 0 : String(query.year).length,
      },
    },
    focused: "title" as const,
  };
  return {
    screen: "query",
    goal: { kind: "lookup" },
    draft,
    targetLanguages: [],
    notice: null,
  };
}

function initialMessage(
  invocation: Extract<Invocation, { readonly mode: "lookup" }>,
): Message {
  if (invocation.command === "search") {
    return { type: "submitSearch" };
  }
  const target = resolveTargetFor(
    invocation.command === "resolve"
      ? invocation.target
      : { kind: "reference", reference: invocation.reference },
  );
  return { type: "resolveReference", reference: target.reference };
}

function resolveTargetFor(target: ResolveTargetOptions): {
  readonly reference: ExternalReference;
} {
  if (target.kind === "isbn") {
    return { reference: { namespace: "isbn", value: target.value } };
  }
  return { reference: target.reference };
}

async function writeLookupCancelled(
  command: LookupCommand,
  deps: CliDeps,
  json: boolean,
): Promise<number> {
  const summary: TerminalSummary = { status: "cancelled" };
  if (json) {
    await deps.stdout.write(
      serializeJsonDocument(documentForSummary(command, summary)),
    );
  } else {
    await deps.stderr.write("book-title: interrupted\n");
  }
  return 130;
}

function exitCodeFor(summary: TerminalSummary): number {
  switch (summary.status) {
    case "found":
      return 3;
    case "needs_choice":
      return 3;
    case "resolved":
      return 0;
    case "not_found":
      return 4;
    case "failed":
      return 10;
    case "cancelled":
      return 130;
    case "titles_found":
      return 0;
    case "no_attested_titles":
      return 5;
  }
}

// ---------------------------------------------------------------------------
// Maintenance commands (issue #32 surface, unchanged)
// ---------------------------------------------------------------------------

async function runConfig(global: GlobalFlags, deps: CliDeps): Promise<number> {
  const settingsResult = await resolveSettings({
    env: deps.env,
    platform: deps.platform,
    fs: deps.fs,
    cli: {
      offline: global.offline ? true : undefined,
      cacheDir: global.cacheDir,
    },
    signal: deps.signal,
  });
  if (!settingsResult.ok) {
    return await settingsFailureExit(settingsResult.failure, deps, {
      json: global.json,
      document: configCancelledDocument,
    });
  }
  if (global.json) {
    await deps.stdout.write(
      serializeJsonDocument(configShowDocument(settingsResult.settings)),
    );
  } else {
    await deps.stdout.write(configShowHuman(settingsResult.settings));
  }
  return 0;
}

async function runCache(
  operation: CacheOperation,
  digest: string | undefined,
  global: GlobalFlags,
  deps: CliDeps,
): Promise<number> {
  const settingsResult = await resolveSettings({
    env: deps.env,
    platform: deps.platform,
    fs: deps.fs,
    cli: {
      offline: global.offline ? true : undefined,
      cacheDir: global.cacheDir,
    },
    signal: deps.signal,
  });
  if (!settingsResult.ok) {
    return await settingsFailureExit(settingsResult.failure, deps, {
      json: global.json,
      document: () => cacheCancelledDocument(operation),
    });
  }
  const store = new FileEntryStore({
    cacheRoot: settingsResult.settings.cacheRoot,
    clock: deps.clock,
    fs: deps.fs,
    random: deps.random,
    decoderSchemaVersions: CLI_DECODER_SCHEMA_VERSIONS,
    platform: deps.platform,
  });

  if (operation === "list") {
    const outcome = await store.list({ signal: deps.signal });
    if (outcome.status === "ok") {
      if (global.json) {
        await deps.stdout.write(
          serializeJsonDocument(cacheListDocument(outcome.entries)),
        );
      } else {
        await deps.stdout.write(cacheListHuman(outcome.entries));
      }
      return 0;
    }
    return await cacheFailureExit(outcome, deps, {
      json: global.json,
      document: () => cacheCancelledDocument("list"),
    });
  }

  if (operation === "show") {
    const outcome = await store.show(digest as string, { signal: deps.signal });
    return await showOutcomeExit(outcome, digest as string, global, deps);
  }

  const outcome = await store.clear({ signal: deps.signal });
  if (outcome.status === "ok") {
    if (global.json) {
      await deps.stdout.write(
        serializeJsonDocument(
          cacheClearDocument(outcome.removedEntries, outcome.removedBytes),
        ),
      );
    } else {
      await deps.stdout.write(
        cacheClearHuman(outcome.removedEntries, outcome.removedBytes),
      );
    }
    return 0;
  }
  return await cacheFailureExit(outcome, deps, {
    json: global.json,
    document: () => cacheCancelledDocument("clear"),
  });
}

async function showOutcomeExit(
  outcome: CacheShowOutcome,
  digest: string,
  global: GlobalFlags,
  deps: CliDeps,
): Promise<number> {
  if (outcome.status === "ok") {
    if (global.json) {
      await deps.stdout.write(
        serializeJsonDocument(
          cacheShowDocument(
            digest,
            outcome.entry as RawResponseEnvelopeV1,
            global.debug,
          ),
        ),
      );
    } else {
      await deps.stdout.write(
        cacheShowHuman(
          digest,
          outcome.entry as RawResponseEnvelopeV1,
          global.debug,
        ),
      );
    }
    return 0;
  }
  if (outcome.status === "cancelled") {
    return await exitCancelled(deps, {
      json: global.json,
      document: () => cacheCancelledDocument("show"),
    });
  }
  if (outcome.status === "not_found") {
    await deps.stderr.write(
      usageErrorText(`cache entry not found: ${outcome.digest}`),
    );
    return 2;
  }
  if (outcome.status === "corrupt") {
    await deps.stderr.write(
      usageErrorText(`cache entry ${digest} is corrupt and was quarantined`),
    );
    return 2;
  }
  return await cacheFailureExit(outcome, deps, {
    json: global.json,
    document: () => cacheCancelledDocument("show"),
  });
}

type FailureOutcome =
  | { readonly status: "permission_denied"; readonly path: string }
  | { readonly status: "unsupported_environment" };

function isFailureOutcome(
  value: { readonly status: string },
): value is FailureOutcome {
  return value.status === "permission_denied" ||
    value.status === "unsupported_environment";
}

async function cacheFailureExit(
  outcome: { readonly status: string },
  deps: CliDeps,
  cancel: CancelShape,
): Promise<number> {
  if (outcome.status === "cancelled") return await exitCancelled(deps, cancel);
  if (isFailureOutcome(outcome)) {
    const detail = outcome.status === "permission_denied"
      ? `permission denied: ${outcome.path}`
      : "unsupported environment";
    await deps.stderr.write(
      usageErrorText(`cannot access cache: ${detail}`),
    );
    return 2;
  }
  await deps.stderr.write(usageErrorText("cache operation failed"));
  return 2;
}

async function settingsFailureExit(
  failure: SettingsFailure,
  deps: CliDeps,
  cancel: CancelShape,
): Promise<number> {
  if (failure.kind === "cancelled") return await exitCancelled(deps, cancel);
  const text = failure.kind === "invalid_config"
    ? `invalid configuration: ${failure.detail}`
    : failure.kind === "permission_denied"
    ? `permission denied: ${failure.detail}`
    : `unsupported environment: ${failure.detail}`;
  await deps.stderr.write(usageErrorText(text));
  return 2;
}

async function exitCancelled(
  deps: CliDeps,
  cancel: CancelShape,
): Promise<number> {
  if (cancel.json) {
    await deps.stdout.write(serializeJsonDocument(cancel.document()));
  } else {
    await deps.stderr.write("book-title: interrupted\n");
  }
  return 130;
}
