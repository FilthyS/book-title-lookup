import { assertEquals } from "@std/assert";
import { detectPlatformKind, type PlatformKind } from "./platform.ts";
import { MemoryEnvironment } from "./env.ts";
import { resolveDefaultRoots } from "./locator.ts";

Deno.test("platform/locator Linux uses XDG bases with home fallbacks", () => {
  const env = new MemoryEnvironment({
    XDG_CONFIG_HOME: "/home/alice/.config",
    XDG_CACHE_HOME: "/home/alice/.cache",
    HOME: "/home/alice",
  });
  const result = resolveDefaultRoots({ env, platform: "linux" });
  assertEquals(result, {
    status: "ok",
    configRoot: "/home/alice/.config/book-title-lookup",
    cacheRoot: "/home/alice/.cache/book-title-lookup",
  });
});

Deno.test("platform/locator Linux falls back to HOME when XDG vars are unset", () => {
  const env = new MemoryEnvironment({ HOME: "/home/alice" });
  const result = resolveDefaultRoots({ env, platform: "linux" });
  assertEquals(result, {
    status: "ok",
    configRoot: "/home/alice/.config/book-title-lookup",
    cacheRoot: "/home/alice/.cache/book-title-lookup",
  });
});

Deno.test("platform/locator Linux ignores a relative XDG value (freedesktop rule)", () => {
  const env = new MemoryEnvironment({
    HOME: "/home/alice",
    XDG_CONFIG_HOME: "relative/config",
    XDG_CACHE_HOME: "relative/cache",
  });
  const result = resolveDefaultRoots({ env, platform: "linux" });
  assertEquals(result, {
    status: "ok",
    configRoot: "/home/alice/.config/book-title-lookup",
    cacheRoot: "/home/alice/.cache/book-title-lookup",
  });
});

Deno.test("platform/locator Linux without HOME is unsupported, never a silent fallback", () => {
  const result = resolveDefaultRoots({
    env: new MemoryEnvironment({}),
    platform: "linux",
  });
  assertEquals(result.status, "unsupported_environment");
});

Deno.test("platform/locator macOS uses Library bases from HOME", () => {
  const env = new MemoryEnvironment({ HOME: "/Users/alice" });
  const result = resolveDefaultRoots({ env, platform: "darwin" });
  assertEquals(result, {
    status: "ok",
    configRoot: "/Users/alice/Library/Application Support/book-title-lookup",
    cacheRoot: "/Users/alice/Library/Caches/book-title-lookup",
  });
});

Deno.test("platform/locator macOS without HOME is unsupported", () => {
  const result = resolveDefaultRoots({
    env: new MemoryEnvironment({}),
    platform: "darwin",
  });
  assertEquals(result.status, "unsupported_environment");
});

Deno.test("platform/locator Windows uses APPDATA and LOCALAPPDATA", () => {
  const env = new MemoryEnvironment({
    APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local",
  });
  const result = resolveDefaultRoots({ env, platform: "windows" });
  assertEquals(result, {
    status: "ok",
    configRoot: "C:\\Users\\alice\\AppData\\Roaming\\book-title-lookup",
    cacheRoot: "C:\\Users\\alice\\AppData\\Local\\book-title-lookup",
  });
});

Deno.test("platform/locator Windows derives AppData from USERPROFILE", () => {
  const env = new MemoryEnvironment({ USERPROFILE: "C:\\Users\\alice" });
  const result = resolveDefaultRoots({ env, platform: "windows" });
  assertEquals(result, {
    status: "ok",
    configRoot: "C:\\Users\\alice\\AppData\\Roaming\\book-title-lookup",
    cacheRoot: "C:\\Users\\alice\\AppData\\Local\\book-title-lookup",
  });
});

Deno.test("platform/locator Windows with neither AppData nor USERPROFILE is unsupported", () => {
  const result = resolveDefaultRoots({
    env: new MemoryEnvironment({}),
    platform: "windows",
  });
  assertEquals(result.status, "unsupported_environment");
});

Deno.test("platform/locator a denied platform variable maps to permission_denied", () => {
  const env = new MemoryEnvironment(
    { APPDATA: "C:\\AppData" },
    { deny: ["LOCALAPPDATA"] },
  );
  const result = resolveDefaultRoots({ env, platform: "windows" });
  assertEquals(result, {
    status: "permission_denied",
    name: "LOCALAPPDATA",
  });
});

Deno.test("platform/locator deterministic fixture roots match platform table", () => {
  // Windows + POSIX fixture rows (issue #5 fixture matrix) produce canonical
  // absolute roots; never a relative or working-directory path.
  const windows = resolveDefaultRoots({
    env: new MemoryEnvironment({
      APPDATA: "C:\\Users\\fixture\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local",
    }),
    platform: "windows",
  });
  const posix = resolveDefaultRoots({
    env: new MemoryEnvironment({
      HOME: "/home/fixture",
      XDG_CONFIG_HOME: "/home/fixture/.config",
      XDG_CACHE_HOME: "/home/fixture/.cache",
    }),
    platform: "linux",
  });
  assertEquals(windows, {
    status: "ok",
    configRoot: "C:\\Users\\fixture\\AppData\\Roaming\\book-title-lookup",
    cacheRoot: "C:\\Users\\fixture\\AppData\\Local\\book-title-lookup",
  });
  assertEquals(posix, {
    status: "ok",
    configRoot: "/home/fixture/.config/book-title-lookup",
    cacheRoot: "/home/fixture/.cache/book-title-lookup",
  });
});

Deno.test("platform/locator maps supported Node platform tokens", () => {
  assertEquals(detectPlatformKind("win32"), "windows" as PlatformKind);
  assertEquals(detectPlatformKind("windows"), "windows" as PlatformKind);
  assertEquals(detectPlatformKind("darwin"), "darwin" as PlatformKind);
  assertEquals(detectPlatformKind("linux"), "linux" as PlatformKind);
  let unsupported: unknown;
  try {
    detectPlatformKind("freebsd");
  } catch (error) {
    unsupported = error;
  }
  assertEquals(unsupported instanceof RangeError, true);
});
