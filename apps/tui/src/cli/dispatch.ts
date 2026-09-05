/**
 * CLI driver for the issue #32 maintenance surface.
 *
 * Owns mode selection (help/version/config/cache and the parse-time-only
 * lookup commands), settings resolution, cache-store construction, JSON and
 * human output, stdout/stderr separation, and exit-code mapping per issue #12
 * sections 3, 6, 8.4/8.5, and 10.4. Usage and configuration failures write
 * diagnostics to stderr and exit 2; cancellation writes the cancelled
 * document under --json and exits 130.
 */

import {
  type CacheOperation,
  type GlobalFlags,
  type Invocation,
  parseArgs,
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
import { versionLine } from "../version.ts";
import { resolveSettings, type SettingsFailure } from "../settings/resolver.ts";
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
}

/**
 * Current decoder schema versions for the envelope read verification. The
 * maintenance slice stores and inspects raw envelopes; the provider slice
 * owns future decoder bumps.
 */
export const CLI_DECODER_SCHEMA_VERSIONS = {
  openlibrary: 1,
  wikidata: 1,
} as const;

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
    case "lookup": {
      await deps.stderr.write(
        usageErrorText(
          `command '${invocation.command}' is not available in this build; ` +
            "this slice runs only the maintenance surface (cache and config)",
        ),
      );
      return 2;
    }
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
