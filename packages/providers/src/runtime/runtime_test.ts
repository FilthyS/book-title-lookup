/**
 * Deterministic contract tests for ProviderRuntime policy (issue #8 section
 * 5 and the fixture contract table). No test uses a real timer or a live
 * service: fetch is scripted and every clock/random/delay behavior flows
 * through FakeEffects.
 */

import { assertEquals } from "@std/assert";
import { ProviderRuntime } from "./runtime.ts";
import { DEFAULT_MAX_REDIRECTS } from "./types.ts";
import type { RequestPlan, RuntimeConfig } from "./types.ts";
import type { RuntimeEffects } from "./effects.ts";
import {
  FakeEffects,
  MemoryCache,
  requestRecorder,
  scriptedFetch,
} from "./test-util.ts";

const UA =
  "book-title-lookup/0.1 (+https://github.com/FilthyS/book-title-lookup)";

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    provider: "openlibrary",
    userAgent: UA,
    hosts: ["openlibrary.org"],
    decoderSchemaVersion: 1,
    maxConcurrent: 2,
    minSpacingMs: 0,
    maxRetries: 2,
    baseBackoffMs: 200,
    maxBackoffMs: 2_000,
    sourceBudgetMs: 8_000,
    maxRedirects: DEFAULT_MAX_REDIRECTS,
    fetch: () => {
      throw new TypeError("no fetch configured");
    },
    ...overrides,
  };
}

function textDecoder(): NonNullable<RequestPlan<string>["decoder"]> {
  return (envelope) => {
    const text = new TextDecoder().decode(envelope.body);
    if (text === "MALFORMED") {
      return { kind: "malformed", detail: "fixture" };
    }
    return { kind: "data", value: text };
  };
}

function planFor(
  url: string,
  cacheClass?: "search" | "detail",
): RequestPlan<string> {
  return {
    method: "GET",
    url,
    ...(cacheClass !== undefined ? { cacheClass } : {}),
    decoder: textDecoder(),
  };
}

interface Harness {
  effects: FakeEffects;
  cache: MemoryCache;
  runtime: ProviderRuntime;
  recorder: { count(url: string): number; total: number; urls: string[] };
}

class ControlledDeadlineEffects implements RuntimeEffects {
  #nowMs = 0;
  #sleepers: {
    readonly at: number;
    readonly finish: () => void;
  }[] = [];

  now(): number {
    return this.#nowMs;
  }

  random(): number {
    return 0;
  }

  get pendingDelays(): number {
    return this.#sleepers.length;
  }

  delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      if (signal?.aborted) {
        finish();
        return;
      }
      signal?.addEventListener("abort", finish, { once: true });
      this.#sleepers.push({ at: this.#nowMs + ms, finish });
    });
  }

  advance(ms: number): void {
    this.#nowMs += ms;
    const due = this.#sleepers.filter((sleeper) => sleeper.at <= this.#nowMs);
    this.#sleepers = this.#sleepers.filter(
      (sleeper) => sleeper.at > this.#nowMs,
    );
    for (const sleeper of due) sleeper.finish();
  }
}

function makeHarness(
  script: Parameters<typeof scriptedFetch>[0],
  overrides: Partial<RuntimeConfig> = {},
): Harness {
  const effects = new FakeEffects();
  const cache = new MemoryCache(() => effects.now());
  const recorder = requestRecorder();
  const fetch = scriptedFetch({
    ...script,
    onRequest: (url) => {
      script.onRequest?.(url);
      recorder.urls.push(url);
    },
  });
  const runtime = new ProviderRuntime(
    effects,
    cache,
    baseConfig({ fetch, ...overrides }),
  );
  return { effects, cache, runtime, recorder };
}

// ---------------------------------------------------------------------------
// Happy path, retries, redirects
// ---------------------------------------------------------------------------

Deno.test("runtime ok fetch returns data, meta, and writes the cache", async () => {
  const { runtime, cache, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json", "search"),
  );
  assertEquals(outcome.kind, "ok");
  if (outcome.kind === "ok") {
    assertEquals(outcome.data, "doc");
    assertEquals(outcome.meta.servedFromCache, false);
    assertEquals(
      outcome.meta.requestedUrl,
      "https://openlibrary.org/search.json",
    );
    assertEquals(outcome.meta.finalUrl, "https://openlibrary.org/search.json");
  }
  assertEquals(recorder.total, 1);
  assertEquals(cache.entries.size, 1);
});

