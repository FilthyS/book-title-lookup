/**
 * Fixture-backed evidence sources (issue #6 module-level fake over the
 * acceptance corpus). The composition root of this slice wires these two
 * sources into the real Core `CatalogService`; a later slice replaces them
 * with provider adapters behind the same internal evidence port.
 */

import type {
  BookQuery,
  ExternalReference,
  RequestOptions,
} from "../../../../packages/core/src/module.ts";
import type {
  EvidenceSource,
  SourceExpansionOutcome,
  SourceFetchOutcome,
  SourceSearchOutcome,
} from "../../../../packages/core/src/internal-port.ts";
import { normalizeTitleText } from "../../../../packages/core/src/normalize.ts";
import {
  CORPUS_PROFILES,
  type CorpusExpansionStatus,
  type CorpusFetchStatus,
  type CorpusProfile,
  type CorpusSearchStatus,
} from "../../../../fixtures/acceptance-corpus/profiles.ts";

type SourceId = "openlibrary" | "wikidata";

function refKey(reference: ExternalReference): string {
  return `${reference.namespace}:${reference.value}`;
}

class CorpusIndex {
  readonly search = new Map<SourceId, Map<string, CorpusSearchStatus>>();
  readonly fetches = new Map<SourceId, Map<string, CorpusFetchStatus>>();
  readonly expansions = new Map<SourceId, Map<string, CorpusExpansionStatus>>();

  constructor(profiles: readonly CorpusProfile[]) {
    for (const profile of profiles) {
      for (const entry of profile.search) {
        const table = this.search.get(entry.source) ?? new Map();
        table.set(normalizeTitleText(entry.title), entry.status);
        this.search.set(entry.source, table);
      }
      for (const entry of profile.fetches) {
        const table = this.fetches.get(entry.source) ?? new Map();
        table.set(refKey(entry.reference), entry.status);
        this.fetches.set(entry.source, table);
      }
      for (const entry of profile.expansions) {
        const table = this.expansions.get(entry.source) ?? new Map();
        table.set(refKey(entry.workReference), entry.status);
        this.expansions.set(entry.source, table);
      }
    }
  }
}

function makeSource(source: SourceId, index: CorpusIndex): EvidenceSource {
  const outcomeFrom = (
    status: CorpusSearchStatus | CorpusFetchStatus | CorpusExpansionStatus,
  ): SourceSearchOutcome | SourceFetchOutcome | SourceExpansionOutcome => {
    if (status.kind === "no_record") return { status: "no_record" };
    if (status.kind === "failed") {
      return { status: "failed", failure: status.failure };
    }
    if (status.kind === "hits") {
      return {
        status: "ok",
        hits: status.records.map((record) => ({
          record,
          matchedAliases: status.aliases ?? [],
        })),
      };
    }
    return { status: "ok", records: status.records };
  };

  return {
    source,
    search(
      query: BookQuery,
      options: RequestOptions,
    ): Promise<SourceSearchOutcome> {
      if (options.signal?.aborted) {
        return Promise.resolve({ status: "cancelled" });
      }
      const table = index.search.get(source) ?? new Map();
      const status = table.get(normalizeTitleText(query.title));
      const outcome = status === undefined
        ? { kind: "no_record" as const }
        : status;
      return Promise.resolve(outcomeFrom(outcome) as SourceSearchOutcome);
    },
    fetch(
      reference: ExternalReference,
      options: RequestOptions,
    ): Promise<SourceFetchOutcome> {
      if (options.signal?.aborted) {
        return Promise.resolve({ status: "cancelled" });
      }
      const table = index.fetches.get(source) ?? new Map();
      const status = table.get(refKey(reference));
      const outcome = status === undefined
        ? { kind: "no_record" as const }
        : status;
      return Promise.resolve(outcomeFrom(outcome) as SourceFetchOutcome);
    },
    expandEditions(
      workReference: ExternalReference,
      options: RequestOptions,
    ): Promise<SourceExpansionOutcome> {
      if (options.signal?.aborted) {
        return Promise.resolve({ status: "cancelled" });
      }
      const table = index.expansions.get(source) ?? new Map();
      const status = table.get(refKey(workReference));
      if (status === undefined) {
        return Promise.resolve({ status: "ok", records: [], warnings: [] });
      }
      if (status.kind === "failed") {
        return Promise.resolve({ status: "failed", failure: status.failure });
      }
      return Promise.resolve({
        status: "ok",
        records: status.records,
        warnings: [],
      });
    },
  };
}

/** Build the two fixture evidence sources over the acceptance corpus. */
export function createFixtureSources(): readonly EvidenceSource[] {
  const index = new CorpusIndex(CORPUS_PROFILES);
  return [makeSource("openlibrary", index), makeSource("wikidata", index)];
}
