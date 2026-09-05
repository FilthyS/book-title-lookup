/**
 * Compact JSON serialization for the CLI (issue #12 sections 7.1 and 7.2).
 *
 * Every stdout JSON document is one compact JSON value with a trailing
 * newline, UTF-8 without a BOM, `schemaVersion` first, and deterministic key
 * order supplied by the document builders.
 */

export const CLI_JSON_SCHEMA_VERSION = "cli-json.v1";

export function serializeJsonDocument(value: unknown): string {
  return JSON.stringify(value) + "\n";
}
