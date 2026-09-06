/**
 * Wikidata -> Core SourceRecord mapping (research #2 mapping table, issue #7
 * section 4). Mapping turns decoded entity/SPARQL facts into the Core
 * evidence vocabulary while preserving provenance, statement ids, ranks,
 * qualifier language, and (never) letting labels/aliases become attestations.
 *
 * Mapping rules (research #2 "Distinguishing labels/aliases from Title
 * Attestations"):
 * - A P1476 title statement on a qualifying Edition (rank not deprecated)
 *   attests a title with its monolingual language tag (or a P407 qualifier).
 * - P1680 subtitle qualifiers travel with the title statement id.
 * - Edition P629 is the Edition-to-Work edge (`work-link`).
 * - P407 gives content-language claims on the Edition item and a P407
 *   qualifier supplies title language when the monolingual text has none.
 * - P648 is an `openlibrary:work` identifier (rank preserved for the
 *   deprecated/normal conflict warning); P212/P957 are ISBN identifiers.
 * - Labels, aliases, descriptions, and sitelinks never enter the claim set.
 */

import type { Claim, SourceRecord } from "../../../core/src/evidence.ts";
import type {
  ExternalReference,
  ExternalReferenceNamespace,
  LanguageTag,
} from "../../../core/src/domain.ts";
import {
  canonicalizeIsbn,
  canonicalizeLang,
} from "../../../core/src/normalize.ts";
import type { WdEntity, WdStatement, WdValue } from "./decoders.ts";
import { WD_LANGUAGE_ITEMS } from "./config.ts";

/** Edition-class P31 roots and subclasses observed in the corpus. Q7553
 *  (translation) alone is not treated as an Edition class: a translation is
 *  only an edition when it also carries an Edition class such as Q3331189. */
const EDITION_CLASS_IDS: ReadonlySet<string> = new Set([
  "Q3331189", // version, edition or translation
  "Q59466300", // print edition
]);

/** Work-class P31 values (Books "work" family under Q386724). */
const WORK_CLASS_IDS: ReadonlySet<string> = new Set([
  "Q386724", // work
  "Q7725634", // literary work
  "Q47461344", // written work
  "Q8261", // novel
]);

export type WdEntityKind = "work" | "edition" | "other";

export interface MapSourceContext {
  readonly sourceRecordUrl: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
}

function reference(
  ns: ExternalReferenceNamespace,
  value: string,
): ExternalReference {
  return { namespace: ns, value };
}

function itemValue(value: WdValue): string | undefined {
  return value.kind === "item" ? value.id : undefined;
}

/** Entity P31 item ids at a non-deprecated rank. */
function p31Items(entity: WdEntity): readonly string[] {
  const out: string[] = [];
  for (const claim of entity.claims) {
    if (claim.property !== "P31") continue;
    if (claim.rank === "deprecated") continue;
    const id = itemValue(claim.value);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Classify a decoded entity as Work, Edition, or Other from its P31. */
export function classifyEntity(entity: WdEntity): WdEntityKind {
  const p31 = p31Items(entity);
  if (p31.some((id) => EDITION_CLASS_IDS.has(id))) return "edition";
  if (p31.some((id) => WORK_CLASS_IDS.has(id))) return "work";
  return "other";
}

function withRank(rank: WdStatement["rank"]): {
  readonly rank?: "preferred" | "normal" | "deprecated";
} {
  return rank === undefined ? {} : { rank };
}

function languageTagFromItem(itemId: string): LanguageTag | undefined {
  const mapped = WD_LANGUAGE_ITEMS[itemId];
  if (mapped !== undefined) return mapped;
  const canonical = canonicalizeLang(itemId);
  return canonical === "und" ? undefined : canonical;
}

/** P407 qualifier language on a statement when the item maps to a tag. */
function qualifierLanguage(statement: WdStatement): LanguageTag | undefined {
  for (const qualifier of statement.qualifiers) {
    if (qualifier.property !== "P407") continue;
    const id = itemValue(qualifier.value);
    if (id === undefined) continue;
    const tag = languageTagFromItem(id);
    if (tag !== undefined) return tag;
  }
  return undefined;
}

function subtitleOf(statement: WdStatement): string | undefined {
  for (const qualifier of statement.qualifiers) {
    if (qualifier.property !== "P1680") continue;
    if (qualifier.value.kind === "monolingual") {
      if (qualifier.value.text.trim() !== "") {
        return qualifier.value.text.trim();
      }
    } else if (qualifier.value.kind === "string") {
      if (qualifier.value.value.trim() !== "") {
        return qualifier.value.value.trim();
      }
    }
  }
  return undefined;
}

/** Title claims emitted from P1476 title statements (rank != deprecated). */
export function titleClaimsFromEntity(
  entity: WdEntity,
): Extract<Claim, { readonly type: "title" }>[] {
  const claims: Extract<Claim, { readonly type: "title" }>[] = [];
  for (const statement of entity.claims) {
    if (statement.property !== "P1476") continue;
    if (statement.rank === "deprecated") continue;
    if (statement.value.kind !== "monolingual") continue;
    const text = statement.value.text.trim();
    if (text === "") continue;
    const monolingualLanguage = canonicalizeLang(statement.value.language);
    const qualifierLanguageTag = qualifierLanguage(statement);
    const language =
      monolingualLanguage !== "und"
        ? monolingualLanguage
        : (qualifierLanguageTag ?? "und");
    claims.push({
      type: "title",
      text,
      ...(language !== "und" ? { language } : {}),
      ...(statement.id !== undefined ? { statementId: statement.id } : {}),
      ...withRank(statement.rank),
    });
  }
  return claims;
}

function contentLanguageClaims(
  entity: WdEntity,
): Extract<Claim, { readonly type: "content-language" }>[] {
  const out: Extract<Claim, { readonly type: "content-language" }>[] = [];
  const seen = new Set<string>();
  for (const claim of entity.claims) {
    if (claim.property !== "P407") continue;
    if (claim.rank === "deprecated") continue;
    const id = itemValue(claim.value);
    if (id === undefined) continue;
    const tag = languageTagFromItem(id);
    if (tag === undefined) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ type: "content-language", language: tag });
  }
  return out;
}

