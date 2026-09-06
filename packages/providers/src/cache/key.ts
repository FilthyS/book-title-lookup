/**
 * Cache request identity and key (issue #10 sections 6 and 11).
 *
 * A cache key is a SHA-256 digest over a canonical provider + method + URL
 * identity serialized as compact JSON with keys in a fixed declaration order.
 * Query parameters are sorted by their percent-encoded name/value using
 * bytewise order; the path is never percent-decoded or re-encoded.
 */

export type ProviderId = "openlibrary" | "wikidata";

export interface CanonicalRequestIdentity {
  readonly provider: ProviderId;
  readonly method: "GET"; // The MVP issues no cacheable non-GET requests.
  readonly url: string;
}

export interface CacheKey {
  readonly algorithm: "sha256";
  readonly digest: string;
  readonly identity: CanonicalRequestIdentity;
}

function compareEncoded(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortedQuery(query: string): string {
  if (query === "") return "";
  const params = query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    return eq === -1
      ? { name: pair, value: "" }
      : {
          name: pair.slice(0, eq),
          value: pair.slice(eq + 1),
        };
  });
  params.sort((a, b) => {
    const byName = compareEncoded(a.name, b.name);
    return byName !== 0 ? byName : compareEncoded(a.value, b.value);
  });
  return params
    .map((p) => (p.value === "" ? p.name : `${p.name}=${p.value}`))
    .join("&");
}

/**
 * Canonicalize an absolute request URL: lowercase the scheme and authority,
 * keep the path exactly, sort query parameters by their percent-encoded
 * name/value in bytewise order, and drop no response-shaping parameter.
 */
export function canonicalizeRequestUrl(input: string): string {
  const fragmentAt = input.indexOf("#");
  const withoutFragment =
    fragmentAt === -1 ? input : input.slice(0, fragmentAt);
  const schemeAt = withoutFragment.indexOf("://");
  if (schemeAt === -1) return withoutFragment;

  const scheme = withoutFragment.slice(0, schemeAt).toLowerCase();
  const afterScheme = withoutFragment.slice(schemeAt + 3);
  const queryAt = afterScheme.indexOf("?");
  const pathAndAuthority =
    queryAt === -1 ? afterScheme : afterScheme.slice(0, queryAt);
  const query = queryAt === -1 ? "" : afterScheme.slice(queryAt + 1);

  const authorityEnd = pathAndAuthority.search(/[/?#]/);
  const authorityRaw =
    authorityEnd === -1
      ? pathAndAuthority
      : pathAndAuthority.slice(0, authorityEnd);
  const path = authorityEnd === -1 ? "" : pathAndAuthority.slice(authorityEnd);
  const authority = authorityRaw.toLowerCase();

  const sorted = query === "" ? "" : `?${sortedQuery(query)}`;
  return `${scheme}://${authority}${path}${sorted}`;
}

export function cacheKeyJson(identity: CanonicalRequestIdentity): string {
  return JSON.stringify({
    provider: identity.provider,
    method: identity.method,
    url: identity.url,
  });
}

export async function sha256HexUtf8(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const values = new Uint8Array(digest);
  let out = "";
  for (const value of values) {
    out += value.toString(16).padStart(2, "0");
  }
  return out;
}

export async function digestForIdentity(
  identity: CanonicalRequestIdentity,
): Promise<string> {
  return await sha256HexUtf8(cacheKeyJson(identity));
}

/** Compute the cache key for a canonicalized request identity. */
export async function computeCacheKey(
  provider: ProviderId,
  url: string,
): Promise<CacheKey> {
  const canonicalUrl = canonicalizeRequestUrl(url);
  const identity: CanonicalRequestIdentity = {
    provider,
    method: "GET",
    url: canonicalUrl,
  };
  const digest = await digestForIdentity(identity);
  return { algorithm: "sha256", digest, identity };
}
