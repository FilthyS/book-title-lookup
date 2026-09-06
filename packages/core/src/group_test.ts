/**
 * Grouping and recommendation tests (issue #7 sections 12-13, invariants
 * 4-9).
 */

import { assertEquals } from "@std/assert";
import type { LeveledAttestation } from "./group.ts";
import { groupAttestations } from "./group.ts";
import { compareGroups, finalizeGroups } from "./recommend.ts";
import type { TitleGroup } from "./module.ts";

function member(overrides: {
  readonly language: string;
  readonly text: string;
  readonly source?: "openlibrary" | "wikidata";
  readonly url?: string;
  readonly subtitle?: string | null;
  readonly level?: "verified" | "probable" | "ambiguous";
}): LeveledAttestation {
  return {
    level: overrides.level ?? "verified",
    attestation: {
      source: overrides.source ?? "openlibrary",
      role: "edition_title",
      text: overrides.text,
      subtitle: overrides.subtitle === undefined ? null : overrides.subtitle,
      language: overrides.language,
      sourceRecordUrl: overrides.url ?? "https://example.test/record.json",
      references: [],
      stale: false,
      fetchedAt: "2026-09-05T12:34:56.789Z",
    },
  };
}

Deno.test("group identical language/text/subtitle members merge without loss", () => {
  const groups = groupAttestations([
    member({ language: "es", text: "Cien años de soledad" }),
    member({
      language: "es",
      text: "Cien años de soledad",
      source: "wikidata",
      url: "https://example.test/wd.json",
      level: "probable",
    }),
    member({ language: "es", text: "Cien años  de  soledad" }),
  ]);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].language, "es");
  assertEquals(groups[0].level, "verified");
  assertEquals(groups[0].attestations.length, 3);
});

Deno.test("grouping keeps case, wording, language, and subtitle differences apart", () => {
  const groups = groupAttestations([
    member({ language: "es", text: "Cien años de soledad" }),
    member({ language: "es", text: "cien años de soledad" }),
    member({ language: "en", text: "One Hundred Years of Solitude" }),
    member({
      language: "es",
      text: "Cien años de soledad",
      subtitle: "novela",
    }),
    member({ language: "und", text: "百年孤独", level: "ambiguous" }),
  ]);
  assertEquals(groups.length, 5);
  const und = groups.find((group) => group.language === "und");
  assertEquals(und?.level, "ambiguous");
});

Deno.test("grouping is idempotent and member order is deterministic", () => {
  const a = groupAttestations([
    member({
      language: "zh",
      text: "百年孤独",
      level: "probable",
      url: "https://example.test/a.json",
    }),
    member({
      language: "zh",
      text: "百年孤独",
      level: "probable",
      url: "https://example.test/b.json",
    }),
  ]);
  const b = groupAttestations([
    member({
      language: "zh",
      text: "百年孤独",
      level: "probable",
      url: "https://example.test/b.json",
    }),
    member({
      language: "zh",
      text: "百年孤独",
      level: "probable",
      url: "https://example.test/a.json",
    }),
  ]);
  assertEquals(
    a[0].attestations[0].sourceRecordUrl,
    "https://example.test/a.json",
  );
  assertEquals(
    a[0].attestations[1].sourceRecordUrl,
    "https://example.test/b.json",
  );
  assertEquals(
    a[0].attestations[0].sourceRecordUrl,
    b[0].attestations[0].sourceRecordUrl,
  );
});

function rawGroups(): readonly TitleGroup[] {
  return groupAttestations([
    member({ language: "es", text: "Cien años de soledad" }),
    member({
      language: "zh",
      text: "Bai nian gu du",
    }),
    member({
      language: "zh",
      text: "百年孤独",
      level: "probable",
      url: "https://example.test/probable.json",
    }),
    member({
      language: "und",
      text: "某无语言记录",
      level: "ambiguous",
      url: "https://example.test/und.json",
    }),
  ]);
}

Deno.test("finalizeGroups recommends exactly one visible group per language", () => {
  const groups = rawGroups();
  const result = finalizeGroups(groups, ["es", "zh"], undefined);
  assertEquals(result.status, "found");
  const recommended = result.groups.filter((group) => group.recommended);
  assertEquals(recommended.length, 2);
  const zh = recommended.find((group) => group.language === "zh");
  assertEquals(zh?.title, "Bai nian gu du");
  assertEquals(zh?.level, "verified");
  const und = result.groups.find((group) => group.language === "und");
  assertEquals(und?.recommended, false);
  assertEquals(und?.satisfiesRequest, false);
});

Deno.test("finalizeGroups reports no_attested_titles when no default group satisfies", () => {
  const groups = rawGroups();
  const result = finalizeGroups(groups, ["zh-Hant"], undefined);
  assertEquals(result.status, "no_attested_titles");
  assertEquals(
    result.groups.some((group) => group.recommended),
    false,
  );
  // Ambiguous/und evidence stays listed.
  assertEquals(
    result.groups.some((group) => group.language === "und"),
    true,
  );
});

Deno.test("recommendation never survives a tie (total comparator)", () => {
  const a: TitleGroup = {
    language: "es",
    title: "Cien años de soledad",
    subtitle: null,
    level: "verified",
    recommended: false,
    satisfiesRequest: true,
    originalTitle: false,
    attestations: [],
  };
  const b: TitleGroup = {
    language: "es",
    title: "Cien años de soledad (Segunda edición)",
    subtitle: null,
    level: "verified",
    recommended: false,
    satisfiesRequest: true,
    originalTitle: false,
    attestations: [],
  };
  const order1 = compareGroups(a, b);
  const order2 = compareGroups(b, a);
  assertEquals(order1, -order2);
  assertEquals(order1 === 0, false);
});
