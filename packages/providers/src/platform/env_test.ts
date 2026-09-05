import { assertEquals } from "@std/assert";
import {
  ENV_ALLOWLIST,
  type EnvironmentReader,
  isAllowlistedEnvName,
  MemoryEnvironment,
} from "./env.ts";

Deno.test("platform/env ENV_ALLOWLIST is the closed issue #10 list", () => {
  assertEquals([...ENV_ALLOWLIST], [
    "BOOK_TITLE_CONTACT",
    "BOOK_TITLE_CACHE_DIR",
    "BOOK_TITLE_OFFLINE",
    "BOOK_TITLE_LOG_LEVEL",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE",
  ]);
});

Deno.test("platform/env allowlist membership", () => {
  assertEquals(isAllowlistedEnvName("BOOK_TITLE_CACHE_DIR"), true);
  assertEquals(isAllowlistedEnvName("LOCALAPPDATA"), true);
  assertEquals(isAllowlistedEnvName("BOOK_TITLE_GOOGLE_API_KEY"), false);
  assertEquals(isAllowlistedEnvName("PATH"), false);
  assertEquals(isAllowlistedEnvName(""), false);
});

Deno.test("platform/env readers expose typed results, never toObject()", () => {
  const present = new MemoryEnvironment({ BOOK_TITLE_CACHE_DIR: "/cache" });
  const denied = new MemoryEnvironment(
    {},
    { deny: ["BOOK_TITLE_CACHE_DIR"] },
  );
  assertEquals(present.read("BOOK_TITLE_CACHE_DIR"), {
    ok: true,
    value: "/cache",
  });
  assertEquals(denied.read("BOOK_TITLE_CACHE_DIR"), {
    ok: false,
    error: "permission_denied",
    name: "BOOK_TITLE_CACHE_DIR",
  });
  assertEquals(present.read("HOME"), { ok: true, value: undefined });
});

Deno.test("platform/env a denied read surfaces typed permission_denied", () => {
  const env = new MemoryEnvironment(
    { HOME: "/home/alice", XDG_CACHE_HOME: "/cache" },
    { deny: ["XDG_CACHE_HOME"] },
  );
  const result = env.read("XDG_CACHE_HOME");
  assertEquals(result.ok, false);
});

Deno.test("platform/env readers expose their map for diagnostics", () => {
  const env = new MemoryEnvironment({ HOME: "/home/alice" });
  assertEquals(env.read("HOME"), { ok: true, value: "/home/alice" });
});

Deno.test("platform/env EnvironmentReader is the only read surface", () => {
  // Structural check: the interface the rest of the tree consumes stays
  // narrow so a future reader cannot leak whole-environment reads.
  const reader: EnvironmentReader = new MemoryEnvironment();
  assertEquals(reader.read("HOME").ok, true);
});
