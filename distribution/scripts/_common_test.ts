/**
 * Focused tests for the frozen target matrix and the narrow compile-flag
 * derivation (ticket #20 / section 6.6; npm-release-topology.md section 4;
 * issue #5 D7/D9). Pure, no subprocess.
 */

import { assert, assertEquals } from "@std/assert";
import {
  compileFlags,
  networkHosts,
  targetByDenoTarget,
  targetForHost,
  TARGETS,
} from "./_common.ts";
import { ENV_ALLOWLIST } from "../../packages/providers/src/platform/env.ts";
import { OL_HOSTS } from "../../packages/providers/src/openlibrary/config.ts";
import { WD_HOSTS } from "../../packages/providers/src/wikidata/config.ts";

Deno.test("compile/matrix the four MVP targets are frozen", () => {
  assertEquals(
    TARGETS.map((t) => t.denoTarget),
    [
      "x86_64-pc-windows-msvc",
      "x86_64-unknown-linux-gnu",
      "x86_64-apple-darwin",
      "aarch64-apple-darwin",
    ],
  );
});

Deno.test("compile/matrix each target maps to its frozen npm name", () => {
  assertEquals(TARGETS.map((t) => t.packageName), [
    "book-title-lookup-win32-x64",
    "book-title-lookup-linux-x64",
    "book-title-lookup-darwin-x64",
    "book-title-lookup-darwin-arm64",
  ]);
  assertEquals(TARGETS.map((t) => `${t.os}/${t.cpu}`), [
    "win32/x64",
    "linux/x64",
    "darwin/x64",
    "darwin/arm64",
  ]);
});

Deno.test("compile/matrix lookup helpers resolve and miss correctly", () => {
  assertEquals(
    targetByDenoTarget("x86_64-apple-darwin")?.packageName,
    "book-title-lookup-darwin-x64",
  );
  assertEquals(
    targetForHost("linux", "x64")?.denoTarget,
    "x86_64-unknown-linux-gnu",
  );
  assertEquals(targetByDenoTarget("x86_64-unknown-linux-musl"), undefined);
  assertEquals(targetForHost("linux", "arm64"), undefined);
});

Deno.test("compile/flags never use -A and stay narrow", () => {
  const flags = compileFlags();
  for (const flag of flags) {
    assert(!["-A", "--allow-all"].includes(flag), flag);
  }
});

Deno.test("compile/flags environment grant equals the ENV_ALLOWLIST union", () => {
  const envFlag = compileFlags().find((f) => f.startsWith("--allow-env="))!;
  const granted = envFlag.slice("--allow-env=".length).split(",").sort();
  const expected = [...ENV_ALLOWLIST].sort();
  assertEquals(granted, expected);
});

Deno.test("compile/flags network grant equals the exact catalog hosts", () => {
  const netFlag = compileFlags().find((f) => f.startsWith("--allow-net="))!;
  const granted = netFlag.slice("--allow-net=".length).split(",").sort();
  const expected = [...OL_HOSTS, ...WD_HOSTS].sort();
  assertEquals(granted, expected);
  // No suffix globbing / wildcard host.
  assert(!netFlag.includes("*"));
});

Deno.test("compile/flags network hosts are the documented exact set", () => {
  assertEquals([...networkHosts()].sort(), [
    "openlibrary.org",
    "query.wikidata.org",
    "wikidata.org",
    "www.wikidata.org",
  ]);
});