Deno.test("runtime fresh cache hit does not fetch", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const url = "https://openlibrary.org/search.json";
  const first = await runtime.execute(planFor(url, "search"));
  assertEquals(first.kind, "ok");
  const second = await runtime.execute(planFor(url, "search"));
  assertEquals(second.kind, "ok");
  if (second.kind === "ok") {
    assertEquals(second.meta.servedFromCache, true);
  }
  assertEquals(recorder.total, 1);
});

Deno.test("runtime cache identity differs by meaning-changing query parameter", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json?limit=1": {
        status: 200,
        body: "one",
      },
      "https://openlibrary.org/search.json?limit=2": {
        status: 200,
        body: "two",
      },
    },
  });
  const a = await runtime.execute(
    planFor("https://openlibrary.org/search.json?limit=1", "search"),
  );
  assertEquals(a.kind, "ok");
  const b = await runtime.execute(
    planFor("https://openlibrary.org/search.json?limit=2", "search"),
  );
  assertEquals(b.kind, "ok");
  assertEquals(recorder.total, 2);
});

Deno.test("runtime operation shares one source budget across request plans", async () => {
  const { runtime, effects, recorder } = makeHarness({
    fallback: (url) => ({ status: 200, body: url }),
  });
  const operation = runtime.beginOperation({ sourceBudgetMs: 100 });

  const first = await operation.execute(
    planFor("https://openlibrary.org/first.json"),
  );
  assertEquals(first.kind, "ok");
  effects.advance(100);
  const second = await operation.execute(
    planFor("https://openlibrary.org/second.json"),
  );

  assertEquals(second.kind, "source_failure");
  if (second.kind === "source_failure") {
    assertEquals(second.failure.code, "timeout");
  }
  assertEquals(recorder.total, 1);
});

Deno.test("runtime retryable 5xx retries at most twice then succeeds", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/detail.json": [
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 200, body: "up" },
      ],
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/detail.json", "detail"),
  );
  assertEquals(outcome.kind, "ok");
  if (outcome.kind === "ok") assertEquals(outcome.data, "up");
  assertEquals(recorder.count("https://openlibrary.org/detail.json"), 3);
});

Deno.test("runtime exhausted retries fail as unavailable", async () => {
  const { runtime } = makeHarness({
    byUrl: {
      "https://openlibrary.org/detail.json": [
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 503, body: "down" },
      ],
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/detail.json"),
  );
  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "unavailable");
  }
});

Deno.test("runtime 429 honors Retry-After", async () => {
  const { runtime, effects, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": [
        {
          status: 429,
          headers: { "Retry-After": "5" },
          body: "slow",
        },
        { status: 200, body: "doc" },
      ],
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json"),
  );
  assertEquals(outcome.kind, "ok");
  // The Retry-After wait replaced jittered backoff.
  assertEquals(effects.delays.includes(5000), true);
  assertEquals(recorder.count("https://openlibrary.org/search.json"), 2);
});

Deno.test("runtime 429 without Retry-After fails rate_limited without retry", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 429, body: "slow" },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json"),
  );
  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "rate_limited");
  }
  assertEquals(recorder.total, 1);
});

Deno.test("runtime follows an allowlisted redirect and preserves both URLs", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/isbn/1.json": {
        status: 302,
        headers: { Location: "https://openlibrary.org/books/OL1M.json" },
      },
      "https://openlibrary.org/books/OL1M.json": {
        status: 200,
        body: "edition",
      },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/isbn/1.json", "detail"),
  );
  assertEquals(outcome.kind, "ok");
  if (outcome.kind === "ok") {
    assertEquals(outcome.data, "edition");
    assertEquals(
      outcome.meta.requestedUrl,
      "https://openlibrary.org/isbn/1.json",
    );
    assertEquals(
      outcome.meta.finalUrl,
      "https://openlibrary.org/books/OL1M.json",
    );
    assertEquals(outcome.meta.redirects.length, 1);
  }
  assertEquals(recorder.total, 2);
});

Deno.test("runtime refuses an off-allowlist redirect without caching it", async () => {
  const { runtime, cache, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/a.json": {
        status: 302,
        headers: { Location: "https://evil.example.org/b.json" },
      },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/a.json", "detail"),
  );
  assertEquals(outcome.kind, "source_failure");
  assertEquals(cache.entries.size, 0, "untrusted redirects are never cached");
  assertEquals(recorder.total, 1, "never fetches the off-allowlist target");
});