function identifierClaims(
  entity: WdEntity,
): Extract<Claim, { readonly type: "identifier" }>[] {
  const out: Extract<Claim, { readonly type: "identifier" }>[] = [];
  for (const claim of entity.claims) {
    if (claim.property === "P648") {
      if (claim.value.kind !== "string") continue;
      if (claim.value.value.trim() === "") continue;
      out.push({
        type: "identifier",
        namespace: "openlibrary:work",
        value: claim.value.value.trim(),
        ...(claim.id !== undefined ? { statementId: claim.id } : {}),
        ...withRank(claim.rank),
      });
      continue;
    }
    if (claim.property === "P212" || claim.property === "P957") {
      if (claim.value.kind !== "string") continue;
      const value = canonicalizeIsbn(claim.value.value);
      if (value === "") continue;
      out.push({
        type: "identifier",
        namespace: "isbn",
        value,
        ...(claim.id !== undefined ? { statementId: claim.id } : {}),
        ...withRank(claim.rank),
      });
    }
  }
  return out;
}

function classClaims(
  entity: WdEntity,
): Extract<Claim, { readonly type: "class" }>[] {
  const out: Extract<Claim, { readonly type: "class" }>[] = [];
  for (const claim of entity.claims) {
    if (claim.property !== "P31") continue;
    const id = itemValue(claim.value);
    if (id === undefined) continue;
    out.push({
      type: "class",
      value: `wikidata:property:${id}`,
      ...(claim.id !== undefined ? { statementId: claim.id } : {}),
      ...withRank(claim.rank),
    });
  }
  return out;
}

function subtitleClaimsFromEntity(
  entity: WdEntity,
): Extract<Claim, { readonly type: "subtitle" }>[] {
  const out: Extract<Claim, { readonly type: "subtitle" }>[] = [];
  for (const statement of entity.claims) {
    if (statement.property !== "P1476") continue;
    if (statement.rank === "deprecated") continue;
    const subtitle = subtitleOf(statement);
    if (subtitle === undefined) continue;
    out.push({
      type: "subtitle",
      text: subtitle,
      ...(statement.id !== undefined ? { statementId: statement.id } : {}),
      ...withRank(statement.rank),
    });
  }
  return out;
}

function workLinkClaims(
  entity: WdEntity,
): Extract<Claim, { readonly type: "work-link" }>[] {
  const out: Extract<Claim, { readonly type: "work-link" }>[] = [];
  for (const claim of entity.claims) {
    if (claim.property !== "P629") continue;
    const id = itemValue(claim.value);
    if (id === undefined) continue;
    out.push({
      type: "work-link",
      reference: reference("wikidata:item", id),
      ...(claim.id !== undefined ? { statementId: claim.id } : {}),
      ...withRank(claim.rank),
    });
  }
  return out;
}

function publicationClaims(entity: WdEntity): Claim[] {
  const out: Claim[] = [];
  for (const claim of entity.claims) {
    if (claim.property !== "P577") continue;
    if (claim.rank === "deprecated") continue;
    if (claim.value.kind !== "time") continue;
    const time = claim.value.time;
    if (time !== "") {
      out.push({ type: "publication-date", value: time });
    }
    const year = /^\+([0-9]{1,4})/.exec(time)?.[1];
    if (year !== undefined) {
      const parsed = Number(year);
      if (parsed >= 1 && parsed <= 9999) {
        out.push({ type: "publication-year", year: parsed });
      }
    }
  }
  return out;
}

