/**
 * SettingsResolver (issue #10 sections 16 and 17).
 *
 * The TUI composition root owns precedence resolution over the platform
 * primitives: CLI flag > environment variable > user config file > built-in
 * default, applied per setting. Directory roots never come from the config
 * file; `--cache-dir` and `BOOK_TITLE_CACHE_DIR` override cacheRoot entirely.
 * Resolution returns typed failures; it never throws a descriptive string and
 * never reports a book outcome.
 */

import type { EnvironmentReader } from "../../../../packages/providers/src/platform/env.ts";
import { resolveDefaultRoots } from "../../../../packages/providers/src/platform/locator.ts";
import {
  canonicalPath,
  isAbsolutePath,
  joinPath,
  type PathStyle,
  styleFromPlatform,
} from "../../../../packages/providers/src/platform/paths.ts";
import type { PlatformKind } from "../../../../packages/providers/src/platform/platform.ts";
import type { FileSystemSeam } from "../../../../packages/providers/src/cache/fs-seam.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type SettingSource = "cli" | "environment" | "config_file" | "default";

export interface ResolvedSettings {
  readonly configRoot: string;
  readonly cacheRoot: string;
  readonly offline: boolean;
  readonly logLevel: LogLevel;
  readonly contact?: string;
  readonly sources: {
    readonly offline: SettingSource;
    readonly logLevel: SettingSource;
    readonly contact: SettingSource;
    readonly cacheRoot: SettingSource;
  };
}

export interface SettingsInput {
  readonly env: EnvironmentReader;
  readonly platform: PlatformKind;
  readonly fs: FileSystemSeam;
  readonly cli: {
    readonly offline?: boolean;
    readonly cacheDir?: string;
  };
  readonly signal?: AbortSignal;
}

export type SettingsFailure =
  | { readonly kind: "invalid_config"; readonly detail: string }
  | { readonly kind: "permission_denied"; readonly detail: string }
  | { readonly kind: "unsupported_environment"; readonly detail: string }
  | { readonly kind: "cancelled" };

export type SettingsResult =
  | { readonly ok: true; readonly settings: ResolvedSettings }
  | { readonly ok: false; readonly failure: SettingsFailure };

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const USER_CONFIG_FILE = "config.json";
const CONFIG_SCHEMA_VERSION = "config.v1";

interface UserConfigFileV1 {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  readonly offline?: boolean;
  readonly logLevel?: LogLevel;
  readonly contact?: string;
}

function permissionDetail(name: string): string {
  return `environment variable ${name} was denied by the process permission grant`;
}