Deno.test("runtime refuses a non-https plan URL", async () => {
  const { runtime } = makeHarness({
    fallback: () => ({ status: 200, body: "x" }),
  });
  const outcome = await runtime.execute(
    planFor("http://openlibrary.org/a.json"),
  );
  assertEquals(outcome.kind, "source_failure");
});

Deno.test("runtime redirect loop hits the bounded cap", async () => {
  const loop = {
    "https://openlibrary.org/a.json": {
      status: 302,
      headers: { Location: "https://openlibrary.org/b.json" },
    },
    "https://openlibrary.org/b.json": {
      status: 302,
      headers: { Location: "https://openlibrary.org/a.json" },
    },
  };
  const { runtime, recorder } = makeHarness({ byUrl: loop });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/a.json"),
  );
  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "unavailable");
  }
  assertEquals(recorder.total, DEFAULT_MAX_REDIRECTS + 1);
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

Deno.test("runtime pre-aborted signal returns cancelled without fetching", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: { "https://openlibrary.org/a.json": { status: 200, body: "x" } },
  });
  const controller = new AbortController();
  controller.abort();
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/a.json"),
    {
      signal: controller.signal,
    },
  );
  assertEquals(outcome.kind, "cancelled");
  assertEquals(recorder.total, 0);
});

Deno.test("runtime source budget aborts an in-flight fetch as timeout", async () => {
  const effects = new ControlledDeadlineEffects();
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  const runtime = new ProviderRuntime(
    effects,
    new MemoryCache(() => effects.now()),
    baseConfig({
      sourceBudgetMs: 10,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          markFetchStarted?.();
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    }),
  );

  const pending = runtime.execute(planFor("https://openlibrary.org/slow.json"));
  await fetchStarted;
  effects.advance(10);
  const outcome = await pending;

  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "timeout");
  }
});

Deno.test("runtime source budget expires while queued for a slot", async () => {
  const effects = new ControlledDeadlineEffects();
  const firstController = new AbortController();
  let markFirstFetchStarted: (() => void) | undefined;
  const firstFetchStarted = new Promise<void>((resolve) => {
    markFirstFetchStarted = resolve;
  });
  const runtime = new ProviderRuntime(
    effects,
    new MemoryCache(() => effects.now()),
    baseConfig({
      maxConcurrent: 1,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          markFirstFetchStarted?.();
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    }),
  );

  const first = runtime.execute(planFor("https://openlibrary.org/first.json"), {
    signal: firstController.signal,
    sourceBudgetMs: 100,
  });
  await firstFetchStarted;
  let settledAtDeadline = false;
  const second = runtime
    .execute(planFor("https://openlibrary.org/second.json"), {
      sourceBudgetMs: 10,
    })
    .then((outcome) => {
      settledAtDeadline = true;
      return outcome;
    });
  while (effects.pendingDelays < 2) await Promise.resolve();

  effects.advance(10);
  for (let turn = 0; turn < 10 && !settledAtDeadline; turn++) {
    await Promise.resolve();
  }
  const expiredWhileQueued = settledAtDeadline;

  firstController.abort();
  await first;
  const outcome = await second;
  assertEquals(expiredWhileQueued, true);
  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "timeout");
  }
});

Deno.test("runtime aborts during retry backoff as cancelled", async () => {
  const controller = new AbortController();
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/a.json": [
        { status: 503, body: "down" },
        { status: 200, body: "up" },
      ],
    },
    onRequest: () => controller.abort(),
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/a.json"),
    {
      signal: controller.signal,
    },
  );
  assertEquals(outcome.kind, "cancelled");
  assertEquals(recorder.total, 1);
});

// ---------------------------------------------------------------------------
// Cache hit/miss/stale/offline
// ---------------------------------------------------------------------------

Deno.test("runtime offline uses a stale positive entry and labels it stale", async () => {
  const { runtime, effects, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const url = "https://openlibrary.org/search.json";
  const online = await runtime.execute(planFor(url, "search"));
  assertEquals(online.kind, "ok");
  // Expire the 24h search entry.
  effects.advance(25 * 60 * 60 * 1000);
  const offline = await runtime.execute(planFor(url, "search"), {
    mode: "offline",
  });
  assertEquals(offline.kind, "ok");
  if (offline.kind === "ok") {
    assertEquals(offline.data, "doc");
    assertEquals(offline.meta.servedFromCache, true);
    assertEquals(offline.meta.stale, true);
  }
  assertEquals(recorder.total, 1);
});

Deno.test("runtime online treats a stale entry as a miss and refetches", async () => {
  const { runtime, effects, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const url = "https://openlibrary.org/search.json";
  const online = await runtime.execute(planFor(url, "search"));
  assertEquals(online.kind, "ok");
  effects.advance(25 * 60 * 60 * 1000);
  const second = await runtime.execute(planFor(url, "search"), {
    mode: "online",
  });
  assertEquals(second.kind, "ok");
  if (second.kind === "ok") assertEquals(second.meta.servedFromCache, false);
  assertEquals(recorder.total, 2);
});

Deno.test("runtime offline miss fails with unavailable", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json", "search"),
    { mode: "offline" },
  );
  assertEquals(outcome.kind, "source_failure");
  if (outcome.kind === "source_failure") {
    assertEquals(outcome.failure.code, "unavailable");
    assertEquals(outcome.failure.details?.reason, "offline_no_cache");
  }
  assertEquals(recorder.total, 0);
});

