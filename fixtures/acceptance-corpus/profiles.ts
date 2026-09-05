/**
 * Corpus behavior profiles: the deterministic responses each source returns
 * for the fixed acceptance-corpus queries and references. Profiles are the
 * module-level fake's data seam (issue #6); a real provider composition later
 * replaces the engine that consumes them.
 */

import type {
  ExternalReference,
  ExternalReferenceNamespace,
  SourceFailure,
} from "../../packages/core/src/domain.ts";
import type { SourceRecord } from "../../packages/core/src/evidence.ts";
import {
  OL10263W_WORK,
  OL274505W_WORK,
  OL274507M_EDITION,
  OL43416865M_EDITION,
  OL43416865W_WORK,
  OL49205421W_WORK,
  OL49205422M_EDITION,
  OL49205423M_EDITION,
  OL49205424M_EDITION,
  OL59138652M_EDITION,
  OLFAIL_EXPAND_WORK,
  OLFAIL_WORK_REF,
  OL_WORK,
  OL_XWZ_ED_YUE,
  OL_XWZ_ED_ISO,
  OL_XWZ_WORK,
  OL_XWZ_ISO_WORK,
  OL_ED_ES,
  OL_ED_ZH_LATIN,
  OL_ED_ZH_DETACHED,
  OL_ISO_WORK,
  Q1100000001_EDITION,
  Q125131191_EDITION,
  Q151919_WORK,
  Q178869_WORK,
  WD_Q178869,
  WD_HZ_ED_EN,
  WD_HZ_ED_ZH,
  WD_HZ_WORK,
  ISBN_PRINCIPAL,
  ISBN_DUP,
  unavailableFailure,
  timeoutFailure,
} from "./records.ts";

export type SourceId = "openlibrary" | "wikidata";

export interface CorpusAlias {
  readonly text: string;
  readonly language?: string;
}

export type CorpusSearchStatus =
  | {
    readonly kind: "hits";
    readonly records: readonly SourceRecord[];
    readonly aliases?: readonly CorpusAlias[];
  }
  | { readonly kind: "no_record" }
  | { readonly kind: "failed"; readonly failure: SourceFailure };

export interface CorpusSearchEntry {
  readonly title: string;
  readonly source: SourceId;
  readonly status: CorpusSearchStatus;
}

export type CorpusFetchStatus =
  | { readonly kind: "ok"; readonly records: readonly SourceRecord[] }
  | { readonly kind: "no_record" }
  | { readonly kind: "failed"; readonly failure: SourceFailure };

export interface CorpusFetchEntry {
  readonly reference: ExternalReference;
  readonly source: SourceId;
  readonly status: CorpusFetchStatus;
}

export type CorpusExpansionStatus =
  | { readonly kind: "ok"; readonly records: readonly SourceRecord[] }
  | { readonly kind: "failed"; readonly failure: SourceFailure };

export interface CorpusExpansionEntry {
  readonly workReference: ExternalReference;
  readonly source: SourceId;
  readonly status: CorpusExpansionStatus;
}

export interface CorpusProfile {
  readonly id: string;
  readonly search: readonly CorpusSearchEntry[];
  readonly fetches: readonly CorpusFetchEntry[];
  readonly expansions: readonly CorpusExpansionEntry[];
}

function hits(
  records: readonly SourceRecord[],
  aliases?: readonly CorpusAlias[],
): CorpusSearchStatus {
  return { kind: "hits", records, ...(aliases !== undefined ? { aliases } : {}) };
}

function entry(
  ns: ExternalReferenceNamespace,
  value: string,
): ExternalReference {
  return { namespace: ns, value };
}

// ---------------------------------------------------------------------------
// 百年孤独 profile
// ---------------------------------------------------------------------------

