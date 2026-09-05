/**
 * Wikidata -> Core mapping tests (research #2 mapping table; issue #7
 * sections 4 and 9). Mapping turns decoded entity facts into Core
 * SourceRecords without ever letting labels/aliases/descriptions become title
 * claims, preserves ranks/statement ids, and classifies Work/Edition/Other
 * from P31. Deprecated/normal identifier pairs (F6) produce a rank_conflict
 * warning through the Core record-reading predicate.
 */

import { assertEquals } from "@std/assert";
import { claimsOfType } from "../../../core/src/evidence.ts";
import { decodeEntitiesEnvelope } from "./decoders.ts";
import type { TransportEnvelope } from "../runtime/types.ts";
import type { WdEntity } from "./decoders.ts";
import {
  classifyEntity,
  mapEditionEntity,
  mapEntity,
  mapWorkEntity,
  titleClaimsFromEntity,
} from "./mapping.ts";
import { recordWarnings } from "../../../core/src/reconcile.ts";
import {
  entitiesEnvelope,
  Q125131191_DOC,
  Q151919_DOC,
  Q208460_DOC,
  Q50476449_DOC,
  Q69966015_DOC,
} from "../../../../fixtures/providers/wikidata/fixtures.ts";

const CONTEXT = {
  sourceRecordUrl: "https://www.wikidata.org/w/api.php",
  fetchedAt: "2026-09-05T12:34:56.789Z",
  stale: false,
};

function decodedEntity(doc: Record<string, unknown>): WdEntity {
  const env: TransportEnvelope = {
    status: 200,
    contentType: "application/json",
    body: new TextEncoder().encode(entitiesEnvelope([doc])),
    finalUrl: "https://www.wikidata.org/w/api.php",
  };
  const decoded = decodeEntitiesEnvelope(env);
  if (decoded.kind !== "data") throw new Error("decode failed");
  const entity = decoded.value.entities[0];
  if (entity === undefined) throw new Error("no entity");
  return entity;
}

Deno.test("wd mapping classifies Work, Edition, and Other from P31", () => {
  assertEquals(classifyEntity(decodedEntity(Q151919_DOC)), "work");
  assertEquals(classifyEntity(decodedEntity(Q125131191_DOC)), "edition");
  // A translation-tagged item that also carries an Edition class (Q3331189).
  assertEquals(classifyEntity(decodedEntity(Q50476449_DOC)), "edition");
});

Deno.test("wd mapping emits title claims only from P1476, never from labels", () => {
  const entity = decodedEntity(Q151919_DOC);
  const record = mapWorkEntity(entity, CONTEXT);
  assertEquals(record.kind, "work");
  const titles = titleClaimsFromEntity(entity);
  assertEquals(
    titles.map((claim) => claim.text).sort(),
    ["To Live", "活着"],
  );
  // Labels/aliases never add claims beyond the P1476 statements.
  const titleTexts = titles.map((claim) => claim.text);
  assertEquals(titleTexts.length, 2);
  assertEquals(
    record.claims.some((claim) =>
      claim.type === "title" && claim.language === "zh" && claim.text === "活着"
    ),
    true,
  );
  assertEquals(
    record.claims.some((claim) =>
      claim.type === "title" && claim.language === "en" &&
      claim.text === "To Live"
    ),
    true,
  );
});

Deno.test("wd mapping preserves the P648 openlibrary identity claim", () => {
  const record = mapWorkEntity(decodedEntity(Q151919_DOC), CONTEXT);
  const identities = claimsOfType(record, "identifier").filter((claim) =>
    claim.namespace === "openlibrary:work"
  );
  assertEquals(identities.length, 1);
  assertEquals(identities[0]?.value, "OL12181913W");
  const contentLanguages = claimsOfType(record, "content-language");
  assertEquals(contentLanguages.length, 1);
});

Deno.test("wd F3 label-only Edition maps with no title attestation claim", () => {
  const entity = decodedEntity(Q69966015_DOC);
  const record = mapEditionEntity(entity, CONTEXT);
  assertEquals(record.kind, "edition");
  // F3 carries a zh label but no P1476, so it produces no title claim.
  assertEquals(titleClaimsFromEntity(entity).length, 0);
  const titleClaims = record.claims.filter((claim) => claim.type === "title");
  assertEquals(titleClaims.length, 0);
  // Its Edition-to-Work relation and ISBN still map.
  assertEquals(
    record.claims.some((claim) =>
      claim.type === "work-link" &&
      claim.reference.namespace === "wikidata:item" &&
      claim.reference.value === "Q751348"
    ),
    true,
  );
});

Deno.test("wd F6 deprecated/normal P648 pair yields a rank_conflict warning", () => {
  const record = mapWorkEntity(decodedEntity(Q208460_DOC), CONTEXT);
  const identifiers = claimsOfType(record, "identifier").filter((claim) =>
    claim.namespace === "openlibrary:work"
  );
  assertEquals(identifiers.length, 2);
  assertEquals(
    identifiers.some((claim) => claim.rank === "deprecated"),
    true,
  );
  const warnings = recordWarnings(record);
  assertEquals(
    warnings.some((warning) => warning.code === "rank_conflict"),
    true,
  );
});

Deno.test("wd mapping does not classify a translation-only item as edition", () => {
  // P31 Q7553 (translation) alone is not an Edition class; only a real
  // Edition class (Q3331189 / Q59466300) marks an item as an edition.
  const edition = decodedEntity(Q125131191_DOC);
  const translationOnly: WdEntity = {
    ...edition,
    claims: [{
      property: "P31",
      rank: "normal",
      value: { kind: "item", id: "Q7553" },
      qualifiers: [],
      references: 0,
    }],
  };
  assertEquals(classifyEntity(translationOnly), "other");
  assertEquals(mapEntity(translationOnly, CONTEXT), undefined);
});

Deno.test("wd mapping returns undefined for Other-classed entities", () => {
  // A film item is neither a Work nor an Edition; it maps to no record.
  const filmDoc = {
    ...Q125131191_DOC,
    claims: { P31: [] },
  };
  // decode drops an entity with an empty claims map? It still parses; P31 empty => other.
  const entity = decodedEntity(filmDoc);
  assertEquals(mapEntity(entity, CONTEXT), undefined);
});
