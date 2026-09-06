/**
 * Small tolerant structural validators (issue #8 section 6). Decoders
 * require only the identity and type invariants an endpoint must satisfy;
 * optional fields that are absent, null, or the wrong type for a non-core
 * fact degrade to absent plus (at the caller's discretion) a warning.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asOptionalString(value: unknown): string | undefined {
  return asString(value);
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
  }
  return out;
}

export function asRecordArray(
  value: unknown,
): readonly Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Record<string, unknown>[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record !== undefined) out.push(record);
  }
  return out;
}

/** Extract the `key` property of a record, tolerating absent/wrong types. */
export function keyOfRecord(
  record: Record<string, unknown>,
): string | undefined {
  return asOptionalString(record.key);
}

/** Extract `type.key` where Open Library stores `/type/edition`. */
export function typeKeyOfRecord(
  record: Record<string, unknown>,
): string | undefined {
  const type = asRecord(record.type);
  if (type === undefined) return undefined;
  return asOptionalString(type.key);
}

/** Extract nested `{key}` references from arrays such as `works`/`languages`. */
export function keysOfRefArray(value: unknown): readonly string[] | undefined {
  const entries = asRecordArray(value);
  if (entries === undefined) return undefined;
  const out: string[] = [];
  for (const entry of entries) {
    const key = asOptionalString(entry.key);
    if (key !== undefined) out.push(key);
  }
  return out;
}
