/**
 * Small JSON Schema validator used by the CLI JSON schema seam.
 *
 * Supports the keyword subset used by the cli-json.v1 bundle: $defs/$ref,
 * type, enum, const, properties, required, items, additionalProperties.
 * The MVP introduces no runtime dependency, so the validation engine is a
 * narrow project-owned helper exercised by tests against the fixtures.
 */

type JsonValue = unknown;

export interface Schema {
  readonly $defs?: Readonly<Record<string, Schema>>;
  readonly $ref?: string;
  readonly type?:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null";
  readonly enum?: readonly JsonValue[];
  readonly const?: JsonValue;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly items?: Schema | readonly Schema[];
  readonly additionalProperties?: boolean | Schema;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export function validateAgainstSchema(
  value: JsonValue,
  schema: Schema,
  path = "$",
): ValidationResult {
  return validateNode(value, schema, schema, path);
}

function validateNode(
  value: JsonValue,
  schema: Schema,
  root: Schema,
  path: string,
): ValidationResult {
  if (schema.$ref !== undefined) {
    return validateNode(value, resolveSchema(schema.$ref, root), root, path);
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((entry) => deepEqual(entry, value))) {
      return { ok: false, error: `${path}: not one of the allowed values` };
    }
  }
  if (schema.const !== undefined) {
    if (!deepEqual(schema.const, value)) {
      return { ok: false, error: `${path}: does not equal const` };
    }
  }
  if (schema.type !== undefined) {
    const ok = typeMatches(schema.type, value);
    if (!ok) {
      return { ok: false, error: `${path}: expected ${schema.type}` };
    }
  }
  if (schema.type === "object" || schema.properties !== undefined) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return schema.type === "object" && typeof value !== "object"
        ? { ok: false, error: `${path}: expected object` }
        : { ok: true };
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        return {
          ok: false,
          error: `${path}: missing required property '${key}'`,
        };
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (!(key in record)) continue;
      const result = validateNode(record[key], sub, root, `${path}.${key}`);
      if (!result.ok) return result;
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in (schema.properties ?? {}))) {
          return {
            ok: false,
            error: `${path}: unexpected property '${key}'`,
          };
        }
      }
    }
  }
  if (schema.type === "array" || schema.items !== undefined) {
    if (!Array.isArray(value)) {
      return schema.type === "array"
        ? { ok: false, error: `${path}: expected array` }
        : { ok: true };
    }
    const itemsSchema = schema.items;
    if (itemsSchema !== undefined) {
      const schemas = Array.isArray(itemsSchema) ? itemsSchema : null;
      for (let i = 0; i < value.length; i++) {
        const itemSchema = schemas === null ? itemsSchema : schemas[i];
        if (itemSchema === undefined) {
          return {
            ok: false,
            error: `${path}: item ${i} has no schema (tuple exhausted)`,
          };
        }
        const result = validateNode(
          value[i],
          itemSchema,
          root,
          `${path}[${i}]`,
        );
        if (!result.ok) return result;
      }
    }
  }
  return { ok: true };
}

function resolveSchema(ref: string, root: Schema): Schema {
  if (ref.startsWith("#/$defs/")) {
    const name = ref.slice("#/$defs/".length);
    const def = root.$defs?.[name];
    if (def === undefined) {
      throw new RangeError(`schema has no $defs entry '${name}'`);
    }
    return def;
  }
  throw new RangeError(`unsupported $ref '${ref}'`);
}

function typeMatches(type: string, value: JsonValue): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (typeof a === "object" && a !== null && b !== null) {
    const ar = a as Record<string, unknown>;
    const br = b as Record<string, unknown>;
    const keys = Object.keys(ar);
    const other = Object.keys(br);
    if (keys.length !== other.length) return false;
    return keys.every((key) => deepEqual(ar[key], br[key]));
  }
  return false;
}

import { readFile } from "node:fs/promises";

export async function loadSchema(schemaUrl: string | URL): Promise<Schema> {
  const text = await readFile(schemaUrl, "utf8");
  return JSON.parse(text) as Schema;
}
