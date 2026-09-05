/**
 * Platform directory locator (issue #5 D1/D2, issue #10 sections 7.1/16).
 *
 * Computes the config and cache roots from the platform discovery variables
 * only. Product overrides (`BOOK_TITLE_CACHE_DIR`, a future CLI flag) are
 * applied by the SettingsResolver on top of these defaults, so roots are
 * never read from the config file and a denied or relative override is a
 * typed failure, never a silent fallback.
 */

import type { EnvironmentReader, EnvName } from "./env.ts";
import {
  canonicalPath,
  joinPath,
  type PathStyle,
  styleFromPlatform,
} from "./paths.ts";
import { APP_DIRECTORY_NAME, type PlatformKind } from "./platform.ts";

export type RootsResult =
  | {
    readonly status: "ok";
    readonly configRoot: string;
    readonly cacheRoot: string;
  }
  | { readonly status: "permission_denied"; readonly name: EnvName }
  | { readonly status: "unsupported_environment"; readonly detail: string };

interface ResolveInput {
  readonly env: EnvironmentReader;
  readonly platform: PlatformKind;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

function canonicalJoin(style: PathStyle, base: string, name: string): string {
  return canonicalPath(joinPath(style, base, name), style);
}

export function resolveDefaultRoots(input: ResolveInput): RootsResult {
  const { env, platform } = input;
  const style: PathStyle = styleFromPlatform(platform);
  const read = (name: EnvName): string | undefined | null => {
    const result = env.read(name);
    if (!result.ok) {
      if (result.error === "permission_denied") return null;
    }
    return result.ok ? nonEmpty(result.value) : undefined;
  };

  const readHome = () => read("HOME");
  const home = readHome();
  if (home === null) {
    return { status: "permission_denied", name: "HOME" };
  }

  const readAbsolute = (
    name: EnvName,
    fallback: string | undefined,
  ): string | undefined | null => {
    const value = read(name);
    if (value === null) return null;
    if (value === undefined) return fallback;
    if (!isAbsoluteFor(value, style)) {
      return fallback; // freedesktop: relative XDG values are ignored.
    }
    return value;
  };

  const isAbsoluteFor = (value: string, s: PathStyle): boolean =>
    s === "windows"
      ? /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
      : value.startsWith("/");

  switch (platform) {
    case "linux": {
      const configBase = readAbsolute(
        "XDG_CONFIG_HOME",
        home ? joinPath(style, home, ".config") : undefined,
      );
      const cacheBase = readAbsolute(
        "XDG_CACHE_HOME",
        home ? joinPath(style, home, ".cache") : undefined,
      );
      if (configBase === null) {
        return { status: "permission_denied", name: "XDG_CONFIG_HOME" };
      }
      if (cacheBase === null) {
        return { status: "permission_denied", name: "XDG_CACHE_HOME" };
      }
      if (!configBase || !cacheBase) {
        return {
          status: "unsupported_environment",
          detail: "neither XDG_CONFIG_HOME/XDG_CACHE_HOME nor HOME is set",
        };
      }
      return {
        status: "ok",
        configRoot: canonicalJoin(style, configBase, APP_DIRECTORY_NAME),
        cacheRoot: canonicalJoin(style, cacheBase, APP_DIRECTORY_NAME),
      };
    }
    case "darwin": {
      if (!home) {
        return {
          status: "unsupported_environment",
          detail: "HOME is required on macOS",
        };
      }
      return {
        status: "ok",
        configRoot: canonicalJoin(
          style,
          joinPath(style, home, "Library", "Application Support"),
          APP_DIRECTORY_NAME,
        ),
        cacheRoot: canonicalJoin(
          style,
          joinPath(style, home, "Library", "Caches"),
          APP_DIRECTORY_NAME,
        ),
      };
    }
    case "windows": {
      const appdata = read("APPDATA");
      if (appdata === null) {
        return { status: "permission_denied", name: "APPDATA" };
      }
      const localappdata = read("LOCALAPPDATA");
      if (localappdata === null) {
        return { status: "permission_denied", name: "LOCALAPPDATA" };
      }
      const userprofile = read("USERPROFILE");
      if (userprofile === null) {
        return { status: "permission_denied", name: "USERPROFILE" };
      }

      const configBase = appdata ??
        (userprofile
          ? joinPath(style, userprofile, "AppData", "Roaming")
          : undefined);
      const cacheBase = localappdata ??
        (userprofile
          ? joinPath(style, userprofile, "AppData", "Local")
          : undefined);
      if (!configBase || !cacheBase) {
        return {
          status: "unsupported_environment",
          detail:
            "neither APPDATA/LOCALAPPDATA nor USERPROFILE provides usable AppData roots",
        };
      }
      return {
        status: "ok",
        configRoot: canonicalJoin(style, configBase, APP_DIRECTORY_NAME),
        cacheRoot: canonicalJoin(style, cacheBase, APP_DIRECTORY_NAME),
      };
    }
  }
}
