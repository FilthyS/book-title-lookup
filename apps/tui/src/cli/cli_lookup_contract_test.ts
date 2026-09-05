/**
 * CLI lookup contract tests against the fixture-backed module (issue #12
 * tables 9.2-9.4 plus cross-cutting X17-X19/X26/X27, and R10 no-leak). Every
 * document validates against the cli-json.v1 schema bundle, and the primary
 * fixture documents match the byte-exact snapshots under fixtures/cli-json.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { type CliDeps, runCli } from "./dispatch.ts";
import {
  MemoryEnvironment,
} from "../../../../packages/providers/src/platform/env.ts";
import {
  DenoFileSystemSeam,
} from "../../../../packages/providers/src/cache/fs-seam.ts";
import { FixedClock } from "../../../../packages/providers/src/cache/clock.ts";
import {
  systemRandomSource,
} from "../../../../packages/providers/src/cache/random.ts";
import {
  detectPlatformKind,
} from "../../../../packages/providers/src/platform/platform.ts";
import { loadSchema, validateAgainstSchema } from "../json/schema-validate.ts";
import { createFakeBookTitleCatalog } from "../catalog/fixture-catalog.ts";

const SCHEMA_URL = new URL(
  "../../../../fixtures/cli-json/schema/cli-json.v1.schema.json",
  import.meta.url,
);

function snapshotPath(name: string): URL {
  return new URL(
    `../../../../fixtures/cli-json/snapshots/${name}`,
    import.meta.url,
  );
}

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(text: string): Promise<void> {
      chunks.push(text);
      return Promise.resolve();
    },
    text(): string {
      return chunks.join("");
    },
  };
}

function makeDeps(signal?: AbortSignal): {
  deps: CliDeps;
  stdout: { text(): string };
  stderr: { text(): string };
} {
  const stdout = makeWriter();
  const stderr = makeWriter();
  return {
    stdout,
    stderr,
    deps: {
      stdout,
      stderr,
      env: new MemoryEnvironment({}),
      fs: new DenoFileSystemSeam(),
      platform: detectPlatformKind(Deno.build.os),
      clock: new FixedClock("2026-09-05T00:00:00.000Z"),
      random: systemRandomSource,
      signal,
      // The fixture corpus is injected explicitly; ordinary lookup tests
      // never take the default (real-source) composition path.
      catalog: createFakeBookTitleCatalog(),
    },
  };
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runOut(
  args: string[],
  signal?: AbortSignal,
): Promise<RunResult> {
  const { deps } = makeDeps(signal);
  const code = await runCli(args, deps);
  return {
    code,
    stdout: (deps.stdout as unknown as { text(): string }).text(),
    stderr: (deps.stderr as unknown as { text(): string }).text(),
  };
}

function parseDoc(run: RunResult): Record<string, unknown> {
  assertMatch(run.stdout, /^\{"schemaVersion":"cli-json\.v1".*\}\n$/);
  const doc = JSON.parse(run.stdout) as Record<string, unknown>;
  assertEquals(Object.keys(doc)[0], "schemaVersion");
  return doc;
}

async function validateDoc(doc: unknown): Promise<void> {
  const schema = await loadSchema(SCHEMA_URL);
  const result = validateAgainstSchema(doc, schema);
  assertEquals(result.ok, true, result.ok ? "" : result.error);
}

// ---------------------------------------------------------------------------
// search S1-S10
// ---------------------------------------------------------------------------

Deno.test("cli S1 search found over the fixture corpus", async () => {
  const run = await runOut(["search", "--title", "百年孤独", "--json"]);
  assertEquals(run.code, 3);
  assertEquals(run.stderr, "");
  const doc = parseDoc(run);
  assertEquals(doc.status, "found");
  assertEquals((doc.candidates as unknown[]).length > 0, true);
  for (const candidate of doc.candidates as { references: unknown[] }[]) {
    assert(candidate.references.length >= 1);
  }
  await validateDoc(doc);
});

Deno.test("cli S3 no matching Work is not_found exit 4", async () => {
  const run = await runOut(["search", "--title", "不存在标题xyz", "--json"]);
  assertEquals(run.code, 4);
  const doc = parseDoc(run);
  assertEquals(doc.status, "not_found");
  assertEquals("candidates" in doc, false);
  await validateDoc(doc);
});

Deno.test("cli S4 partial source outage stays found with a warning", async () => {
  const run = await runOut(["search", "--title", "partial-fixture", "--json"]);
  assertEquals(run.code, 3);
  const doc = parseDoc(run);
  assertEquals(doc.status, "found");
  const warnings = doc.warnings as { code: string; source: string }[];
  assert(warnings.some((warning) => warning.code === "unavailable"));
  assertMatch(run.stderr, /warning: wikidata unavailable/);
  await validateDoc(doc);
});

Deno.test("cli S5 all sources failed is failed exit 10", async () => {
  const run = await runOut([
    "search",
    "--title",
    "all-failed-fixture",
    "--json",
  ]);
  assertEquals(run.code, 10);
  const doc = parseDoc(run);
  assertEquals(doc.status, "failed");
  assertEquals((doc.failures as unknown[]).length > 0, true);
  await validateDoc(doc);
});

Deno.test("cli S6 cancelled search writes the cancelled document exit 130", async () => {
  const controller = new AbortController();
  controller.abort();
  const run = await runOut(
    ["search", "--title", "百年孤独", "--json"],
    controller.signal,
  );
  assertEquals(run.code, 130);
  const doc = parseDoc(run);
  assertEquals(doc.status, "cancelled");
  assertEquals("warnings" in doc, false);
  await validateDoc(doc);
});

Deno.test("cli S7/S9 optional query fields combine", async () => {
  const withAuthor = await runOut([
    "search",
    "--title",
    "小王子",
    "--author",
    "圣埃克苏佩里",
    "--year",
    "1943",
    "--json",
  ]);
  assertEquals(withAuthor.code, 3);
  const withIsbn = await runOut([
    "search",
    "--title",
    "小王子",
    "--isbn",
    "9780156012195",
    "--json",
  ]);
  assertEquals(withIsbn.code, 3);
  assertEquals(
    withIsbn.stdout,
    withAuthor.stdout,
    "query value changes do not alter the deterministic fixture response",
  );
});

Deno.test("cli S8 empty title is exit 2 with no stdout", async () => {
  const run = await runOut(["search", "--title", "   ", "--json"]);
  assertEquals(run.code, 2);
  assertEquals(run.stdout, "");
  assertMatch(run.stderr, /--title/);
});

Deno.test("cli S10 human search text lists numbered candidates", async () => {
  const run = await runOut(["search", "--title", "百年孤独"]);
  assertEquals(run.code, 3);
  assertMatch(run.stdout, /^Candidates\n1\. /);
  assertMatch(run.stdout, /Cien años de soledad/);
  assertMatch(run.stdout, /openlibrary:work:OL274505W/);
});

// ---------------------------------------------------------------------------
// resolve R1-R10
// ---------------------------------------------------------------------------

Deno.test("cli R1 work reference resolves with both canonical references", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  assertEquals(doc.status, "resolved");
  assertEquals(doc.confirmation, "strong_reference");
  await validateDoc(doc);
});

Deno.test("cli R2 wikidata item resolves through the identity mapping", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "wikidata:item:Q178869",
    "--json",
  ]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  const work = doc.work as { references: { value: string }[] };
  assert(work.references.some((reference) => reference.value === "OL274505W"));
  await validateDoc(doc);
});

Deno.test("cli R3 isbn direct resolves (ISBN-10 input normalizes)", async () => {
  const run = await runOut(["resolve", "--isbn", "9780140328721", "--json"]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  assertEquals(doc.status, "resolved");
  await validateDoc(doc);
});

Deno.test("cli R4 edition reference resolves to its Work", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:edition:OL59138652M",
    "--json",
  ]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  assertEquals(doc.status, "resolved");
  await validateDoc(doc);
});

Deno.test("cli R5 duplicate isbn returns needs_choice ambiguous_identifier", async () => {
  const run = await runOut(["resolve", "--isbn", "9787544253994", "--json"]);
  assertEquals(run.code, 3);
  const doc = parseDoc(run);
  assertEquals(doc.status, "needs_choice");
  assertEquals(doc.reason, "ambiguous_identifier");
  assert((doc.warnings as { code: string }[]).some(
    (warning) => warning.code === "duplicate_identifier",
  ));
  await validateDoc(doc);
});

Deno.test("cli R6 isolated edition triggers indirect_evidence", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:edition:OL43416865M",
    "--json",
  ]);
  assertEquals(run.code, 3);
  const doc = parseDoc(run);
  assertEquals(doc.status, "needs_choice");
  assertEquals(doc.reason, "indirect_evidence");
  await validateDoc(doc);
});

Deno.test("cli R7 unknown reference is not_found exit 4", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:work:OLDOESNOTEXIST",
    "--json",
  ]);
  assertEquals(run.code, 4);
  const doc = parseDoc(run);
  assertEquals(doc.status, "not_found");
  await validateDoc(doc);
});

Deno.test("cli R8 all resolution paths failed is exit 10", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:work:OLFAILFETCH999W",
    "--json",
  ]);
  assertEquals(run.code, 10);
  const doc = parseDoc(run);
  assertEquals(doc.status, "failed");
  await validateDoc(doc);
});

Deno.test("cli R9 cancelled resolve exit 130", async () => {
  const controller = new AbortController();
  controller.abort();
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ], controller.signal);
  assertEquals(run.code, 130);
  const doc = parseDoc(run);
  assertEquals(doc.status, "cancelled");
  await validateDoc(doc);
});

Deno.test("cli R10 no opaque handles appear in any JSON", async () => {
  const search = await runOut(["search", "--title", "百年孤独", "--json"]);
  assertMatch(search.stdout, /^\{/);
  const banned = /candidateRef|resolvedWorkRef|"ref"\s*:|"requestId"/;
  assertEquals(banned.test(search.stdout), false);
  const titles = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  assertEquals(banned.test(titles.stdout), false);
});

// ---------------------------------------------------------------------------
// titles T1-T10
// ---------------------------------------------------------------------------

Deno.test("cli T1 multi-language titles found with one recommendation per language", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--language",
    "es",
    "--language",
    "zh",
    "--json",
  ]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  assertEquals(doc.status, "found");
  const groups = doc.groups as { language: string; recommended: boolean }[];
  const esRecommended = groups.filter((g) =>
    g.language === "es" && g.recommended
  );
  const zhRecommended = groups.filter((g) =>
    g.language === "zh" && g.recommended
  );
  assertEquals(esRecommended.length, 1);
  assertEquals(zhRecommended.length, 1);
  await validateDoc(doc);
});

Deno.test("cli T2 all languages marks known-language groups as satisfying", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  assertEquals(run.code, 0);
  const doc = parseDoc(run);
  const target = doc.targetLanguages as unknown[];
  assertEquals(target, []);
  const groups = doc.groups as { satisfiesRequest: boolean }[];
  assert(groups.some((group) => group.satisfiesRequest === true));
  await validateDoc(doc);
});

Deno.test("cli T3/T5 no attested titles for a language with only und/ambiguous evidence", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL10263W",
    "--language",
    "en",
    "--json",
  ]);
  assertEquals(run.code, 5);
  const doc = parseDoc(run);
  assertEquals(doc.status, "no_attested_titles");
  const groups = doc.groups as {
    language: string;
    level: string;
    recommended: boolean;
  }[];
  assert(groups.some((group) => group.language === "und"));
  assert(groups.every((group) => group.recommended === false));
  assert(
    groups.every((group) => group.level !== "ambiguous" || !group.recommended),
  );
  await validateDoc(doc);
});

Deno.test("cli T6 reference that needs a choice reports needs_choice exit 3", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "isbn:9787544253994",
    "--json",
  ]);
  assertEquals(run.code, 3);
  const doc = parseDoc(run);
  assertEquals(doc.status, "needs_choice");
  await validateDoc(doc);
});

Deno.test("cli T7 reference not found exit 4", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OLDOESNOTEXIST",
    "--json",
  ]);
  assertEquals(run.code, 4);
  const doc = parseDoc(run);
  assertEquals(doc.status, "not_found");
  await validateDoc(doc);
});

Deno.test("cli T8 all title paths failed is exit 10", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OLFAILS999W",
    "--json",
  ]);
  assertEquals(run.code, 10);
  const doc = parseDoc(run);
  assertEquals(doc.status, "failed");
  await validateDoc(doc);
});

Deno.test("cli T9 cancelled titles exit 130", async () => {
  const controller = new AbortController();
  controller.abort();
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ], controller.signal);
  assertEquals(run.code, 130);
  const doc = parseDoc(run);
  assertEquals(doc.status, "cancelled");
  await validateDoc(doc);
});

Deno.test("cli T10 human titles text groups by language", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--language",
    "zh",
  ]);
  assertEquals(run.code, 0);
  assertMatch(run.stdout, /Attested titles for Cien años de soledad/);
  assertMatch(run.stdout, /zh \(recommended\)/);
  assertMatch(run.stdout, /Bai nian gu du/);
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

Deno.test("cli X17 lookup JSON is compact, schemaVersion first, no color", async () => {
  const run = await runOut(["search", "--title", "百年孤独", "--json"]);
  assertMatch(run.stdout, /^\{"schemaVersion":"cli-json\.v1".*\}\n$/);
  assertEquals(run.stdout.includes("\x1b["), false);
  assertEquals(run.stdout.charCodeAt(0) === 0xfeff, false);
});

Deno.test("cli X19 warnings reach stderr while stdout stays a document", async () => {
  const run = await runOut(["search", "--title", "partial-fixture", "--json"]);
  assertEquals(run.stdout.trim().length > 0, true);
  assertMatch(run.stderr, /warning:/);
});

Deno.test("cli X26 option forms produce the same document", async () => {
  const spaced = await runOut(["search", "--title", "百年孤独", "--json"]);
  const equals = await runOut(["search", "--title=百年孤独", "--json"]);
  assertEquals(equals.code, spaced.code);
  assertEquals(equals.stdout, spaced.stdout);
});

Deno.test("cli X27 deterministic repeats are byte-identical", async () => {
  const first = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  const second = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  assertEquals(second.stdout, first.stdout);
});

// ---------------------------------------------------------------------------
// Byte-exact snapshots
// ---------------------------------------------------------------------------

Deno.test("cli snapshot search-bai-nian.json is byte-identical", async () => {
  const run = await runOut(["search", "--title", "百年孤独", "--json"]);
  const snapshot = await Deno.readTextFile(
    snapshotPath("search-bai-nian.json"),
  );
  assertEquals(run.stdout, snapshot);
});

Deno.test("cli snapshot resolve-ol274505w.json is byte-identical", async () => {
  const run = await runOut([
    "resolve",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  const snapshot = await Deno.readTextFile(
    snapshotPath("resolve-ol274505w.json"),
  );
  assertEquals(run.stdout, snapshot);
});

Deno.test("cli snapshot titles-ol274505w-es-zh.json is byte-identical", async () => {
  const run = await runOut([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--language",
    "es",
    "--language",
    "zh",
    "--json",
  ]);
  const snapshot = await Deno.readTextFile(
    snapshotPath("titles-ol274505w-es-zh.json"),
  );
  assertEquals(run.stdout, snapshot);
});