export async function resolveSettings(
  input: SettingsInput,
): Promise<SettingsResult> {
  if (input.signal?.aborted) {
    return { ok: false, failure: { kind: "cancelled" } };
  }
  const style: PathStyle = styleFromPlatform(input.platform);

  const roots = resolveDefaultRoots({
    env: input.env,
    platform: input.platform,
  });
  if (roots.status === "permission_denied") {
    return {
      ok: false,
      failure: {
        kind: "permission_denied",
        detail: permissionDetail(roots.name),
      },
    };
  }
  if (roots.status === "unsupported_environment") {
    return {
      ok: false,
      failure: { kind: "unsupported_environment", detail: roots.detail },
    };
  }

  // Cache root: CLI > environment > default. Roots never come from config.
  let cacheRoot: string;
  let cacheRootSource: SettingSource;
  if (input.cli.cacheDir !== undefined) {
    if (!isAbsolutePath(input.cli.cacheDir, style)) {
      return {
        ok: false,
        failure: {
          kind: "invalid_config",
          detail: "--cache-dir must be an absolute path",
        },
      };
    }
    cacheRoot = canonicalPath(input.cli.cacheDir, style);
    cacheRootSource = "cli";
  } else {
    const envOverride = input.env.read("BOOK_TITLE_CACHE_DIR");
    if (!envOverride.ok) {
      return {
        ok: false,
        failure: {
          kind: "permission_denied",
          detail: permissionDetail("BOOK_TITLE_CACHE_DIR"),
        },
      };
    }
    const value = envOverride.value?.trim();
    if (value !== undefined && value !== "") {
      if (!isAbsolutePath(value, style)) {
        return {
          ok: false,
          failure: {
            kind: "invalid_config",
            detail: "BOOK_TITLE_CACHE_DIR must be an absolute path when set",
          },
        };
      }
      cacheRoot = canonicalPath(value, style);
      cacheRootSource = "environment";
    } else {
      cacheRoot = roots.cacheRoot;
      cacheRootSource = "default";
    }
  }

  const configResult = await readUserConfig(input, roots.configRoot, style);
  if (!configResult.ok) return configResult;

  // Offline: cli > env > config > default.
  let offline = false;
  let offlineSource: SettingSource = "default";
  if (input.cli.offline !== undefined) {
    offline = input.cli.offline;
    offlineSource = "cli";
  } else {
    const envOffline = input.env.read("BOOK_TITLE_OFFLINE");
    if (!envOffline.ok) {
      return {
        ok: false,
        failure: {
          kind: "permission_denied",
          detail: permissionDetail("BOOK_TITLE_OFFLINE"),
        },
      };
    }
    if (envOffline.value !== undefined && envOffline.value.trim() !== "") {
      const parsed = parseBool(envOffline.value);
      if (parsed === undefined) {
        return {
          ok: false,
          failure: {
            kind: "invalid_config",
            detail:
              `BOOK_TITLE_OFFLINE has an invalid boolean value: ${envOffline.value}`,
          },
        };
      }
      offline = parsed;
      offlineSource = "environment";
    } else if (configResult.config?.offline !== undefined) {
      offline = configResult.config.offline;
      offlineSource = "config_file";
    }
  }

  // Log level: env > config > default.
  let logLevel: LogLevel = "info";
  let logLevelSource: SettingSource = "default";
  const envLogLevel = input.env.read("BOOK_TITLE_LOG_LEVEL");
  if (!envLogLevel.ok) {
    return {
      ok: false,
      failure: {
        kind: "permission_denied",
        detail: permissionDetail("BOOK_TITLE_LOG_LEVEL"),
      },
    };
  }
  if (envLogLevel.value !== undefined && envLogLevel.value.trim() !== "") {
    const value = envLogLevel.value.trim().toLowerCase();
    if (!isLogLevel(value)) {
      return {
        ok: false,
        failure: {
          kind: "invalid_config",
          detail:
            `BOOK_TITLE_LOG_LEVEL has an invalid value: ${envLogLevel.value}`,
        },
      };
    }
    logLevel = value;
    logLevelSource = "environment";
  } else if (configResult.config?.logLevel !== undefined) {
    logLevel = configResult.config.logLevel;
    logLevelSource = "config_file";
  }

  // Contact: env > config > unset.
  let contact: string | undefined;
  let contactSource: SettingSource = "default";
  const envContact = input.env.read("BOOK_TITLE_CONTACT");
  if (!envContact.ok) {
    return {
      ok: false,
      failure: {
        kind: "permission_denied",
        detail: permissionDetail("BOOK_TITLE_CONTACT"),
      },
    };
  }
  if (envContact.value !== undefined && envContact.value.trim() !== "") {
    contact = envContact.value.trim();
    contactSource = "environment";
  } else if (configResult.config?.contact !== undefined) {
    contact = configResult.config.contact;
    contactSource = "config_file";
  }

  const settings: ResolvedSettings = {
    configRoot: roots.configRoot,
    cacheRoot,
    offline,
    logLevel,
    ...(contact !== undefined ? { contact } : {}),
    sources: {
      offline: offlineSource,
      logLevel: logLevelSource,
      contact: contactSource,
      cacheRoot: cacheRootSource,
    },
  };
  return { ok: true, settings };
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function parseBool(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

type ConfigReadResult =
  | { readonly ok: true; readonly config?: UserConfigFileV1 }
  | { readonly ok: false; readonly failure: SettingsFailure };

async function readUserConfig(
  input: SettingsInput,
  configRoot: string,
  style: PathStyle,
): Promise<ConfigReadResult> {
  const path = joinPath(style, configRoot, USER_CONFIG_FILE);
  const read = await input.fs.readTextFile(path);
  if (!read.ok) {
    if (read.error === "not_found") return { ok: true };
    if (read.error === "permission_denied") {
      return {
        ok: false,
        failure: {
          kind: "permission_denied",
          detail: `cannot read config file ${path}`,
        },
      };
    }
    return {
      ok: false,
      failure: {
        kind: "invalid_config",
        detail: `cannot read config file ${path}`,
      },
    };
  }
  const parsed = parseUserConfigFile(read.text);
  if (!parsed.ok) {
    return {
      ok: false,
      failure: { kind: "invalid_config", detail: parsed.detail },
    };
  }
  return { ok: true, config: parsed.config };
}

function parseUserConfigFile(
  json: string,
): { ok: true; config: UserConfigFileV1 } | { ok: false; detail: string } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, detail: "config file is not valid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, detail: "config file must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return {
      ok: false,
      detail: `config file schemaVersion must be ${CONFIG_SCHEMA_VERSION}`,
    };
  }
  for (const key of Object.keys(record)) {
    if (
      key !== "schemaVersion" && key !== "offline" && key !== "logLevel" &&
      key !== "contact"
    ) {
      return { ok: false, detail: `unknown config key: ${key}` };
    }
  }
  if (record.offline !== undefined && typeof record.offline !== "boolean") {
    return { ok: false, detail: "config key offline must be a boolean" };
  }
  if (record.logLevel !== undefined && (!isLogLevel(String(record.logLevel)))) {
    return {
      ok: false,
      detail: `config key logLevel has an invalid value: ${
        String(record.logLevel)
      }`,
    };
  }
  if (record.contact !== undefined && typeof record.contact !== "string") {
    return { ok: false, detail: "config key contact must be a string" };
  }
  return {
    ok: true,
    config: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      ...(record.offline !== undefined
        ? { offline: record.offline as boolean }
        : {}),
      ...(record.logLevel !== undefined
        ? { logLevel: record.logLevel as LogLevel }
        : {}),
      ...(record.contact !== undefined
        ? { contact: record.contact as string }
        : {}),
    },
  };
}

export const configFileName = USER_CONFIG_FILE;
export const configSchemaVersion = CONFIG_SCHEMA_VERSION;
