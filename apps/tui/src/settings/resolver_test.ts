import { assertEquals } from "@std/assert";
import { MemoryEnvironment } from "../../../../packages/providers/src/platform/env.ts";
import {
  APP_DIRECTORY_NAME,
} from "../../../../packages/providers/src/platform/platform.ts";
import { joinPath } from "../../../../packages/providers/src/platform/paths.ts";
import {
  DenoFileSystemSeam,
  type FileSystemSeam,
} from "../../../../packages/providers/src/cache/fs-seam.ts";
import { resolveSettings, type SettingsInput } from "./resolver.ts";

class NoConfigFs extends DenoFileSystemSeam {
  override readTextFile(_path: string) {
    return Promise.resolve({ ok: false as const, error: "not_found" as const });
  }
}

function testInput(overrides: Partial<SettingsInput> = {}): SettingsInput {
  return {
    env: new MemoryEnvironment({}),
    platform: "linux",
    fs: new NoConfigFs(),
    cli: {},
    ...overrides,
  };
}

Deno.test("settings defaults resolve every setting from the default source", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({ HOME: "/home/alice" }),
      platform: "linux",
    }),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.settings.configRoot,
    "/home/alice/.config/book-title-lookup",
  );
  assertEquals(
    result.settings.cacheRoot,
    "/home/alice/.cache/book-title-lookup",
  );
  assertEquals(result.settings.offline, false);
  assertEquals(result.settings.logLevel, "info");
  assertEquals(result.settings.contact, undefined);
  assertEquals(result.settings.sources, {
    offline: "default",
    logLevel: "default",
    contact: "default",
    cacheRoot: "default",
  });
});

Deno.test("settings environment overrides config file and default per setting", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        HOME: "/home/alice",
        BOOK_TITLE_OFFLINE: "true",
        BOOK_TITLE_LOG_LEVEL: "warn",
        BOOK_TITLE_CONTACT: "alice@example.com",
      }),
      platform: "linux",
    }),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.settings.offline, true);
  assertEquals(result.settings.logLevel, "warn");
  assertEquals(result.settings.contact, "alice@example.com");
  assertEquals(result.settings.sources.offline, "environment");
  assertEquals(result.settings.sources.logLevel, "environment");
  assertEquals(result.settings.sources.contact, "environment");
});

Deno.test("settings cli flag beats environment for offline", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        HOME: "/home/alice",
        BOOK_TITLE_OFFLINE: "false",
      }),
      platform: "linux",
      cli: { offline: true },
    }),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.settings.offline, true);
  assertEquals(result.settings.sources.offline, "cli");
});

Deno.test("settings config file supplies offline/logLevel/contact origins", async () => {
  const fs = new WindowsMemoryFs();
  fs.files.set(
    windowsConfigPath(WINDOWS_APPDATA),
    JSON.stringify({
      schemaVersion: "config.v1",
      offline: true,
      logLevel: "debug",
      contact: "config@example.com",
    }),
  );
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        APPDATA: WINDOWS_APPDATA,
        LOCALAPPDATA: WINDOWS_LOCALAPPDATA,
        USERPROFILE: WINDOWS_USERPROFILE,
      }),
      platform: "windows",
      fs,
    }),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.settings.configRoot, windowsConfigRoot(WINDOWS_APPDATA));
  assertEquals(result.settings.offline, true);
  assertEquals(result.settings.logLevel, "debug");
  assertEquals(result.settings.contact, "config@example.com");
  assertEquals(result.settings.sources.offline, "config_file");
  assertEquals(result.settings.sources.logLevel, "config_file");
  assertEquals(result.settings.sources.contact, "config_file");
});

Deno.test("settings cacheRoot precedence is cli > environment > default, never config", async () => {
  const env = new MemoryEnvironment({
    HOME: "/home/alice",
    BOOK_TITLE_CACHE_DIR: "/env/cache",
  });
  const fromEnv = await resolveSettings(testInput({ env, platform: "linux" }));
  assertEquals(fromEnv.ok, true);
  if (!fromEnv.ok) return;
  assertEquals(fromEnv.settings.cacheRoot, "/env/cache");
  assertEquals(fromEnv.settings.sources.cacheRoot, "environment");

  const fromCli = await resolveSettings(
    testInput({
      env,
      platform: "linux",
      cli: { cacheDir: "/cli/cache" },
    }),
  );
  assertEquals(fromCli.ok, true);
  if (!fromCli.ok) return;
  assertEquals(fromCli.settings.cacheRoot, "/cli/cache");
  assertEquals(fromCli.settings.sources.cacheRoot, "cli");
});

Deno.test("settings relative cacheRoot overrides are invalid_config", async () => {
  const fromEnv = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        HOME: "/home/alice",
        BOOK_TITLE_CACHE_DIR: "relative/cache",
      }),
      platform: "linux",
    }),
  );
  assertEquals(fromEnv.ok, false);
  if (!fromEnv.ok) assertEquals(fromEnv.failure.kind, "invalid_config");

  const fromCli = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({ HOME: "/home/alice" }),
      platform: "linux",
      cli: { cacheDir: "relative/cache" },
    }),
  );
  assertEquals(fromCli.ok, false);
  if (!fromCli.ok) assertEquals(fromCli.failure.kind, "invalid_config");
});

