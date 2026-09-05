/**
 * Focused tests for the single-version-stamp tooling (ticket #20 / section
 * 6.6; npm-release-topology.md section 7.1). Pure, no subprocess.
 */

import { assertEquals } from "@std/assert";
import {
  DEFAULT_VERSION,
  isValidVersion,
  parseReleaseVersion,
  resolveReleaseVersion,
} from "./version.ts";

Deno.test("version/metadata a valid plain major.minor.patch is accepted", () => {
  assertEquals(isValidVersion("1.2.3"), true);
  assertEquals(isValidVersion("0.1.0"), true);
  assertEquals(isValidVersion("10.20.30"), true);
});

Deno.test("version/metadata invalid and prerelease forms are rejected", () => {
  assertEquals(isValidVersion("1.2"), false);
  assertEquals(isValidVersion("v1.2.3"), false);
  assertEquals(isValidVersion("1.2.3-rc1"), false);
  assertEquals(isValidVersion(""), false);
  assertEquals(isValidVersion("abc"), false);
});

Deno.test("version/metadata parse returns the cleaned value", () => {
  const parsed = parseReleaseVersion(" 1.2.3 ");
  assertEquals(parsed, { ok: true, version: "1.2.3" });
});

Deno.test("version/metadata the environment override is authoritative", async () => {
  const resolved = await resolveReleaseVersion({
    env: (name) => name === "BOOK_TITLE_RELEASE_VERSION" ? "2.0.0" : undefined,
    readTag: () => Promise.resolve(null),
  });
  assertEquals(resolved, { version: "2.0.0", source: "env" });
});

Deno.test("version/metadata a git vX.Y.Z tag is next in precedence", async () => {
  const resolved = await resolveReleaseVersion({
    env: () => undefined,
    readTag: () => Promise.resolve("0.2.0"),
  });
  assertEquals(resolved, { version: "0.2.0", source: "git_tag" });
});

Deno.test("version/metadata the default source version is the fallback", async () => {
  const resolved = await resolveReleaseVersion({
    env: () => undefined,
    readTag: () => Promise.resolve(null),
    defaultVersion: "0.1.0",
  });
  assertEquals(resolved.version, DEFAULT_VERSION);
  assertEquals(resolved.source, "default");
});

Deno.test("version/metadata an invalid override is a hard error", async () => {
  await assertEquals(
    await resolveReleaseVersion({
      env: () => "not-a-version",
      readTag: () => Promise.resolve(null),
    }).then(
      () => "resolved",
      (error: unknown) => error instanceof Error ? "threw" : "unknown",
    ),
    "threw",
  );
});