function pageCountClaims(
  entity: WdEntity,
): Extract<Claim, { readonly type: "page-count" }>[] {
  const out: Extract<Claim, { readonly type: "page-count" }>[] = [];
  for (const claim of entity.claims) {
    if (claim.property !== "P1104") continue;
    if (claim.value.kind !== "quantity") continue;
    const amount = Number(claim.value.amount.replace(/^\+/, ""));
    if (Number.isFinite(amount) && amount > 0) {
      out.push({ type: "page-count", pages: Math.floor(amount) });
    }
  }
  return out;
}

/** Map a classified Edition entity to a Core SourceRecord. */
export function mapEditionEntity(
  entity: WdEntity,
  context: MapSourceContext,
): SourceRecord {
  const claims: Claim[] = [
    ...titleClaimsFromEntity(entity),
    ...subtitleClaimsFromEntity(entity),
    ...contentLanguageClaims(entity),
    ...workLinkClaims(entity),
    ...identifierClaims(entity),
    ...classClaims(entity),
    ...publicationClaims(entity),
    ...pageCountClaims(entity),
  ];
  return {
    source: "wikidata",
    sourceRecordUrl: context.sourceRecordUrl,
    fetchedAt: context.fetchedAt,
    stale: context.stale,
    kind: "edition",
    refs: [reference("wikidata:item", entity.id)],
    claims,
  };
}

/** Map a classified Work entity to a Core SourceRecord. */
export function mapWorkEntity(
  entity: WdEntity,
  context: MapSourceContext,
): SourceRecord {
  const claims: Claim[] = [
    ...titleClaimsFromEntity(entity),
    ...contentLanguageClaims(entity),
    ...identifierClaims(entity),
    ...classClaims(entity),
    ...publicationClaims(entity),
  ];
  return {
    source: "wikidata",
    sourceRecordUrl: context.sourceRecordUrl,
    fetchedAt: context.fetchedAt,
    stale: context.stale,
    kind: "work",
    refs: [reference("wikidata:item", entity.id)],
    claims,
  };
}

/** Map a classified entity to its Core SourceRecord, or undefined for Other. */
export function mapEntity(
  entity: WdEntity,
  context: MapSourceContext,
): SourceRecord | undefined {
  const kind = classifyEntity(entity);
  if (kind === "edition") return mapEditionEntity(entity, context);
  if (kind === "work") return mapWorkEntity(entity, context);
  return undefined;
}

/** A Shape 2 edition row converted to Core-edition terms. */
export interface SparqlEditionRow {
  readonly editionId: string;
  readonly workReference: ExternalReference;
  readonly title: string;
  readonly language?: LanguageTag;
  readonly isbn?: string;
}

/**
 * Map a fixed Shape 2 SPARQL edition row to an Edition SourceRecord. The row
 * already proves the Edition-to-Work edge (`wdt:P629`) and an Edition class,
 * so the mapped record carries a work-link to the confirmed Work.
 */
export function mapSparqlEditionRow(
  row: SparqlEditionRow,
  context: MapSourceContext,
): SourceRecord {
  const claims: Claim[] = [
    {
      type: "work-link",
      reference: row.workReference,
    },
    {
      type: "title",
      text: row.title,
      ...(row.language !== undefined && row.language !== "und"
        ? { language: row.language }
        : {}),
      rank: "normal",
    },
    ...(row.isbn !== undefined && row.isbn !== ""
      ? [
          {
            type: "identifier" as const,
            namespace: "isbn" as const,
            value: canonicalizeIsbn(row.isbn),
          },
        ]
      : []),
  ];
  return {
    source: "wikidata",
    sourceRecordUrl: context.sourceRecordUrl,
    fetchedAt: context.fetchedAt,
    stale: context.stale,
    kind: "edition",
    refs: [reference("wikidata:item", row.editionId)],
    claims,
  };
}

/** Entity label/alias texts usable as Search Alias matched evidence. */
export function aliasesOfEntity(
  entity: WdEntity,
): readonly { readonly text: string; readonly language?: string }[] {
  const out: { readonly text: string; readonly language?: string }[] = [];
  const push = (text: string, language?: string): void => {
    if (text.trim() === "") return;
    out.push({ text: text.trim(), ...(language ? { language } : {}) });
  };
  for (const label of entity.labels) push(label.text, label.language);
  for (const alias of entity.aliases) push(alias.text, alias.language);
  return out;
}
