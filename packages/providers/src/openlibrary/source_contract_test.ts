/**
 * Open Library evidence-source contract tests over the shared raw HTTP
 * fixture corpus (issue #6 envelope rows, issue #8 decoder invariants, and
 * the real-composition CLI surface). Every test runs the ProviderRuntime
 * against the injected transport over `fixtures/providers/openlibrary`; no
 * test touches a live service or a real timer.
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
import { findOpenLibraryFixture } from "../../../../fixtures/providers/openlibrary/fixtures.ts";
import { openLibraryRuntimeConfig } from "./config.ts";
import { createOpenLibraryCatalog } from "../federated/composition.ts";

const CONTACT = "coordinator@example.com";

function fixtureFetch() {
  const recorder = requestRecorder();
  const fetch = scriptedFetch({
    fallback: (url) => {
      const fixture = findOpenLibraryFixture(url);
      if (fixture === undefined) {
        throw new TypeError(`no fixture for ${url}`);
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
    onRequest: (url) => recorder.urls.push(url),
  });
  return { fetch, recorder };
}

interface OlFixtureHarness {
  readonly effects: FakeEffects;
  readonly runtime: ProviderRuntime;
  readonly recorder: {
    count(url: string): number;
    total: number;
    urls: string[];
  };
}

function makeRuntime(): OlFixtureHarness {
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const { fetch, recorder } = fixtureFetch();
  const runtime = new ProviderRuntime(
    effects,
    cache,
    openLibraryRuntimeConfig({
      version: "0.1.0",
      contact: CONTACT,
      fetch,
    }),
  );
  return { effects, runtime, recorder };
}

function makeCatalog(
  runtime: ProviderRuntime,
  options: { readonly offline?: boolean; readonly maxPages?: number } = {},
): BookTitleCatalog {
  return createOpenLibraryCatalog({
    runtime,
    offline: options.offline === true,
    pageSize: 2,
    maxPages: options.maxPages ?? 2,
  });
}

// ---------------------------------------------------------------------------
// Envelope rows over the real OL-composed service
// ---------------------------------------------------------------------------

Deno.test("ol service search maps Work docs to found candidates", async () => {
  const { runtime, recorder } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.search({ title: "百年孤独" });
  assertEquals(outcome.status, "found");
  if (outcome.status === "found") {
    const values = outcome.candidates.map((c) =>
      c.references.map((r) => `${r.namespace}:${r.value}`).join(","),
    );
    assert(
      values.some((refs) => refs.includes("openlibrary:work:OL43416865W")),
    );
  }
  assert(recorder.urls.some((url) => url.includes("/search.json")));
});

Deno.test("ol service resolve of the isolated work surfaces indirect evidence", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL43416865W" },
  });
  assertEquals(outcome.status, "needs_choice");
  if (outcome.status === "needs_choice") {
    assertEquals(outcome.reason, "indirect_evidence");
    assert(
      outcome.candidates.some((c) =>
        c.references.some(
          (r) => r.namespace === "openlibrary:work" && r.value === "OL274505W",
        ),
      ),
    );
  }
});

Deno.test("ol service titles find a zh attestation under the principal work", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const resolved = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL274505W" },
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const titles = await catalog.findTitles(resolved.work.ref, {
    targetLanguages: ["es", "zh"],
  });
  assertEquals(titles.status, "found");
  if (titles.status === "found") {
    const zh = titles.groups.filter((g) => g.language === "zh");
    assert(zh.length >= 1, "a zh title group exists");
    assert(
      zh.some((g) => g.title === "Bai nian gu du"),
      "the romanized Chinese edition title attests",
    );
  }
});

Deno.test("ol service follows a JSON /type/redirect record to the canonical work", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL45883W" },
  });
  assertEquals(outcome.status, "resolved");
  if (outcome.status === "resolved") {
    assert(
      outcome.work.references.some(
        (r) => r.namespace === "openlibrary:work" && r.value === "OL45883W",
      ),
      "requested merged work reference preserved",
    );
    assert(
      outcome.work.references.some(
        (r) => r.namespace === "openlibrary:work" && r.value === "OL45804W",
      ),
      "canonical work reference preserved",
    );
  }
});

Deno.test("ol service resolves an ISBN through its 302 redirect", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "isbn", value: "9780140328721" },
  });
  assertEquals(outcome.status, "resolved");
  if (outcome.status === "resolved") {
    assertEquals(outcome.work.title, "Fantastic Mr Fox");
  }
});

Deno.test("ol service missing work key is not_found", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL0000000000W" },
  });
  assertEquals(outcome.status, "not_found");
});

Deno.test("ol service empty search is not_found", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime);
  const outcome = await catalog.search({
    title: "zzqxqwnonexistentphrasebooknotfound",
  });
  assertEquals(outcome.status, "not_found");
});

Deno.test("ol expansion page cap truncates with a partial_expansion warning", async () => {
  const { runtime } = makeRuntime();
  const catalog = makeCatalog(runtime, { maxPages: 1 });
  const resolved = await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL274505W" },
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  const titles = await catalog.findTitles(resolved.work.ref, {
    targetLanguages: [],
  });
  assertEquals(titles.status, "found");
  if (titles.status === "found") {
    assert(
      titles.warnings.some((w) => w.code === "partial_expansion"),
      "page cap emits a partial expansion warning",
    );
  }
});

Deno.test("ol transport sends the identified User-Agent", async () => {
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const requests: RequestInit[] = [];
  const fetch = scriptedFetch({
    fallback: () => {
      const fixture = findOpenLibraryFixture(
        "https://openlibrary.org/works/OL274505W.json",
      );
      if (fixture === undefined) throw new TypeError("fixture missing");
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: fixture.body,
      };
    },
    onRequest: (_url, init) => {
      if (init !== undefined) requests.push(init);
    },
  });
  const runtime = new ProviderRuntime(
    effects,
    cache,
    openLibraryRuntimeConfig({ version: "0.1.0", contact: CONTACT, fetch }),
  );
  const catalog = makeCatalog(runtime);
  await catalog.resolve({
    kind: "externalReference",
    reference: { namespace: "openlibrary:work", value: "OL274505W" },
  });
  const headers = requests[0]?.headers;
  assert(headers !== undefined, "headers sent");
  const ua = new Headers(headers).get("User-Agent");
  assert(
    ua?.startsWith(
      "book-title-lookup/0.1.0 (+https://github.com/FilthyS/book-title-lookup; ",
    ) === true,
    `identified User-Agent with contact, got ${ua}`,
  );
});
