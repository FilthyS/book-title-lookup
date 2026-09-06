/**
 * Tolerant decoder tests for Open Library endpoints (research #1 decoder
 * invariants; issue #8 section 6). Bodies are raw bytes; assertions cover the
 * content-type gate, strict UTF-8, required identity invariants, ignored
 * extra fields, structured not-found, and HTML negatives.
 */

import { assertEquals } from "@std/assert";
import {
  decodeEditionsPageEnvelope,
  decodeRecordEnvelope,
  decodeSearchEnvelope,
} from "./decoders.ts";
import type { TransportEnvelope } from "../runtime/types.ts";

function env(
  status: number,
  body: string | Uint8Array,
  contentType = "application/json",
): TransportEnvelope {
  return {
    status,
    contentType,
    body: typeof body === "string" ? new TextEncoder().encode(body) : body,
    finalUrl: "https://openlibrary.org/x.json",
  };
}

Deno.test("decoder search parses docs and marks an empty result negative", () => {
  const hit = decodeSearchEnvelope(
    env(
      200,
      JSON.stringify({
        numFound: 2,
        docs: [{ key: "/works/OL274505W", title: "Cien años de soledad" }],
      }),
    ),
  );
  assertEquals(hit.kind, "data");
  if (hit.kind === "data") {
    assertEquals(hit.value.docs.length, 1);
    assertEquals(hit.negative, false);
  }
  const empty = decodeSearchEnvelope(
    env(
      200,
      JSON.stringify({
        numFound: 0,
        docs: [],
      }),
    ),
  );
  assertEquals(empty.kind, "data");
  if (empty.kind === "data") assertEquals(empty.negative, true);
});

Deno.test("decoder ignores unknown fields and tolerates absent optional facts", () => {
  const result = decodeRecordEnvelope(
    env(
      200,
      JSON.stringify({
        key: "/works/OL274505W",
        type: { key: "/type/work" },
        title: "Cien años de soledad",
        bogusField: { anything: [1, 2, 3] },
        languages: "not-an-array",
      }),
    ),
  );
  assertEquals(result.kind, "data");
});

Deno.test("decoder strict UTF-8 rejects invalid bytes as malformed", () => {
  const invalid = new Uint8Array([
    0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
  ]);
  const result = decodeRecordEnvelope(env(200, invalid));
  assertEquals(result.kind, "malformed");
});

Deno.test("decoder content-type gate never feeds HTML to a JSON parser", () => {
  const html = decodeRecordEnvelope(
    env(404, "<html>not found</html>", "text/html"),
  );
  assertEquals(html.kind, "no_record");
  const html200 = decodeRecordEnvelope(
    env(200, "<html>proxy</html>", "text/html"),
  );
  assertEquals(html200.kind, "malformed");
});

Deno.test("decoder structured JSON not-found is no_record", () => {
  const missing = decodeRecordEnvelope(
    env(404, '{"error":"notfound","key":"/works/OL0000000000W"}'),
  );
  assertEquals(missing.kind, "no_record");
});

Deno.test("decoder detects /type/redirect records and preserves location", () => {
  const redirect = decodeRecordEnvelope(
    env(
      200,
      JSON.stringify({
        key: "/works/OL45883W",
        location: "/works/OL45804W",
        type: { key: "/type/redirect" },
      }),
    ),
  );
  assertEquals(redirect.kind, "data");
  if (redirect.kind === "data") {
    assertEquals((redirect.value as { kind: string }).kind, "redirect");
  }
});

Deno.test("decoder editions page preserves the next link and entries", () => {
  const page = decodeEditionsPageEnvelope(
    env(
      200,
      JSON.stringify({
        links: { next: "/works/OL274505W/editions.json?offset=2" },
        size: 161,
        entries: [
          { key: "/books/OL1M", type: { key: "/type/edition" }, title: "A" },
        ],
      }),
    ),
  );
  assertEquals(page.kind, "data");
  if (page.kind === "data") {
    const value = page.value as {
      size: number;
      nextPath?: string;
      entries: unknown[];
    };
    assertEquals(value.size, 161);
    assertEquals(value.nextPath, "/works/OL274505W/editions.json?offset=2");
    assertEquals(value.entries.length, 1);
  }
});

Deno.test("decoder requires the edition type invariant on editions entries", () => {
  const page = decodeEditionsPageEnvelope(
    env(
      200,
      JSON.stringify({
        size: 1,
        entries: [{ key: "/books/OL1M", type: { key: "/type/work" } }],
      }),
    ),
  );
  assertEquals(page.kind, "data");
  if (page.kind === "data") {
    assertEquals(page.value.entries.length, 0);
  }
});
