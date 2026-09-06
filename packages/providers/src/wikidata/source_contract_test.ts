/**
 * Wikidata evidence-source contract tests over the shared raw HTTP fixture
 * corpus (research #2 F1-F7; issue #8 source workflows; issue #7 acceptance
 * rows). Every test runs the ProviderRuntime against the injected transport
 * over `fixtures/providers/wikidata`; no test touches a live service or a
 * real timer.
 */

import { assert, assertEquals } from "@std/assert";
import type { BookTitleCatalog } from "../../../core/src/module.ts";
import { ProviderRuntime } from "../runtime/runtime.ts";
import {
  FakeEffects,
  MemoryCache,
  requestRecorder,
  scriptedFetch,
} from "../runtime/test-util.ts";
import { findWikidataFixture } from "../../../../fixtures/providers/wikidata/fixtures.ts";
import { wikidataRuntimeConfig } from "./config.ts";
import { createWikidataCatalog } from "../federated/composition.ts";

const CONTACT = "coordinator@example.com";

function fixtureFetch(
  onRequest?: (url: string) => void,
): {
  fetch: typeof fetch;
  recorder: { urls: string[]; count(url: string): number; total: number };
} {
  const recorder = requestRecorder();
  const fetch = scriptedFetch({
    fallback: (url) => {
      const fixture = findWikidataFixture(url);
      if (fixture === undefined) {
        throw new TypeError(`no WD fixture for ${url}`);
      }
      return {
        status: fixture.status,
        headers: { "Content-Type": "application/json" },
        body: fixture.body,
      };
    },
    onRequest: (url) => {
      recorder.urls.push(url);
      onRequest?.(url);
    },
  });
  return { fetch, recorder };
}

interface WdFixtureHarness {
  readonly effects: FakeEffects;
  readonly runtime: ProviderRuntime;
  readonly recorder: {
    count(url: string): number;
    total: number;
    urls: string[];
  };
}

function makeRuntime(): WdFixtureHarness {
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const { fetch, recorder } = fixtureFetch();
  const runtime = new ProviderRuntime(
    effects,
    cache,
    wikidataRuntimeConfig({ version: "0.1.0", contact: CONTACT, fetch }),
  );
  return { effects, runtime, recorder };
}

function makeCatalog(
  runtime: ProviderRuntime,
  options: { readonly offline?: boolean } = {},
): BookTitleCatalog {
  return createWikidataCatalog({ runtime, offline: options.offline === true });
}

Deno.test("wd search maps a zh work doc to found candidates", async () => {
  const { runtime, recorder } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.search({ title: "活着" });
  assertEquals(outcome.status, "found");
  if (outcome.status === "found") {
    const refs = outcome.candidates.map((candidate) =>
      candidate.references.map((r) => `${r.namespace}:${r.value}`)
    );
    assert(
      refs.some((list) => list.includes("wikidata:item:Q151919")),
      "Q151919 surfaced as a candidate",
    );
  }
  assert(
    recorder.urls.some((url) => url.includes("action=wbsearchentities")),
    "discovery ran",
  );
  const entityRead = recorder.urls.find((url) =>
    url.includes("action=wbgetentities")
  );
  assert(entityRead !== undefined, "entity details were read");
  assertEquals(
    new URL(entityRead).searchParams.get("redirects"),
    "yes",
    "MediaWiki boolean parameters use an accepted value",
  );
});

Deno.test("wd search retries a traditional-script query in zh-Hant", async () => {
  const { runtime, recorder } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.search({ title: "百年孤寂" });
  assertEquals(outcome.status, "found");
  if (outcome.status === "found") {
    const refs = outcome.candidates.flatMap((candidate) =>
      candidate.references.map((r) => `${r.namespace}:${r.value}`)
    );
    assert(
      refs.includes("wikidata:item:Q178869"),
      "Q178869 from zh-Hant retry",
    );
    assert(
      refs.includes("openlibrary:work:OL274505W"),
      "P648 maps Q178869 to its Open Library Work",
    );
  }
  assert(
    recorder.urls.some((url) => url.includes("language=zh-Hant")),
    "the zh-Hant retry request was issued",
  );
  assert(
    recorder.urls.some((url) => url.includes("language=zh&")),
    "the primary zh request ran before the retry",
  );
});

