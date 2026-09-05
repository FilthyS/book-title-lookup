/**
 * JSON decoder primitives (issue #8 section 6).
 *
 * - Content-type gate: JSON is parsed only when the response content type is
 *   JSON, or when an endpoint documents that a missing content type is JSON
 *   and the body starts with `{`/`[`. HTML bodies are never fed to a JSON
 *   decoder.
 * - Strict UTF-8: bodies are decoded with fatal errors; invalid byte
 *   sequences are malformed, never silently replaced.
 */

export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Decode bytes as strict UTF-8; null when the byte sequence is invalid. */
export function decodeUtf8Fatal(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  const media = lower.split(";")[0].trim();
  return media === "application/json" ||
    media === "text/json" ||
    media.endsWith("+json");
}

/**
 * Parse the raw body of a transport envelope as JSON when the response is
 * eligible. Returns `non_json` when the content type forbids a JSON parse.
 */
export function parseJsonEnvelope(env: {
  readonly contentType: string | null;
  readonly body: Uint8Array;
}): JsonParseResult {
  const text = decodeUtf8Fatal(env.body);
  if (text === null) return { ok: false, reason: "invalid_utf8" };
  const contentType = env.contentType?.toLowerCase() ?? "";
  const bodyStartsJson = text.trimStart().startsWith("{") ||
    text.trimStart().startsWith("[");
  if (contentType !== "") {
    if (!isJsonContentType(contentType)) {
      return { ok: false, reason: "non_json_content_type" };
    }
  } else if (!bodyStartsJson) {
    return { ok: false, reason: "non_json_body" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "unparseable_json" };
  }
}
