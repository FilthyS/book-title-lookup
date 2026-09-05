/**
 * Single-version-stamp resolution for the distribution slice (ticket #20 /
 * section 6.6, docs/design/npm-release-topology.md section 7.1).
 *
 * No checked-in file holds a divergent release version. The release stamp is
 * derived in precedence order:
 *
 *   1. the `BOOK_TITLE_RELEASE_VERSION` build environment variable (explicit
 *      override for CI and dry-runs without a tag), then
 *   2. the exact git tag `v<version>` on HEAD (the release source commit),
 *      then
 *   3. the default source version, which stays in lockstep with the checked-in
 *      `VERSION` stamp in apps/tui/src/version.ts.
 *
 * Every package.json `version` and every pinned `optionalDependencies` entry
 * is stamped from the single result, and the artifact manifest records the
 * same value so validation can detect any drift.
 */

import { repoRoot, runCommand } from "./_common.ts";

/** Build-only environment override name (never read by the application). */
export const RELEASE_VERSION_ENV = "BOOK_TITLE_RELEASE_VERSION";

/** Default development/source version, in lockstep with apps VERSION 0.1.0. */
export const DEFAULT_VERSION = "0.1.0";

/** npm `version` values are plain `major.minor.patch`. */
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export type VersionSource = "env" | "git_tag" | "default";

export interface ResolvedVersion {
  readonly version: string;
  readonly source: VersionSource;
}

export function isValidVersion(value: string): boolean {
  return VERSION_RE.test(value);
}

export function parseReleaseVersion(raw: string): {
  readonly ok: true;
  readonly version: string;
} | { readonly ok: false; readonly error: string } {
  const trimmed = raw.trim();
  if (!VERSION_RE.test(trimmed)) {
    return {
      ok: false,
      error: `invalid version ${
        JSON.stringify(raw)
      }: expected major.minor.patch`,
    };
  }
  return { ok: true, version: trimmed };
}

/** Read the exact `v<version>` tag at HEAD, if any. */
export async function readGitReleaseTag(): Promise<string | null> {
  const result = await runCommand("git", [
    "describe",
    "--tags",
    "--exact-match",
  ], { cwd: repoRoot() });
  if (result.code !== 0) return null;
  const tag = result.stdout.trim();
  if (!tag.startsWith("v")) return null;
  const candidate = tag.slice(1);
  return VERSION_RE.test(candidate) ? candidate : null;
}

export interface ResolveOptions {
  readonly env?: (name: string) => string | undefined;
  readonly readTag?: () => Promise<string | null>;
  readonly defaultVersion?: string;
}

export async function resolveReleaseVersion(
  options: ResolveOptions = {},
): Promise<ResolvedVersion> {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const readTag = options.readTag ?? readGitReleaseTag;
  const defaultVersion = options.defaultVersion ?? DEFAULT_VERSION;

  const fromEnv = env(RELEASE_VERSION_ENV);
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    const parsed = parseReleaseVersion(fromEnv);
    if (parsed.ok) return { version: parsed.version, source: "env" };
    throw new Error(
      `distribution: ${parsed.error} (from ${RELEASE_VERSION_ENV})`,
    );
  }

  const tagVersion = await readTag();
  if (tagVersion !== null) return { version: tagVersion, source: "git_tag" };

  return { version: defaultVersion, source: "default" };
}

async function entry(argv: readonly string[]): Promise<number> {
  const resolved = await resolveReleaseVersion();
  // `--check <version>` validates the stamp without printing on success.
  const checkIndex = argv.indexOf("--check");
  if (checkIndex !== -1) {
    const expected = argv[checkIndex + 1];
    if (expected === undefined) {
      console.error("distribution: --check requires a version argument");
      return 2;
    }
    if (expected !== resolved.version) {
      console.error(
        `distribution: version mismatch: resolved ${resolved.version} ` +
          `(source ${resolved.source}) != requested ${expected}`,
      );
      return 1;
    }
    console.log(resolved.version);
    return 0;
  }
  console.log(`${resolved.version}\t${resolved.source}`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await entry(Deno.args));
}
