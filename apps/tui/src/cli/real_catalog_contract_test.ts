/**
 * CLI integration rows against the real Open Library-composed service over
 * the shared raw HTTP fixtures (plan section 6.3: "CLI integration rows ...
 * against the real fixture composition (no live network)"). The real service
 * replaces the module fake for these rows; every document validates against
 * the cli-json.v1 schema and no network is touched.
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
import { ProviderRuntime } from "../../../../packages/providers/src/runtime/runtime.ts";
import {
  FakeEffects,
  MemoryCache,
  scriptedFetch,
} from "../../../../packages/providers/src/runtime/test-util.ts";
import {
  findOpenLibraryFixture,
} from "../../../../fixtures/providers/openlibrary/fixtures.ts";
import {
  openLibraryRuntimeConfig,
} from "../../../../packages/providers/src/openlibrary/config.ts";
import { createOpenLibraryCatalog } from "../../../../packages/providers/src/federated/composition.ts";
import { loadSchema, validateAgainstSchema } from "../json/schema-validate.ts";

const SCHEMA_URL = new URL(
  "../../../../fixtures/cli-json/schema/cli-json.v1.schema.json",
  import.meta.url,
);

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

function makeRealCatalogDeps(): {
  deps: CliDeps;
  stdout: { text(): string };
  stderr: { text(): string };
} {
  const stdout = makeWriter();
  const stderr = makeWriter();
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const fetch = scriptedFetch({
    fallback: (url) => {
      const fixture = findOpenLibraryFixture(url);
      if (fixture === undefined) {
        throw new TypeError(`no OL fixture for ${url}`);
      }
      return {
        status: fixture.status,
        headers: {
          "Content-Type": fixture.contentType,
          ...(fixture.location !== undefined
            ? { Location: fixture.location }
            : {}),
        },
        body: fixture.body,
      };
    },
  });
  const runtime = new ProviderRuntime(
    effects,
    cache,
    openLibraryRuntimeConfig({
      version: "0.1.0",
      contact: "contract@example.com",
      fetch,
    }),
  );
  const catalog = createOpenLibraryCatalog({
    runtime,
    pageSize: 2,
    maxPages: 2,
  });
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
      catalog,
    },
  };
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runReal(args: string[]): Promise<RunResult> {
  const { deps } = makeRealCatalogDeps();
  const code = await runCli(args, deps);
  return {
    code,
    stdout: (deps.stdout as unknown as { text(): string }).text(),
    stderr: (deps.stderr as unknown as { text(): string }).text(),
  };
}

async function validateDoc(doc: unknown): Promise<void> {
  const schema = await loadSchema(SCHEMA_URL);
  const result = validateAgainstSchema(doc, schema);
  assertEquals(result.ok, true, result.ok ? "" : result.error);
}

Deno.test("real composition search over OL fixtures returns candidates", async () => {
  const run = await runReal(["search", "--title", "百年孤独", "--json"]);
  assertEquals(run.code, 3, run.stderr);
  assertMatch(run.stdout, /^\{"schemaVersion":"cli-json\.v1".*\}\n$/);
  const doc = JSON.parse(run.stdout) as {
    status: string;
    candidates: unknown[];
  };
  assertEquals(doc.status, "found");
  assert(doc.candidates.length >= 1);
  await validateDoc(doc);
});

Deno.test("real composition resolve over OL fixtures is resolved", async () => {
  const run = await runReal([
    "resolve",
    "--reference",
    "openlibrary:work:OL274505W",
    "--json",
  ]);
  assertEquals(run.code, 0, run.stderr);
  const doc = JSON.parse(run.stdout) as {
    status: string;
    confirmation: string;
  };
  assertEquals(doc.status, "resolved");
  assertEquals(doc.confirmation, "strong_reference");
  await validateDoc(doc);
});

Deno.test("real composition titles finds the zh group over OL fixtures", async () => {
  const run = await runReal([
    "titles",
    "--reference",
    "openlibrary:work:OL274505W",
    "--language",
    "zh",
    "--json",
  ]);
  assertEquals(run.code, 0, run.stderr);
  const doc = JSON.parse(run.stdout) as {
    status: string;
    groups: { language: string; title: string }[];
  };
  assertEquals(doc.status, "found");
  const zh = doc.groups.filter((g) => g.language === "zh");
  assert(zh.length >= 1);
  assert(zh.some((g) => g.title === "Bai nian gu du"));
  await validateDoc(doc);
});

Deno.test("real composition no-result search exits 4 with a clean document", async () => {
  const run = await runReal([
    "search",
    "--title",
    "zzqxqwnonexistentphrasebooknotfound",
    "--json",
  ]);
  assertEquals(run.code, 4, run.stderr);
  const doc = JSON.parse(run.stdout) as { status: string };
  assertEquals(doc.status, "not_found");
  await validateDoc(doc);
});
