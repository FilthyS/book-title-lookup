/**
 * Redirect validation (issue #8 section 4). The runtime follows HTTP
 * redirects itself with `redirect: "manual"`; each Location must be https
 * and must resolve to an allowlisted host.
 */

export type RedirectTargetValidation =
  | { readonly ok: true; readonly to: string }
  | { readonly ok: false; readonly reason: string };

/** True when `host` is exactly allowlisted (never suffix-globbed). */
export function isAllowlistedHost(
  host: string,
  hosts: readonly string[],
): boolean {
  return hosts.some((allowed) => host === allowed);
}

/** Resolve and validate one Location header against the current URL. */
export function resolveRedirectLocation(
  currentUrl: string,
  location: string,
  hosts: readonly string[],
): RedirectTargetValidation {
  if (location.trim() === "") {
    return { ok: false, reason: "empty_location" };
  }
  let resolved: URL;
  try {
    resolved = new URL(location, currentUrl);
  } catch {
    return { ok: false, reason: "unparseable_location" };
  }
  if (resolved.protocol !== "https:") {
    return { ok: false, reason: "non_https_redirect" };
  }
  const hostname = resolved.hostname.toLowerCase();
  if (!isAllowlistedHost(hostname, hosts)) {
    return { ok: false, reason: "off_allowlist_redirect" };
  }
  return { ok: true, to: resolved.href };
}

/** Validate an initial request target. */
export function validateRequestUrl(
  url: string,
  hosts: readonly string[],
): RedirectTargetValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable_url" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "non_https_url" };
  }
  if (!isAllowlistedHost(parsed.hostname.toLowerCase(), hosts)) {
    return { ok: false, reason: "off_allowlist_url" };
  }
  return { ok: true, to: parsed.href };
}
