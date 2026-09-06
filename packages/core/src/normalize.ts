/**
 * Deterministic normalization (issue #7 section 5).
 *
 * Normalization is a comparison-input function, never a data transform.
 * Source spelling is preserved for display everywhere; only comparison keys
 * pass through these helpers. No floating point is used anywhere.
 */

/** Unicode whitespace class including non-ASCII space separators. */
const WHITESPACE_RE =
  /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u;

function collapseWhitespaceRuns(text: string): string {
  let out = "";
  let pendingSpace = false;
  for (const ch of text) {
    if (WHITESPACE_RE.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

/**
 * Grouping text key (issue #7 5.1): NFC, trim Unicode whitespace, collapse
 * every internal run of Unicode whitespace to one ASCII space. Case,
 * punctuation, and wording are preserved.
 */
export function normalizeTitleText(raw: string): string {
  const nfc = raw.normalize("NFC");
  let start = 0;
  let end = nfc.length;
  while (start < end && WHITESPACE_RE.test(nfc[start])) start++;
  while (end > start && WHITESPACE_RE.test(nfc[end - 1])) end--;
  return collapseWhitespaceRuns(nfc.slice(start, end));
}

export function isBlankTitle(raw: string): boolean {
  return normalizeTitleText(raw) === "";
}

/** Map of Open Library MARC 3-letter codes observed for the acceptance
 *  corpus to canonical BCP 47 primary subtags (issue #7 section 5.2). */
const OPEN_LIBRARY_MARC_MAP: Readonly<Record<string, string>> = {
  chi: "zh",
  eng: "en",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  por: "pt",
  rus: "ru",
  spa: "es",
  ara: "ar",
  yue: "yue",
  mul: "mul",
  und: "und",
};

/**
 * Canonicalize an upstream language value to a canonical BCP 47 tag, or to
 * the sentinels `und` (unknown) / `mul` (multilingual). An empty or missing
 * value yields `und`; an unmapped MARC-like value is unknown evidence and
 * canonicalizes to `und` (the caller retains the raw value for warnings).
 */
export function canonicalizeLang(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "und";
  const trimmed = raw.trim();
  if (trimmed === "") return "und";
  const marc = OPEN_LIBRARY_MARC_MAP[trimmed.toLowerCase()];
  if (marc !== undefined) return marc;
  const canonical = canonicalizeBcp47(trimmed);
  return canonical ?? "und";
}

/**
 * Canonicalize a BCP 47-style tag: lowercase the language subtag,
 * title-case a four-letter script subtag, uppercase a two-letter or
 * three-digit region subtag, keep other subtags lowercase, join with `-`.
 * Returns null for a syntactically invalid tag.
 */
export function canonicalizeBcp47(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split("-");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!/^[A-Za-z0-9]+$/u.test(part)) return null;
    if (i === 0) {
      if (!/^[A-Za-z]{2,8}$/u.test(part)) return null;
      out.push(part.toLowerCase());
    } else if (part.length === 4 && /^[A-Za-z]{4}$/u.test(part)) {
      out.push(part[0].toUpperCase() + part.slice(1).toLowerCase());
    } else if (part.length === 2 && /^[A-Za-z]{2}$/u.test(part)) {
      out.push(part.toUpperCase());
    } else if (part.length === 3 && /^[0-9]{3}$/u.test(part)) {
      out.push(part);
    } else {
      out.push(part.toLowerCase());
    }
  }
  return out.join("-");
}

/**
 * RFC 4647 basic language-range matching for one requested range
 * (issue #7 section 5.4): `G == R` or `G` starts with `R + "-"`.
 * `und`/`mul` satisfy no specific range.
 */
export function matchesLanguageRange(
  groupTag: string,
  requestedRange: string,
): boolean {
  if (groupTag === "und" || groupTag === "mul") return false;
  return (
    groupTag === requestedRange || groupTag.startsWith(requestedRange + "-")
  );
}

/**
 * True when a group satisfies a target list: with an empty target list every
 * known-language group is in scope; otherwise basic filtering matches at
 * least one target. `und`/`mul` never satisfy any request.
 */
export function satisfiesTargetList(
  groupTag: string,
  targetLanguages: readonly string[],
): boolean {
  if (groupTag === "und" || groupTag === "mul") return false;
  if (targetLanguages.length === 0) return true;
  return targetLanguages.some((range) => matchesLanguageRange(groupTag, range));
}

/** True when the tag is a valid canonicalizable requested language. The
 *  sentinels `und` and `mul` are rejected because they cannot be requested. */
export function isValidRequestedLanguage(raw: string): boolean {
  const canonical = canonicalizeBcp47(raw);
  return canonical !== null && canonical !== "und" && canonical !== "mul";
}

// ---------------------------------------------------------------------------
// Identifier normalization (issue #7 section 5.3)
// ---------------------------------------------------------------------------

function stripIsbnDecorations(raw: string): string {
  let value = raw.replace(/[\s-]/g, "").toUpperCase();
  if (value.startsWith("ISBN")) value = value.slice(4);
  return value;
}

/** True when the cleaned string is a structurally valid ISBN-10. */
export function isValidIsbn10(cleaned: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/u.test(cleaned)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = cleaned[i] === "X" ? 10 : Number(cleaned[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/** True when the cleaned string is a structurally valid ISBN-13. */
export function isValidIsbn13(cleaned: string): boolean {
  if (!/^[0-9]{13}$/u.test(cleaned)) return false;
  if (!cleaned.startsWith("978") && !cleaned.startsWith("979")) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = Number(cleaned[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return sum % 10 === 0;
}

function isbn13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(digits12[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check;
}

/**
 * Canonical ISBN form: digits only. ISBN-10 values convert to ISBN-13 with
 * the 978 prefix and a recomputed check digit. A cleaned string with an
 * invalid check digit is compared as-is so malformed values never block
 * comparison of otherwise identical strings.
 */
export function canonicalizeIsbn(raw: string): string {
  const cleaned = stripIsbnDecorations(raw);
  if (isValidIsbn10(cleaned)) {
    const digits12 = "978" + cleaned.slice(0, 9);
    return digits12 + String(isbn13CheckDigit(digits12));
  }
  return cleaned;
}

/**
 * Canonical identifier key for non-ISBN identifiers: whitespace stripped and
 * lowercased so comparison is case-insensitive. The source form is retained
 * on the claim.
 */
export function canonicalizeSimpleIdentifier(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** External reference values: Open Library and Wikidata keys are used exactly
 *  as the source emits them (redirect canonicalization happens upstream of
 *  Core). Returns a whitespace-trimmed value. */
export function canonicalReferenceValue(raw: string): string {
  return raw.trim();
}

function looksLikeIsbn(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase().replace(/^ISBN/, "");
  return /^[0-9]{9}[0-9X]$/u.test(cleaned) || /^[0-9]{13}$/u.test(cleaned);
}

/** True when two identifier strings have equal canonical comparison forms. */
export function canonicalIdentifierEquality(a: string, b: string): boolean {
  if (looksLikeIsbn(a) && looksLikeIsbn(b)) {
    return canonicalizeIsbn(a) === canonicalizeIsbn(b);
  }
  return canonicalizeSimpleIdentifier(a) === canonicalizeSimpleIdentifier(b);
}
