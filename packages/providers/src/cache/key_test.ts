import { assertEquals } from "@std/assert";
import {
  cacheKeyJson,
  canonicalizeRequestUrl,
  computeCacheKey,
  digestForIdentity,
} from "./key.ts";
import type { CanonicalRequestIdentity } from "./key.ts";

Deno.test("cache/key canonicalization sorts query parameters deterministically", () => {
  const a = canonicalizeRequestUrl(
    "https://openlibrary.org/search.json?limit=10&fields=key%2Ctitle&q=xxx",
  );
  const b = canonicalizeRequestUrl(
    "https://openlibrary.org/search.json?q=xxx&fields=key%2Ctitle&limit=10",
  );
  assertEquals(a, b);
  assertEquals(
    a,
    "https://openlibrary.org/search.json?fields=key%2Ctitle&limit=10&q=xxx",
  );
});

Deno.test("cache/key canonicalization lowercases scheme and authority", () => {
  assertEquals(
    canonicalizeRequestUrl("HTTP://OpenLibrary.org/search.json?q=1"),
    "http://openlibrary.org/search.json?q=1",
  );
});

Deno.test("cache/key canonicalization preserves path exactly", () => {
  // Path segments are never percent-decoded or re-encoded.
  const url = "https://openlibrary.org/works/OL274505W.json?fields=title";
  assertEquals(canonicalizeRequestUrl(url), url);
});

Deno.test("cache/key canonicalization keeps no-query URLs unchanged", () => {
  const url = "https://www.wikidata.org/wiki/Special:EntityData/Q178869.json";
  assertEquals(canonicalizeRequestUrl(url), url);
});

Deno.test("cache/key canonicalization distinguishes meaning-changing parameters", () => {
  const base = "https://openlibrary.org/search.json?q=one";
  const withOffset = "https://openlibrary.org/search.json?q=one&offset=20";
  const withPage = "https://openlibrary.org/search.json?q=one&page=2";
  const fields = "https://openlibrary.org/search.json?q=one&fields=title";
  const results = [base, withOffset, withPage, fields].map(
    canonicalizeRequestUrl,
  );
  assertEquals(new Set(results).size, 4);
});

Deno.test("cache/key digest is stable and 64 lowercase hex characters", async () => {
  const identity: CanonicalRequestIdentity = {
    provider: "openlibrary",
    method: "GET",
    url:
      "https://openlibrary.org/search.json?q=%E7%99%BE%E5%B9%B4%E5%AD%A4%E7%8B%AC",
  };
  const digest = await digestForIdentity(identity);
  assertEquals(digest.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(digest), true);
  const again = await digestForIdentity(identity);
  assertEquals(digest, again);
});

Deno.test("cache/key digest differs across providers and parameters", async () => {
  const openlibrary: CanonicalRequestIdentity = {
    provider: "openlibrary",
    method: "GET",
    url: "https://openlibrary.org/search.json?q=x",
  };
  const wikidata: CanonicalRequestIdentity = {
    provider: "wikidata",
    method: "GET",
    url: "https://openlibrary.org/search.json?q=x",
  };
  const offline = await digestForIdentity(openlibrary);
  const other = await digestForIdentity({
    ...openlibrary,
    url: "https://openlibrary.org/search.json?q=y",
  });
  assertEquals(offline === (await digestForIdentity(wikidata)), false);
  assertEquals(offline === other, false);
});

Deno.test("cache/key cacheKeyJson serializes keys in declaration order", () => {
  const identity: CanonicalRequestIdentity = {
    provider: "openlibrary",
    method: "GET",
    url: "https://openlibrary.org/search.json?q=x",
  };
  assertEquals(
    cacheKeyJson(identity),
    '{"provider":"openlibrary","method":"GET","url":"https://openlibrary.org/search.json?q=x"}',
  );
});

Deno.test("cache/key computeCacheKey returns digest with identity for inspection", async () => {
  const url =
    "https://openlibrary.org/search.json?q=%E7%99%BE%E5%B9%B4%E5%AD%A4%E7%8B%AC";
  const key = await computeCacheKey("openlibrary", url);
  assertEquals(key.algorithm, "sha256");
  assertEquals(key.digest.length, 64);
  assertEquals(key.identity.url, url);
  assertEquals(key.identity.provider, "openlibrary");
});
