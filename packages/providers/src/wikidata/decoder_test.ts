/**
 * Tolerant decoder tests for Wikidata endpoints (research #2 F1-F7; issue #8
 * section 6 decoder discipline). Bodies are raw fixture JSON the decoders
 * consume for `wbsearchentities`, `wbgetentities`, the fixed WDQS SPARQL
 * shapes, and the CirrusSearch `haswbstatement` fallback. Assertions cover
 * rank/qualifier/reference preservation, label handling, empty-result
 * negatives, and ignored extra fields.
 */

import { assertEquals } from "@std/assert";
import type { TransportEnvelope } from "../runtime/types.ts";
import {
  decodeCirrusSearchEnvelope,
  decodeEntitiesEnvelope,
  decodeSearchEnvelope,
  decodeSparqlEnvelope,
  sparqlEntityId,
} from "./decoders.ts";
import {
  entitiesEnvelope,
  Q125131191_DOC,
  Q208460_DOC,
  Q69966015_DOC,
  sparqlEditionsEnvelope,
  WD_HANT_SEARCH,
  WD_ZH_SEARCH,
} from "../../../../fixtures/providers/wikidata/fixtures.ts";

function env(
  status: number,
  body: string | Uint8Array,
  contentType = "application/json",
): TransportEnvelope {
  return {
    status,
    contentType,
    body: typeof body === "string" ? new TextEncoder().encode(body) : body,
    finalUrl: "https://www.wikidata.org/w/api.php",
  };
}

Deno.test("wd search decoder parses results and marks an empty list negative", () => {
  const hit = decodeSearchEnvelope(env(200, WD_ZH_SEARCH["活着"] ?? ""));
  assertEquals(hit.kind, "data");
  if (hit.kind === "data") {
    assertEquals(hit.value.results.length, 1);
    assertEquals(hit.value.results[0]?.id, "Q151919");
    assertEquals(hit.negative, false);
  }
  const empty = decodeSearchEnvelope(env(200, WD_ZH_SEARCH["百年孤寂"] ?? ""));
  assertEquals(empty.kind, "data");
  if (empty.kind === "data") {
    assertEquals(empty.value.results.length, 0);
    assertEquals(empty.negative, true);
  }
});

Deno.test("wd hant search decoder parses a traditional-script result", () => {
  const hit = decodeSearchEnvelope(env(200, WD_HANT_SEARCH["百年孤寂"] ?? ""));
  assertEquals(hit.kind, "data");
  if (hit.kind === "data") {
    assertEquals(hit.value.results.length, 1);
    assertEquals(hit.value.results[0]?.id, "Q178869");
    assertEquals(hit.value.results[0]?.matchedLanguage, "zh-Hant");
  }
});

Deno.test("wd entities decoder preserves claims, rank, qualifiers, references", () => {
  const decoded = decodeEntitiesEnvelope(
    env(200, entitiesEnvelope([Q125131191_DOC])),
  );
  assertEquals(decoded.kind, "data");
  if (decoded.kind !== "data") return;
  assertEquals(decoded.value.entities.length, 1);
  const entity = decoded.value.entities[0];
  assertEquals(entity.id, "Q125131191");
  const title = entity.claims.find((claim) => claim.property === "P1476");
  assertEquals(title?.rank, "normal");
  if (title?.value.kind !== "monolingual") throw new Error("title not text");
  assertEquals(title.value.text, "To Live");
  assertEquals(title.value.language, "en");
  assertEquals(title.references, 1);
  const p407 = title.qualifiers.find((qualifier) =>
    qualifier.property === "P407"
  );
  if (p407?.value.kind !== "item") throw new Error("P407 not an item");
  assertEquals(p407.value.id, "Q1860");
  const isbn = entity.claims.find((claim) => claim.property === "P212");
  if (isbn?.value.kind !== "string") throw new Error("P212 not string");
  assertEquals(isbn.value.value, "9780385421987");
});

Deno.test("wd entities decoder preserves a deprecated rank on F6", () => {
  const decoded = decodeEntitiesEnvelope(
    env(200, entitiesEnvelope([Q208460_DOC])),
  );
  assertEquals(decoded.kind, "data");
  if (decoded.kind !== "data") return;
  const entity = decoded.value.entities[0];
  const p648 = entity.claims.filter((claim) => claim.property === "P648");
  assertEquals(p648.length, 2);
  assertEquals(
    p648.some((claim) => claim.rank === "deprecated"),
    true,
  );
  assertEquals(
    p648.some((claim) => claim.rank === "normal"),
    true,
  );
});

Deno.test("wd entities decoder keeps a label-only Edition (F3) as an item", () => {
  const decoded = decodeEntitiesEnvelope(
    env(200, entitiesEnvelope([Q69966015_DOC])),
  );
  assertEquals(decoded.kind, "data");
  if (decoded.kind !== "data") return;
  const entity = decoded.value.entities[0];
  assertEquals(entity.id, "Q69966015");
  // F3 carries no P1476 title statement, only a label.
  assertEquals(
    entity.claims.some((claim) => claim.property === "P1476"),
    false,
  );
});

Deno.test("wd sparql decoder parses shape rows and extracts entity ids", () => {
  const body = sparqlEditionsEnvelope([
    {
      editionId: "Q125131191",
      title: "To Live",
      language: "en",
      isbn: "9780385421987",
    },
  ]);
  const decoded = decodeSparqlEnvelope(env(200, body));
  assertEquals(decoded.kind, "data");
  if (decoded.kind !== "data") return;
  assertEquals(decoded.value.rows.length, 1);
  const e = decoded.value.rows[0]?.bindings["e"];
  assertEquals(sparqlEntityId(e), "Q125131191");
  const title = decoded.value.rows[0]?.bindings["title"];
  assertEquals(title?.value, "To Live");
  assertEquals(title?.language, "en");
});

Deno.test("wd cirrus search decoder extracts qids from page titles", () => {
  const decoded = decodeCirrusSearchEnvelope(
    env(
      200,
      JSON.stringify({
        query: {
          search: [{ ns: 0, title: "Q125131191" }, {
            ns: 0,
            title: "not-a-qid",
          }],
        },
      }),
    ),
  );
  assertEquals(decoded.kind, "data");
  if (decoded.kind === "data") {
    assertEquals(decoded.value.ids, ["Q125131191"]);
    assertEquals(decoded.negative, false);
  }
});

Deno.test("wd search decoder skips a result entry that lacks an id", () => {
  const body = JSON.stringify({
    search: [{ label: "dropped" }],
    success: 1,
  });
  const decoded = decodeSearchEnvelope(env(200, body));
  assertEquals(decoded.kind, "data");
  if (decoded.kind === "data") {
    assertEquals(decoded.value.results.length, 0);
  }
});