Deno.test("settings invalid config file yields invalid_config, never a book outcome", async () => {
  for (
    const content of [
      "not json",
      JSON.stringify({ schemaVersion: "config.v9" }),
      JSON.stringify({ schemaVersion: "config.v1", unknownKey: true }),
      JSON.stringify({ schemaVersion: "config.v1", offline: "yes" }),
      JSON.stringify({ schemaVersion: "config.v1", logLevel: "loud" }),
      JSON.stringify({ schemaVersion: "config.v1", contact: 7 }),
    ]
  ) {
    const fs = new WindowsMemoryFs();
    fs.files.set(windowsConfigPath(WINDOWS_APPDATA), content);
    const result = await resolveSettings(
      testInput({
        env: new MemoryEnvironment({
          APPDATA: WINDOWS_APPDATA,
          LOCALAPPDATA: WINDOWS_LOCALAPPDATA,
          USERPROFILE: WINDOWS_USERPROFILE,
        }),
        platform: "windows",
        fs,
      }),
    );
    assertEquals(result.ok, false, `expected failure for ${content}`);
    if (!result.ok) assertEquals(result.failure.kind, "invalid_config");
  }
});

Deno.test("settings denied environment variable maps to permission_denied", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment(
        { HOME: "/home/alice" },
        { deny: ["BOOK_TITLE_OFFLINE"] },
      ),
      platform: "linux",
    }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.failure.kind, "permission_denied");
});

Deno.test("settings denied config read maps to permission_denied", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        APPDATA: WINDOWS_APPDATA,
        LOCALAPPDATA: WINDOWS_LOCALAPPDATA,
        USERPROFILE: WINDOWS_USERPROFILE,
      }),
      platform: "windows",
      fs: new DenyFs(),
    }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.failure.kind, "permission_denied");
});

Deno.test("settings unsupported platform maps to typed failure", async () => {
  const result = await resolveSettings(
    testInput({ env: new MemoryEnvironment({}), platform: "windows" }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.failure.kind, "unsupported_environment");
});

Deno.test("settings invalid environment boolean is invalid_config", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        HOME: "/home/alice",
        BOOK_TITLE_OFFLINE: "banana",
      }),
      platform: "linux",
    }),
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.failure.kind, "invalid_config");
});

Deno.test("settings contact is inherited from environment when config lacks it", async () => {
  const result = await resolveSettings(
    testInput({
      env: new MemoryEnvironment({
        HOME: "/home/alice",
        BOOK_TITLE_CONTACT: "env@example.com",
      }),
      platform: "linux",
    }),
  );
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.settings.contact, "env@example.com");
  assertEquals(result.settings.sources.contact, "environment");
});

// ---------------------------------------------------------------------------
// Windows config-file fixture
// ---------------------------------------------------------------------------
// The config-file tests exercise the Windows resolver path (backslash lexical
// joins) without touching a real host filesystem. A real temp dir is always a
// native path (POSIX on the Linux/macOS runners), so combining it with Windows
// backslash separators would break the fixture on non-Windows CI. Instead the
// config file lives in an in-memory fs keyed by the same Windows lexical paths
// the resolver requests, making the fixture deterministic on every host while
// the assertions stay genuinely Windows-shaped.

const WINDOWS_APPDATA = "C:\\Users\\fixture\\AppData\\Roaming";
const WINDOWS_LOCALAPPDATA = "C:\\Users\\fixture\\AppData\\Local";
const WINDOWS_USERPROFILE = "C:\\Users\\fixture";

function windowsConfigRoot(appDataRoot: string): string {
  return joinPath("windows", appDataRoot, APP_DIRECTORY_NAME);
}

function windowsConfigPath(appDataRoot: string): string {
  return joinPath("windows", appDataRoot, APP_DIRECTORY_NAME, "config.json");
}

/**
 * In-memory FileSystemSeam keyed by exact Windows lexical path strings. Only
 * readTextFile is exercised by resolveSettings; the remaining seam methods stay
 * inert so the fixture never reaches a real host filesystem.
 */
class WindowsMemoryFs implements FileSystemSeam {
  readonly files = new Map<string, string>();

  mkdir(
    _path: string,
    _options?: { readonly recursive?: boolean; readonly mode?: number },
  ) {
    return Promise.resolve({ ok: true as const });
  }
  stat(_path: string) {
    return Promise.resolve({ ok: false as const, error: "not_found" as const });
  }
  openForWrite(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
    });
  }
  readTextFile(path: string) {
    const text = this.files.get(path);
    return Promise.resolve(
      text === undefined
        ? { ok: false as const, error: "not_found" as const }
        : { ok: true as const, text },
    );
  }
  rename(_from: string, _to: string) {
    return Promise.resolve({ ok: true as const });
  }
  remove(_path: string) {
    return Promise.resolve({ ok: true as const });
  }
  listDirectory(_path: string) {
    return Promise.resolve({ ok: true as const, names: [] as string[] });
  }
}

class DenyFs implements FileSystemSeam {
  mkdir(
    _path: string,
    _options?: { readonly recursive?: boolean; readonly mode?: number },
  ) {
    return Promise.resolve({ ok: true as const });
  }
  stat(_path: string) {
    return Promise.resolve({ ok: false as const, error: "not_found" as const });
  }
  openForWrite(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
    });
  }
  readTextFile(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
    });
  }
  rename(_from: string, _to: string) {
    return Promise.resolve({ ok: true as const });
  }
  remove(_path: string) {
    return Promise.resolve({ ok: true as const });
  }
  listDirectory(_path: string) {
    return Promise.resolve({ ok: true as const, names: [] as string[] });
  }
}
