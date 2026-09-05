/**
 * Focused tests for package-tree validation helpers (ticket #20 / section
 * 6.6; npm-release-topology.md sections 5, 7, 11.1). Pure, no subprocess.
 */

import { assert, assertEquals } from "@std/assert";
import { TARGETS } from "./_common.ts";
import {
  checkFileList,
  isForbiddenFileName,
  launcherExpectedFiles,
  launcherOptionalDependencyNames,
  launcherPackageJson,
  PLACEHOLDER_VERSION,
  platformExpectedFiles,
  platformPackageJson,
} from "./_package.ts";

Deno.test("package/validation the launcher pins every platform dep to the version", () => {
  const seed = launcherPackageJson("1.2.3");
  assertEquals(seed.name, "book-title-lookup");
  assertEquals(seed.version, "1.2.3");
  assertEquals(seed.bin, { "book-title": "bin/book-title.js" });
  const entries = Object.entries(seed.optionalDependencies ?? {}).sort();
  const expected = [...launcherOptionalDependencyNames()].sort().map(
    (name) => [name, "1.2.3"],
  );
  assertEquals(entries, expected);
  assertEquals(new Set(Object.values(seed.optionalDependencies ?? {})).size, 1);
});

Deno.test("package/validation templates use the placeholder version", () => {
  const launcher = launcherPackageJson(PLACEHOLDER_VERSION);
  assertEquals(launcher.version, PLACEHOLDER_VERSION);
  for (const name of launcherOptionalDependencyNames()) {
    assertEquals(launcher.optionalDependencies![name], PLACEHOLDER_VERSION);
  }
});

Deno.test("package/validation platform packages carry no bin and correct metadata", () => {
  for (const target of TARGETS) {
    const seed = platformPackageJson(target, "1.2.3");
    assertEquals(seed.name, target.packageName);
    assertEquals(seed.version, "1.2.3");
    assertEquals(seed.main, "index.js");
    assertEquals(seed.os, [target.os]);
    assertEquals(seed.cpu, [target.cpu]);
    assertEquals(seed.bin, undefined);
    assertEquals(seed.optionalDependencies, undefined);
  }
});

Deno.test("package/validation expected file sets match the topology", () => {
  assertEquals(launcherExpectedFiles(), [
    "package.json",
    "bin/book-title.js",
  ]);
  const win = platformExpectedFiles(TARGETS[0]);
  assertEquals(win, ["package.json", "index.js", "bin/book-title.exe"]);
  const unix = platformExpectedFiles(TARGETS[1]);
  assertEquals(unix, ["package.json", "index.js", "bin/book-title"]);
});

Deno.test("package/validation an exact file list passes", () => {
  const result = checkFileList(
    ["package.json", "bin/book-title.js"],
    ["package.json", "bin/book-title.js"],
  );
  assert(result.ok, result.messages.join("; "));
  assertEquals(result.messages.length, 0);
});

Deno.test("package/validation forbidden files are rejected", () => {
  const result = checkFileList(
    ["package.json", "bin/book-title", "package-lock.json", ".env"],
    ["package.json", "bin/book-title"],
  );
  assertEquals(result.ok, false);
  assert(
    result.messages.some((m) => m.includes("forbidden file packed: .env")),
  );
  assert(
    result.messages.some((m) => m.includes("package-lock.json")),
  );
});

Deno.test("package/validation a missing expected file is reported", () => {
  const result = checkFileList(["package.json"], launcherExpectedFiles());
  assertEquals(result.ok, false);
  assert(result.messages.some((m) => m.includes("expected file missing")));
});

Deno.test("package/validation forbidden-name predicate", () => {
  assert(isForbiddenFileName("deno.lock"));
  assert(isForbiddenFileName("node_modules/pkg/index.js"));
  assert(isForbiddenFileName("package/.npmrc"));
  assert(!isForbiddenFileName("package.json"));
  assert(!isForbiddenFileName("bin/book-title.js"));
});