Deno.test("runtime corrupt entry quarantines online (warn) and refetches", async () => {
  const { runtime, cache, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const url = "https://openlibrary.org/search.json";
  const first = await runtime.execute(planFor(url, "search"));
  assertEquals(first.kind, "ok");
  // The store would have quarantined it; simulate that read classification.
  for (const key of cache.entries.keys()) {
    cache.corrupt(key);
  }
  const second = await runtime.execute(planFor(url, "search"));
  assertEquals(second.kind, "ok");
  if (second.kind === "ok") {
    assertEquals(
      second.meta.warnings.some(
        (warning) =>
          warning.code === "decode" &&
          warning.details?.reason === "corrupt_cache_entry",
      ),
      true,
    );
  }
  assertEquals(recorder.total, 2);
});

Deno.test("runtime negative 404 is cached and answered from cache", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/works/OL0000.json": {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: '{"error":"notfound"}',
      },
    },
  });
  const url = "https://openlibrary.org/works/OL0000.json";
  const decoder: RequestPlan<string>["decoder"] = (env) => {
    if (env.status === 404) return { kind: "no_record" };
    return { kind: "data", value: "unexpected" };
  };
  const plan: RequestPlan<string> = {
    method: "GET",
    url,
    cacheClass: "detail",
    decoder,
  };
  const first = await runtime.execute(plan);
  assertEquals(first.kind, "no_record");
  const second = await runtime.execute(plan);
  assertEquals(second.kind, "no_record");
  assertEquals(recorder.total, 1, "negative result served from cache");
});

Deno.test("runtime never caches an HTML 404 negative", async () => {
  const url = "https://openlibrary.org/isbn/9787536692938.json";
  const { runtime, cache, recorder } = makeHarness({
    byUrl: {
      [url]: {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: "<!doctype html><title>Not Found</title>",
      },
    },
  });
  const plan: RequestPlan<string> = {
    method: "GET",
    url,
    cacheClass: "detail",
    decoder: () => ({ kind: "no_record" }),
  };

  assertEquals((await runtime.execute(plan)).kind, "no_record");
  assertEquals((await runtime.execute(plan)).kind, "no_record");
  assertEquals(cache.entries.size, 0);
  assertEquals(recorder.total, 2, "HTML negatives must be fetched again");
});

Deno.test("runtime decode failures are not cached", async () => {
  const { runtime, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "MALFORMED" },
    },
  });
  const url = "https://openlibrary.org/search.json";
  const plan = planFor(url, "search");
  const first = await runtime.execute(plan);
  assertEquals(first.kind, "source_failure");
  if (first.kind === "source_failure") {
    assertEquals(first.failure.code, "decode");
  }
  const second = await runtime.execute(plan);
  assertEquals(second.kind, "source_failure");
  assertEquals(recorder.total, 2);
});

// ---------------------------------------------------------------------------
// Cache write eligibility guards
// ---------------------------------------------------------------------------

Deno.test("runtime never caches 422 validation responses", async () => {
  const { runtime, cache, recorder } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": {
        status: 422,
        headers: { "Content-Type": "application/json" },
        body: '{"error":"too short"}',
      },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json", "search"),
  );
  assertEquals(outcome.kind, "source_failure");
  assertEquals(cache.entries.size, 0);
  assertEquals(recorder.total, 1);
});

Deno.test("runtime never caches without a cacheClass", async () => {
  const { runtime, cache } = makeHarness({
    byUrl: {
      "https://openlibrary.org/search.json": { status: 200, body: "doc" },
    },
  });
  const outcome = await runtime.execute(
    planFor("https://openlibrary.org/search.json"),
  );
  assertEquals(outcome.kind, "ok");
  assertEquals(cache.entries.size, 0);
});
