/**
 * Unit tests for the issue #12 option-grammar parser implemented for the
 * issue #32 maintenance surface. Global options may appear before or after
 * the command token; per-command options validate against each command's
 * frozen grammar.
 */

import { assertEquals } from "@std/assert";
import { type GlobalFlags, type HelpScope, parseArgs } from "./args.ts";

function ok(args: string[]) {
  const parsed = parseArgs(args);
  assertEquals(parsed.ok, true, args.join(" "));
  if (!parsed.ok) throw new Error(`unexpected parse failure: ${parsed.error}`);
  return parsed.invocation;
}

function err(args: string[]) {
  const parsed = parseArgs(args);
  assertEquals(parsed.ok, false, args.join(" "));
  if (parsed.ok) throw new Error("expected parse failure");
  return parsed.error;
}

function globalOf(invocation: { readonly global: GlobalFlags }): GlobalFlags {
  return invocation.global;
}

Deno.test("cli/args help scopes resolve for every command surface", () => {
  assertEquals(ok(["--help"]).mode, "help");
  assertEquals((ok(["--help"]) as { scope: HelpScope }).scope, { kind: "top" });
  assertEquals(ok(["cache", "--help"]).mode, "help");
  assertEquals(ok(["cache", "list", "--help"]).mode, "help");
  assertEquals(ok(["cache", "show", "--help"]).mode, "help");
  assertEquals(ok(["config", "--help"]).mode, "help");
  assertEquals(ok(["config", "show", "--help"]).mode, "help");
  assertEquals(ok(["titles", "--help"]).mode, "help");
  assertEquals(ok(["search", "--help"]).mode, "help");
  assertEquals(ok(["resolve", "--help"]).mode, "help");
});

Deno.test("cli/args --help wins over other behavior and survives odd tokens", () => {
  const invocation = ok([
    "--cache-dir",
    "somewhere",
    "cache",
    "list",
    "--help",
  ]);
  assertEquals(invocation.mode, "help");
});

Deno.test("cli/args --version is top-level only", () => {
  assertEquals(ok(["--version"]).mode, "version");
  assertEquals(ok(["--version", "--json"]).mode, "version");
  assertParseError(["config", "--version"], /top level|--version/);
});

Deno.test("cli/args global options parse before or after the command token", () => {
  const before = ok([
    "--json",
    "--debug",
    "--offline",
    "--cache-dir",
    "/a",
    "--color",
    "config",
    "show",
  ]);
  assertEquals(before.mode, "config");
  const g1 = globalOf(before as { global: GlobalFlags });
  assertEquals(g1.json, true);
  assertEquals(g1.debug, true);
  assertEquals(g1.offline, true);
  assertEquals(g1.cacheDir, "/a");
  assertEquals(g1.color, true);
  assertEquals(g1.noColor, false);

  const after = ok([
    "config",
    "show",
    "--json",
    "--debug",
    "--cache-dir=/b",
    "--no-color",
  ]);
  assertEquals(after.mode, "config");
  const g2 = globalOf(after as { global: GlobalFlags });
  assertEquals(g2.json, true);
  assertEquals(g2.cacheDir, "/b");
  assertEquals(g2.noColor, true);
  assertEquals(g2.color, false);
});

Deno.test("cli/args single-value options use --flag value and --flag=value equivalently", () => {
  const spaced = ok(["config", "show", "--cache-dir", "/x"]);
  const equals = ok(["config", "show", "--cache-dir=/x"]);
  assertEquals(
    globalOf(spaced as { global: GlobalFlags }).cacheDir,
    globalOf(equals as { global: GlobalFlags }).cacheDir,
  );
});

Deno.test("cli/args cache and config subcommand grammar", () => {
  const list = ok(["cache", "list"]);
  assertEquals(list.mode, "cache");
  const clear = ok(["cache", "clear"]);
  assertEquals(clear.mode, "cache");
  const show = ok(["cache", "show", "f".repeat(64)]);
  assertEquals(show.mode, "cache");
  if (show.mode === "cache") assertEquals(show.digest, "f".repeat(64));

  const cfg = ok(["config", "show"]);
  assertEquals(cfg.mode, "config");
});

Deno.test("cli/args unknown commands and options are usage errors", () => {
  assertParseError(["frobnicate"], /unknown command/);
  assertParseError(["cache", "list", "--titles", "x"], /unknown option/);
  assertParseError(["search", "--titles", "x"], /unknown option/);
  assertParseError(["--bogus", "config", "show"], /unknown option/);
});

Deno.test("cli/args missing and malformed subcommand input are usage errors", () => {
  assertParseError(["cache"], /subcommand|list|show|clear/);
  assertParseError(["config"], /show/);
  assertParseError(["cache", "browse"], /unknown subcommand/);
  assertParseError(["config", "print"], /unknown subcommand/);
  assertParseError(["cache", "show"], /digest/);
  assertParseError(["cache", "show", "abc"], /digest/);
  assertParseError(["cache", "list", "extra"], /unexpected argument/);
  assertParseError(["config", "show", "extra"], /unexpected argument/);
  assertParseError(["titles", "positional"], /unexpected argument/);
});

Deno.test("cli/args lookup required options and conflicts follow issue #12", () => {
  assertParseError(["resolve"], /--reference|--isbn/);
  assertParseError(
    [
      "resolve",
      "--isbn",
      "9780140328721",
      "--reference",
      "openlibrary:work:OL274505W",
    ],
    /only one|--isbn|--reference/,
  );
  assertParseError(["titles"], /--reference/);
  const titles = ok([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--language",
    "es",
    "--language",
    "zh",
  ]);
  assertEquals(titles.mode, "lookup");
});

Deno.test("cli/args repeated single-value options are usage errors", () => {
  assertParseError(
    ["--cache-dir", "/a", "--cache-dir", "/b"],
    /only be given once/,
  );
  assertParseError(
    ["titles", "--reference", "a:b", "--reference", "c:d"],
    /only be given once/,
  );
  const language = ok([
    "titles",
    "--reference",
    "a:b",
    "--language",
    "es",
    "--language",
    "zh",
  ]);
  assertEquals(language.mode, "lookup");
});

Deno.test("cli/args value-taking options require a value", () => {
  assertParseError(["--cache-dir"], /value/);
  assertParseError(["search", "--title"], /value/);
});

Deno.test("cli/args flags reject the equals form", () => {
  assertParseError(["--json=true"], /does not take a value/);
});

function assertParseError(args: string[], pattern: RegExp): void {
  const message = err(args);
  assertEquals(
    pattern.test(message),
    true,
    `expected ${pattern} in ${message}`,
  );
}
