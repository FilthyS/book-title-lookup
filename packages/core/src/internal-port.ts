/**
 * Internal evidence port (issue #6 "internal provider composition", refined
 * for the fixture slice; ticket #17 implements it with real adapters).
 *
 * This port is workspace-internal: Providers implements it later, and the
 * fixture-backed composition implements it in this slice. Core owns the
 * types so the lookup orchestration stays below the application seam. It is
 * never presented as a third-party plugin surface.
 */

import type {
  ExternalReference,
  SourceFailure,
  SourceWarning,
} from "./domain.ts";
import type { BookQuery, RequestOptions } from "./module.ts";
import type { SourceRecord } from "./evidence.ts";

export type SourceSearchOutcome =
  | { readonly status: "ok"; readonly hits: readonly SourceHitForPort[] }
  | { readonly status: "no_record" }
  | { readonly status: "failed"; readonly failure: SourceFailure }
  | { readonly status: "cancelled" };

/** A search hit as delivered by a source: record plus matched aliases. */
export interface SourceHitForPort {
  readonly record: SourceRecord;
  readonly matchedAliases: readonly {
    readonly text: string;
    readonly language?: string;
  }[];
}

export type SourceFetchOutcome =
  | { readonly status: "ok"; readonly records: readonly SourceRecord[] }
  | { readonly status: "no_record" }
  | { readonly status: "failed"; readonly failure: SourceFailure }
  | { readonly status: "cancelled" };

export type SourceExpansionOutcome =
  | {
      readonly status: "ok";
      readonly records: readonly SourceRecord[];
      readonly warnings: readonly SourceWarning[];
    }
  | { readonly status: "failed"; readonly failure: SourceFailure }
  | { readonly status: "cancelled" };

/**
 * One catalog source behind the module. The exact request plan and decoding
 * stay with the adapter; Core sees only typed records and typed outcomes.
 */
export interface EvidenceSource {
  readonly source: "openlibrary" | "wikidata";
  search(
    query: BookQuery,
    options: RequestOptions,
  ): Promise<SourceSearchOutcome>;
  /** Fetch records for an explicit reference (Work, Edition, or ISBN). */
  fetch(
    reference: ExternalReference,
    options: RequestOptions,
  ): Promise<SourceFetchOutcome>;
  /** Expand Editions of a Work reference. */
  expandEditions(
    workReference: ExternalReference,
    options: RequestOptions,
  ): Promise<SourceExpansionOutcome>;
}
