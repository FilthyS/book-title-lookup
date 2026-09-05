/**
 * Shared domain vocabulary for Book Title Lookup Core (issue #6/#7).
 *
 * Everything here is readonly and provider-neutral. Bibliographic types used
 * by the application seam, the reconciliation pipeline, and the internal
 * evidence port all flow through this vocabulary; no source-specific type
 * crosses the module boundary.
 */

/** Canonical BCP 47-style language tag ("zh", "zh-Hans", "en", ...). */
export type LanguageTag = string;

/** Built-in sources that can produce warnings and failures. */
export type SourceId = "openlibrary" | "wikidata";

/** Reference namespaces the module can act on. */
export type ExternalReferenceNamespace =
  | "openlibrary:work"
  | "openlibrary:edition"
  | "wikidata:item"
  | "isbn";

/** A stable, namespaced identifier from an upstream catalog or ISBN system.
 *  Unlike opaque refs, External References are first-class values: they may
 *  be displayed, stored, and reused across responses and invocations. */
export interface ExternalReference {
  readonly namespace: ExternalReferenceNamespace;
  readonly value: string;
}

/** Structured reason codes for source-level issues. Codes are stable machine
 *  tokens that the presentation layer renders; they never contain English. */
export type SourceIssueCode =
  // Source transport/decode codes (issue #6).
  | "unavailable"
  | "timeout"
  | "rate_limited"
  | "decode"
  | "conflict"
  | "stale"
  // Reconciliation and completeness codes (issue #7/#12).
  | "duplicate_identifier"
  | "detached_work"
  | "excluded_record"
  | "unknown_work"
  | "relationship_divergence"
  | "language_divergence"
  | "title_divergence"
  | "rank_conflict"
  | "author_divergence"
  | "partial_expansion";

/** Base shape shared by warnings and failures. `references` is always an
 *  array and `details` never holds a completed sentence. */
export interface SourceIssueBase {
  readonly source: SourceId;
  readonly code: SourceIssueCode;
  readonly references: readonly ExternalReference[];
  readonly details?: Readonly<Record<string, string>>;
}

/** Degradation on an otherwise valid outcome. */
export interface SourceWarning extends SourceIssueBase {}

/** Why an outcome could not be produced. */
export interface SourceFailure extends SourceIssueBase {}

export function isSourceId(value: string): value is SourceId {
  return value === "openlibrary" || value === "wikidata";
}

/** Compare two references deterministically: namespace, then value. */
export function compareExternalReferences(
  a: ExternalReference,
  b: ExternalReference,
): number {
  if (a.namespace !== b.namespace) {
    return a.namespace < b.namespace ? -1 : 1;
  }
  if (a.value !== b.value) {
    return a.value < b.value ? -1 : 1;
  }
  return 0;
}

/** Serialize a reference for deterministic ordering and display keys. */
export function referenceKey(reference: ExternalReference): string {
  return `${reference.namespace}:${reference.value}`;
}

export function referencesKey(
  references: readonly ExternalReference[],
): string {
  return references.map(referenceKey).sort().join("\u0000");
}

/** Deterministic warning/failure order: code, source, references, details. */
export function compareIssues<
  T extends { readonly code: string; readonly source: string } & {
    readonly references?: readonly ExternalReference[];
    readonly details?: Readonly<Record<string, string>>;
  },
>(a: T, b: T): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  const aRefs = [...(a.references ?? [])]
    .sort(compareExternalReferences)
    .map(referenceKey)
    .join(",");
  const bRefs = [...(b.references ?? [])]
    .sort(compareExternalReferences)
    .map(referenceKey)
    .join(",");
  if (aRefs !== bRefs) return aRefs < bRefs ? -1 : 1;
  const aDetails = JSON.stringify(sortRecord(a.details ?? {}));
  const bDetails = JSON.stringify(sortRecord(b.details ?? {}));
  if (aDetails !== bDetails) return aDetails < bDetails ? -1 : 1;
  return 0;
}

export function sortRecord(
  record: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/** Sort warnings deterministically (issue #7 section 11, issue #12 7.2). */
export function sortWarnings(
  warnings: readonly SourceWarning[],
): readonly SourceWarning[] {
  return [...warnings].sort(compareIssues);
}

/** Sort failures deterministically. */
export function sortFailures(
  failures: readonly SourceFailure[],
): readonly SourceFailure[] {
  return [...failures].sort(compareIssues);
}

/** Sort references by namespace then value, dropping duplicates. */
export function canonicalReferences(
  references: readonly ExternalReference[],
): readonly ExternalReference[] {
  const out: ExternalReference[] = [];
  for (const reference of [...references].sort(compareExternalReferences)) {
    const key = referenceKey(reference);
    if (out.length === 0 || referenceKey(out[out.length - 1]) !== key) {
      out.push(reference);
    }
  }
  return out;
}

/** Distinct strings in ascending order (comparison is ordinal). */
export function distinctSorted(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of [...values].sort()) {
    if (out.length === 0 || out[out.length - 1] !== value) out.push(value);
  }
  return out;
}
