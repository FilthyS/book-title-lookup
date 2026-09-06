/**
 * Schema bundle validation tests for the cli-json.v1 lookup documents.
 *
 * The cli-json.v1 schema fixture is a bundle rooted at `#/$defs/documentBase`;
 * `validateAgainstSchema` must resolve the root `$ref` and every nested
 * `$defs` reference so committed snapshot documents validate and documents
 * that violate the bundle are rejected.
 */

import { assertEquals } from "@std/assert";
import { loadSchema, validateAgainstSchema } from "./schema-validate.ts";

const SCHEMA_URL = new URL(
  "../../../../fixtures/cli-json/schema/cli-json.v1.schema.json",
  import.meta.url,
);

const SNAPSHOTS = [
  "search-bai-nian.json",
  "resolve-ol274505w.json",
  "titles-ol274505w-es-zh.json",
] as const;

Deno.test("schema committed lookup snapshots validate against cli-json.v1", async () => {
  const schema = await loadSchema(SCHEMA_URL);
  for (const name of SNAPSHOTS) {
    const url = new URL(
      `../../../../fixtures/cli-json/snapshots/${name}`,
      import.meta.url,
    );
    const doc = JSON.parse(await Deno.readTextFile(url)) as unknown;
    const result = validateAgainstSchema(doc, schema);
    assertEquals(result.ok, true, `${name}: ${result.ok ? "" : result.error}`);
  }
});

Deno.test("schema rejects a document missing a required top-level field", async () => {
  const schema = await loadSchema(SCHEMA_URL);
  const doc = { command: "search", status: "found" };
  const result = validateAgainstSchema(doc, schema);
  assertEquals(result.ok, false);
});

Deno.test("schema rejects an unexpected top-level property", async () => {
  const schema = await loadSchema(SCHEMA_URL);
  const doc = {
    schemaVersion: "cli-json.v1",
    command: "search",
    status: "cancelled",
    opaqueRef: "c-1",
  };
  const result = validateAgainstSchema(doc, schema);
  assertEquals(result.ok, false);
});
