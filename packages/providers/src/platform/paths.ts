/**
 * Pure lexical path canonicalization and containment (issue #5 section 3.3,
 * issue #10 section 16). The persistence seam re-canonicalizes every target
 * beneath one of the two resolved roots and rejects `..` escapes and prefix
 * siblings such as `cache-evil`.
 *
 * The helpers are style-parameterized so fixture runs can exercise Windows
 * and POSIX semantics on any host. Runtime paths handed to Node stay in the
 * platform's native shape.
 */

import type { PlatformKind } from "./platform.ts";

export type PathStyle = "posix" | "windows";

export function styleFromPlatform(platform: PlatformKind): PathStyle {
  return platform === "windows" ? "windows" : "posix";
}

/**
 * Lexically canonicalize an absolute path for the given style: collapse
 * duplicate separators, resolve `.` and `..`, and keep the root. POSIX paths
 * stay case-sensitive; Windows paths fold only the drive letter but compare
 * case-insensitively through the containment helpers.
 */
export function canonicalPath(input: string, style: PathStyle): string {
  if (style === "posix") {
    return canonicalPosix(input);
  }
  return canonicalWindows(input);
}

function canonicalPosix(input: string): string {
  const parts = input.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

function canonicalWindows(input: string): string {
  // Normalize separators, then detect and retain a leading root.
  let root = "";
  let rest = input;
  if (/^[A-Za-z]:[\\/]/.test(input)) {
    root = input.slice(0, 2).toUpperCase() + "\\";
    rest = input.slice(2);
  } else if (input.startsWith("\\\\")) {
    // Preserve the UNC authority prefix (\\server\share\...).
    const without = input.slice(2);
    const slash = without.search(/[\\/]/);
    const server = slash === -1 ? without : without.slice(0, slash);
    const shareStart = slash === -1 ? without.length : slash + 1;
    const shareRaw = without.slice(shareStart);
    const shareEnd = shareRaw.search(/[\\/]/);
    const share = shareEnd === -1 ? shareRaw : shareRaw.slice(0, shareEnd);
    if (server && share) {
      root = "\\\\" + server + "\\" + share + "\\";
      rest = shareEnd === -1 ? "" : shareRaw.slice(shareEnd + 1);
    } else {
      rest = input;
    }
  } else if (input.startsWith("\\") || input.startsWith("/")) {
    root = "\\";
    rest = input.slice(1);
  }

  const out: string[] = [];
  const rawParts = rest.split(/[\\/]/);
  for (const part of rawParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join("\\");
  if (root === "\\") {
    return "\\" + joined;
  }
  return root + joined;
}

export function isAbsolutePath(path: string, style: PathStyle): boolean {
  if (style === "windows") {
    return (
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.startsWith("\\\\") ||
      path.startsWith("/") ||
      path.startsWith("\\")
    );
  }
  return path.startsWith("/");
}

/**
 * Join absolute/relative parts into one canonical path for the style. The
 * first part normally carries the root.
 */
export function joinPath(style: PathStyle, ...parts: string[]): string {
  if (style === "windows") {
    const joined = parts.join("\\");
    return canonicalPath(joined, "windows");
  }
  return canonicalPath(parts.join("/"), "posix");
}

function fold(path: string, style: PathStyle): string {
  return style === "windows" ? path.toLowerCase() : path;
}

/**
 * True when child is equal to parent or sits beneath it (after lexical
 * canonicalization and, on Windows, case folding). A prefix-sibling such as
 * `cache-evil` is rejected.
 */
export function isPathWithin(
  parent: string,
  child: string,
  style: PathStyle,
): boolean {
  const canonicalParent = canonicalPath(parent, style);
  const canonicalChild = canonicalPath(child, style);
  const p = fold(canonicalParent, style);
  const c = fold(canonicalChild, style);
  if (c === p) return true;
  const sep = style === "windows" ? "\\" : "/";
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Returns the child path relative to parent ("" when equal), or null when the
 * child escapes the parent.
 */
export function relativePathFrom(
  parent: string,
  child: string,
  style: PathStyle,
): string | null {
  const canonicalParent = canonicalPath(parent, style);
  const canonicalChild = canonicalPath(child, style);
  if (!isPathWithin(canonicalParent, canonicalChild, style)) {
    return null;
  }
  const p = fold(canonicalParent, style);
  const c = fold(canonicalChild, style);
  const sep = style === "windows" ? "\\" : "/";
  if (c === p) return "";
  return canonicalChild.slice(p.length + (p.endsWith(sep) ? 0 : 1));
}

export function basenameOf(path: string, style: PathStyle): string {
  const canonical = canonicalPath(path, style);
  const sep = style === "windows" ? "\\" : "/";
  if (canonical.endsWith(sep)) {
    return canonicalPath(joinPath(style, canonical, "."), style);
  }
  const idx = canonical.lastIndexOf(sep);
  return idx === -1 ? canonical : canonical.slice(idx + 1);
}