const BAI_NIAN: CorpusProfile = {
  id: "bai-nian-gu-du",
  search: [
    {
      title: "百年孤独",
      source: "openlibrary",
      status: hits([OL274505W_WORK], [
        { text: "百年孤独", language: "zh" },
      ]),
    },
    {
      title: "百年孤独",
      source: "wikidata",
      status: hits([Q178869_WORK], [
        { text: "百年孤独", language: "zh" },
      ]),
    },
    {
      title: "Cien años de soledad",
      source: "openlibrary",
      status: hits([OL274505W_WORK], [
        { text: "Cien años de soledad", language: "es" },
      ]),
    },
    {
      title: "Cien años de soledad",
      source: "wikidata",
      status: hits([Q178869_WORK], [
        { text: "Cien años de soledad", language: "es" },
      ]),
    },
  ],
  fetches: [
    // Explicit Open Library Work key also returns the Wikidata identity.
    {
      reference: OL_WORK,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL274505W_WORK, Q178869_WORK],
      },
    },
    {
      reference: WD_Q178869,
      source: "wikidata",
      status: {
        kind: "ok",
        records: [Q178869_WORK, OL274505W_WORK],
      },
    },
    {
      reference: OL_ED_ES,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL274507M_EDITION, OL274505W_WORK, Q178869_WORK],
      },
    },
    {
      reference: OL_ED_ZH_LATIN,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL59138652M_EDITION, OL274505W_WORK, Q178869_WORK],
      },
    },
    {
      reference: entry("isbn", ISBN_PRINCIPAL),
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL274507M_EDITION, OL274505W_WORK, Q178869_WORK],
      },
    },
    {
      reference: OL_ED_ZH_DETACHED,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL43416865M_EDITION, OL43416865W_WORK],
      },
    },
  ],
  expansions: [
    {
      workReference: OL_WORK,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [
          OL274507M_EDITION,
          OL59138652M_EDITION,
          OL43416865M_EDITION,
        ],
      },
    },
    {
      workReference: WD_Q178869,
      source: "wikidata",
      status: { kind: "ok", records: [] },
    },
    {
      workReference: OL_ISO_WORK,
      source: "openlibrary",
      status: { kind: "ok", records: [OL43416865M_EDITION] },
    },
    {
      workReference: OL_WORK,
      source: "wikidata",
      status: { kind: "ok", records: [] },
    },
    {
      workReference: OL_ISO_WORK,
      source: "wikidata",
      status: { kind: "ok", records: [] },
    },
  ],
};

// ---------------------------------------------------------------------------
// 小王子 profile
// ---------------------------------------------------------------------------

const XIAO_WANG_ZI: CorpusProfile = {
  id: "xiao-wang-zi",
  search: [
    {
      title: "小王子",
      source: "openlibrary",
      status: hits([OL10263W_WORK], [
        { text: "小王子", language: "zh" },
      ]),
    },
    {
      title: "小王子 香港粵拼版",
      source: "openlibrary",
      status: { kind: "no_record" },
    },
  ],
  fetches: [
    {
      reference: OL_XWZ_WORK,
      source: "openlibrary",
      status: { kind: "ok", records: [OL10263W_WORK] },
    },
    {
      reference: OL_XWZ_ED_YUE,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL49205424M_EDITION, OL10263W_WORK],
      },
    },
    {
      reference: OL_XWZ_ED_ISO,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL49205422M_EDITION, OL49205421W_WORK],
      },
    },
    {
      reference: entry("isbn", ISBN_DUP),
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [
          OL49205424M_EDITION,
          OL10263W_WORK,
          OL49205422M_EDITION,
          OL49205421W_WORK,
        ],
      },
    },
  ],
  expansions: [
    {
      workReference: OL_XWZ_WORK,
      source: "openlibrary",
      status: {
        kind: "ok",
        records: [OL49205424M_EDITION, OL49205423M_EDITION],
      },
    },
    {
      workReference: OL_XWZ_WORK,
      source: "wikidata",
      status: { kind: "ok", records: [] },
    },
    {
      workReference: OL_XWZ_ISO_WORK,
      source: "openlibrary",
      status: { kind: "ok", records: [OL49205422M_EDITION] },
    },
  ],
};

