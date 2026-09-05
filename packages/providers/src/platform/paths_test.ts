import { assertEquals } from "@std/assert";
import {
  canonicalPath,
  isAbsolutePath,
  isPathWithin,
  joinPath,
  type PathStyle,
  relativePathFrom,
  styleFromPlatform,
} from "./paths.ts";

const POSIX: PathStyle = "posix";
const WINDOWS: PathStyle = "windows";

Deno.test("platform/paths canonicalize posix paths", () => {
  assertEquals(
    canonicalPath("/home/alice/./docs/../.cache", POSIX),
    "/home/alice/.cache",
  );
  assertEquals(canonicalPath("/home//alice/", POSIX), "/home/alice");
  assertEquals(canonicalPath("/", POSIX), "/");
  assertEquals(canonicalPath("/a/b/../../..", POSIX), "/");
});

Deno.test("platform/paths canonicalize windows paths", () => {
  assertEquals(
    canonicalPath("C:\\Users\\alice\\.\\docs\\..\\.cache", WINDOWS),
    "C:\\Users\\alice\\.cache",
  );
  assertEquals(
    canonicalPath("C:/Users/alice/AppData/Roaming/", WINDOWS),
    "C:\\Users\\alice\\AppData\\Roaming",
  );
  assertEquals(canonicalPath("c:\\Users\\alice", WINDOWS), "C:\\Users\\alice");
  assertEquals(canonicalPath("C:\\", WINDOWS), "C:\\");
});

Deno.test("platform/paths absolute detection", () => {
  assertEquals(isAbsolutePath("/home/alice", POSIX), true);
  assertEquals(isAbsolutePath("home/alice", POSIX), false);
  assertEquals(isAbsolutePath("C:\\Users\\alice", WINDOWS), true);
  assertEquals(isAbsolutePath("C:/Users/alice", WINDOWS), true);
  assertEquals(isAbsolutePath("Users\\alice", WINDOWS), false);
  assertEquals(isAbsolutePath("\\\\server\\share\\app", WINDOWS), true);
});

Deno.test("platform/paths containment rejects siblings and prefix tricks", () => {
  assertEquals(
    isPathWithin(
      "/home/alice/.cache/book-title-lookup",
      "/home/alice/.cache/book-title-lookup/v1/a.json",
      POSIX,
    ),
    true,
  );
  assertEquals(
    isPathWithin(
      "/home/alice/.cache/book-title-lookup",
      "/home/alice/.cache/book-title-lookup-evil/x",
      POSIX,
    ),
    false,
  );
  assertEquals(
    isPathWithin(
      "/home/alice/.cache/book-title-lookup",
      "/home/alice/.cache/book-title-lookup/../config.json",
      POSIX,
    ),
    false,
  );
  assertEquals(
    isPathWithin(
      "/home/alice/.cache/book-title-lookup",
      "/home/alice/.cache/book-title-lookup",
      POSIX,
    ),
    true,
  );
  assertEquals(
    isPathWithin(
      "C:\\Users\\alice\\cache\\book-title-lookup",
      "C:\\Users\\alice\\cache\\book-title-lookup\\v1\\a.json",
      WINDOWS,
    ),
    true,
  );
  assertEquals(
    isPathWithin(
      "C:\\Users\\alice\\cache\\book-title-lookup",
      "C:\\Users\\alice\\cache\\book-title-lookup-evil\\x",
      WINDOWS,
    ),
    false,
  );
  assertEquals(
    isPathWithin(
      "C:\\Users\\alice\\cache\\book-title-lookup",
      "c:\\users\\alice\\cache\\book-title-lookup\\v1\\a.json",
      WINDOWS,
    ),
    true,
  );
});

Deno.test("platform/paths join is deterministic per style", () => {
  assertEquals(
    joinPath(POSIX, "/home/alice", ".cache", "book-title-lookup"),
    "/home/alice/.cache/book-title-lookup",
  );
  assertEquals(
    joinPath(WINDOWS, "C:\\Users\\alice", "AppData", "Local"),
    "C:\\Users\\alice\\AppData\\Local",
  );
});

Deno.test("platform/paths relativePathFrom returns null when outside parent", () => {
  assertEquals(
    relativePathFrom("/root/v1", "/root/v1/a.json", POSIX),
    "a.json",
  );
  assertEquals(
    relativePathFrom("/root/v1", "/root/v1/a/b.json", POSIX),
    "a/b.json",
  );
  assertEquals(relativePathFrom("/root/v1", "/other/a.json", POSIX), null);
  assertEquals(relativePathFrom("/root/v1", "/root/v1", POSIX), "");
});

Deno.test("platform/paths style maps platforms", () => {
  assertEquals(styleFromPlatform("windows"), WINDOWS);
  assertEquals(styleFromPlatform("darwin"), POSIX);
  assertEquals(styleFromPlatform("linux"), POSIX);
});
