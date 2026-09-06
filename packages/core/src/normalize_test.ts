/**
 * Core normalization tests (issue #7 section 5 invariants 1, 13, 14).
 */

import { assertEquals } from "@std/assert";
import {
  canonicalIdentifierEquality,
  canonicalizeBcp47,
  canonicalizeIsbn,
  canonicalizeLang,
  isValidRequestedLanguage,
  matchesLanguageRange,
  normalizeTitleText,
  satisfiesTargetList,
} from "./normalize.ts";

Deno.test("normalize title applies NFC, trims, and collapses whitespace only", () => {
  assertEquals(normalizeTitleText("  百年孤独  "), "百年孤独");
  assertEquals(
    normalizeTitleText("Cien\u00a0a\u00f1os\u00a0\u00a0de\u00a0soledad"),
    "Cien años de soledad",
  );
  assertEquals(normalizeTitleText("a  b\tc"), "a b c");
  // Case, punctuation, and wording are preserved.
  assertEquals(normalizeTitleText("  Hello, WORLD!  "), "Hello, WORLD!");
  // NFC composition is a fixed point.
  const composed = "Caf\u00e9";
  const decomposed = "Cafe\u0301";
  assertEquals(normalizeTitleText(decomposed), normalizeTitleText(composed));
  // Applying to an already-normalized title is a fixed point.
  const normalized = normalizeTitleText("  百年孤独  ");
  assertEquals(normalizeTitleText(normalized), normalized);
});

Deno.test("canonicalizeLang maps MARC codes and sentinels", () => {
  assertEquals(canonicalizeLang("chi"), "zh");
  assertEquals(canonicalizeLang("eng"), "en");
  assertEquals(canonicalizeLang("spa"), "es");
  assertEquals(canonicalizeLang("yue"), "yue");
  assertEquals(canonicalizeLang("mul"), "mul");
  assertEquals(canonicalizeLang("und"), "und");
  assertEquals(canonicalizeLang(null), "und");
  assertEquals(canonicalizeLang(""), "und");
});

Deno.test("canonicalizeLang canonicalizes BCP 47 tags", () => {
  assertEquals(canonicalizeLang("zh-hans"), "zh-Hans");
  assertEquals(canonicalizeLang("zh-Hant"), "zh-Hant");
  assertEquals(canonicalizeLang("zh-cn"), "zh-CN");
  assertEquals(canonicalizeLang("pt-br"), "pt-BR");
  assertEquals(canonicalizeLang("ja"), "ja");
});

Deno.test("canonicalizeBcp47 rejects malformed tags and sentinels stay valid tags", () => {
  assertEquals(canonicalizeBcp47("12ab"), null);
  assertEquals(canonicalizeBcp47("und"), "und");
  assertEquals(canonicalizeBcp47("zh-Hant-CN"), "zh-Hant-CN");
  assertEquals(isValidRequestedLanguage("und"), false);
  assertEquals(isValidRequestedLanguage("mul"), false);
  assertEquals(isValidRequestedLanguage("zh-hant"), true);
});

Deno.test("language matching follows RFC 4647 basic filtering", () => {
  assertEquals(matchesLanguageRange("zh", "zh"), true);
  assertEquals(matchesLanguageRange("zh-Hans", "zh"), true);
  assertEquals(matchesLanguageRange("zh-Hant", "zh-Hans"), false);
  assertEquals(matchesLanguageRange("zh", "zh-Hans"), false);
  assertEquals(matchesLanguageRange("und", "zh"), false);
  assertEquals(matchesLanguageRange("mul", "zh"), false);
  assertEquals(satisfiesTargetList("es", []), true);
  assertEquals(satisfiesTargetList("und", []), false);
  assertEquals(satisfiesTargetList("zh-Hans", ["zh"]), true);
});

Deno.test("isbn canonicalization converts ISBN-10 to ISBN-13", () => {
  // 7544253996 is the ISBN-10 form of the canonical 9787544253994.
  assertEquals(canonicalizeIsbn("7-5442-5399-6"), "9787544253994");
  assertEquals(canonicalizeIsbn("9787544253994"), "9787544253994");
  assertEquals(canonicalizeIsbn("ISBN 978-7-5442-5399-4"), "9787544253994");
  // A cleaned value with an invalid check digit is compared as-is.
  assertEquals(canonicalizeIsbn("9780140328720"), "9780140328720");
});

Deno.test("identifier equality compares canonical forms", () => {
  assertEquals(canonicalIdentifierEquality("ABC 123", "abc123"), true);
  assertEquals(
    canonicalIdentifierEquality("9780140328721", "978-0-14-032872-1"),
    true,
  );
  assertEquals(canonicalIdentifierEquality("ABC", "ABD"), false);
});