Deno.test("wd empty search is not_found", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.search({
    title: "zzqxqwnonexistentphrasebooknotfound",
  });
  assertEquals(outcome.status, "not_found");
});

Deno.test("wd resolve of a wikidata work is resolved with P648 identity", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "wikidata:item", value: "Q151919" },
  });
  assertEquals(outcome.status, "resolved");
  if (outcome.status !== "resolved") return;
  assertEquals(outcome.work.title, "活着");
  assert(
    outcome.work.references.some((r) =>
      r.namespace === "wikidata:item" && r.value === "Q151919"
    ),
    "requested wikidata reference preserved",
  );
  assert(
    outcome.work.references.some((r) =>
      r.namespace === "openlibrary:work" && r.value === "OL12181913W"
    ),
    "P648 Open Library work reference joins the resolved identity",
  );
  assert(outcome.work.contentLanguages.includes("zh"), "content language zh");
});

Deno.test("wd findTitles attests a verified zh edition title (活着 corpus)", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const resolved = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "wikidata:item", value: "Q151919" },
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const titles = await catalog.findTitles(resolved.work.ref, {
    targetLanguages: ["zh"],
  });
  assertEquals(titles.status, "found");
  if (titles.status !== "found") return;
  const zh = titles.groups.filter((g) => g.language === "zh");
  assert(zh.length >= 1, "a zh title group exists");
  assert(zh.some((g) => g.title === "活着"), "the zh edition title attests");
  assert(
    zh.some((g) => g.level === "verified"),
    "the direct-relation edition title is verified",
  );
});

Deno.test("wd work-level original title alone stays probable, never verified", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  // Q25338 carries a Work-level P1476 but its Shape 2 expansion is empty, so
  // only the work-level statement attests (never Verified on its own).
  const resolved = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "wikidata:item", value: "Q25338" },
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const titles = await catalog.findTitles(resolved.work.ref, {
    targetLanguages: ["fr"],
  });
  assertEquals(titles.status, "found");
  if (titles.status !== "found") return;
  const fr = titles.groups.filter((g) =>
    g.language === "fr" && g.title === "Le Petit Prince"
  );
  assert(fr.length === 1, "work-level original title forms a group");
  assertEquals(fr[0].level, "probable");
  assert(
    fr[0].attestations.every((attestation) =>
      attestation.role === "work_original_title"
    ),
    "the group is backed only by the Work statement",
  );
});

Deno.test("wd WDQS failure falls back to the P747 Edition index", async () => {
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const recorder = requestRecorder();
  const fetch = scriptedFetch({
    fallback: (url) => {
      recorder.urls.push(url);
      // WDQS (Shape 2) is down; the entity reads still answer from fixtures.
      const parsed = new URL(url);
      if (parsed.hostname === "query.wikidata.org") {
        return {
          status: 500,
          headers: { "Content-Type": "text/plain" },
          body: "boom",
        };
      }
      const fixture = findWikidataFixture(url);
      if (fixture === undefined) {
        throw new TypeError(`no WD fixture for ${url}`);
      }
      return {
        status: fixture.status,
        headers: { "Content-Type": "application/json" },
        body: fixture.body,
      };
    },
  });
  const runtime = new ProviderRuntime(
    effects,
    cache,
    wikidataRuntimeConfig({ version: "0.1.0", contact: CONTACT, fetch }),
  );
  const catalog = createWikidataCatalog({ runtime });
  const resolved = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "wikidata:item", value: "Q151919" },
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const titles = await catalog.findTitles(resolved.work.ref, {
    targetLanguages: ["zh"],
  });
  assertEquals(titles.status, "found", "P747 fallback still attests titles");
  if (titles.status !== "found") return;
  assert(
    titles.groups.some((g) => g.language === "zh" && g.title === "活着"),
    "the zh title is attested from the P747 Edition reads",
  );
  assert(
    titles.warnings.some((warning) => warning.source === "wikidata"),
    "the failed WDQS path leaves an attributable warning",
  );
});