// ---------------------------------------------------------------------------
// 活着 profile
// ---------------------------------------------------------------------------

const HUO_ZHE: CorpusProfile = {
  id: "huo-zhe",
  search: [
    {
      title: "活着",
      source: "wikidata",
      status: hits([Q151919_WORK], [
        { text: "活着", language: "zh" },
      ]),
    },
  ],
  fetches: [
    {
      reference: WD_HZ_WORK,
      source: "wikidata",
      status: { kind: "ok", records: [Q151919_WORK] },
    },
    {
      reference: WD_HZ_ED_EN,
      source: "wikidata",
      status: {
        kind: "ok",
        records: [Q125131191_EDITION, Q151919_WORK],
      },
    },
    {
      reference: WD_HZ_ED_ZH,
      source: "wikidata",
      status: {
        kind: "ok",
        records: [Q1100000001_EDITION, Q151919_WORK],
      },
    },
  ],
  expansions: [
    {
      workReference: WD_HZ_WORK,
      source: "wikidata",
      status: {
        kind: "ok",
        records: [Q125131191_EDITION, Q1100000001_EDITION],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Partial-outage and all-failed profiles
// ---------------------------------------------------------------------------

const PARTIAL_OUTAGE: CorpusProfile = {
  id: "partial-outage",
  search: [
    {
      title: "partial-fixture",
      source: "openlibrary",
      status: hits([OL274505W_WORK], [
        { text: "partial-fixture", language: "zh" },
      ]),
    },
    {
      title: "partial-fixture",
      source: "wikidata",
      status: { kind: "failed", failure: unavailableFailure("wikidata") },
    },
  ],
  fetches: [],
  expansions: [],
};

const ALL_FAILED_SEARCH: CorpusProfile = {
  id: "all-failed-search",
  search: [
    {
      title: "all-failed-fixture",
      source: "openlibrary",
      status: { kind: "failed", failure: timeoutFailure("openlibrary") },
    },
    {
      title: "all-failed-fixture",
      source: "wikidata",
      status: { kind: "failed", failure: unavailableFailure("wikidata") },
    },
  ],
  fetches: [],
  expansions: [],
};

const RESOLVE_FAIL_WORK = entry("openlibrary:work", "OLFAILFETCH999W");

const ALL_FAILED_RESOLVE: CorpusProfile = {
  id: "all-failed-resolve",
  search: [],
  fetches: [
    {
      reference: RESOLVE_FAIL_WORK,
      source: "openlibrary",
      status: { kind: "failed", failure: timeoutFailure("openlibrary") },
    },
    {
      reference: RESOLVE_FAIL_WORK,
      source: "wikidata",
      status: { kind: "failed", failure: unavailableFailure("wikidata") },
    },
  ],
  expansions: [],
};

const FAIL_EXPANSION: CorpusProfile = {
  id: "fail-expansion",
  search: [],
  fetches: [
    {
      reference: OLFAIL_WORK_REF,
      source: "openlibrary",
      status: { kind: "ok", records: [OLFAIL_EXPAND_WORK] },
    },
  ],
  expansions: [
    {
      workReference: OLFAIL_WORK_REF,
      source: "openlibrary",
      status: { kind: "failed", failure: timeoutFailure("openlibrary") },
    },
    {
      workReference: OLFAIL_WORK_REF,
      source: "wikidata",
      status: { kind: "failed", failure: unavailableFailure("wikidata") },
    },
  ],
};

/** All corpus behavior used by fixture-backed CLI runs. */
export const CORPUS_PROFILES: readonly CorpusProfile[] = [
  BAI_NIAN,
  XIAO_WANG_ZI,
  HUO_ZHE,
  PARTIAL_OUTAGE,
  ALL_FAILED_SEARCH,
  ALL_FAILED_RESOLVE,
  FAIL_EXPANSION,
];

/** Reference that fails on every resolution path. */
export const ALL_FAILED_RESOLVE_WORK = RESOLVE_FAIL_WORK;
