/**
 * Shared, side-effect-free packaging metadata used by the pack/manifest/
 * verify scripts and their tests.
 *
 * The checked-in npm package.json files in distribution/npm are templates
 * whose version is the placeholder `0.0.0`. Every generated (stamped) package
 * under dist/ replaces that placeholder with the single resolved release
 * version so the source tree never carries a divergent release stamp.
 */

import type { TargetInfo } from "./_common.ts";

/** Placeholder version in checked-in templates (never packed or published). */
export const PLACEHOLDER_VERSION = "0.0.0";

export function launcherPackageName(): string {
  return "book-title-lookup";
}

/** The four names the launcher pins as optional dependencies, in order. */
export function launcherOptionalDependencyNames(): readonly string[] {
  return [
    "book-title-lookup-win32-x64",
    "book-title-lookup-linux-x64",
    "book-title-lookup-darwin-x64",
    "book-title-lookup-darwin-arm64",
  ];
}

/** Files a stamped launcher tree must contain (npm pack path form). */
export function launcherExpectedFiles(): readonly string[] {
  return ["package.json", "bin/book-title.js"];
}

/** Files a stamped platform tree for `target` must contain. */
export function platformExpectedFiles(target: TargetInfo): readonly string[] {
  return ["package.json", "index.js", `bin/${target.binaryFile}`];
}

/** File/dir names that must never appear inside a packed tarball. */
const FORBIDDEN_SUBSTRINGS = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "deno.lock",
  ".npmrc",
  ".yarnrc",
  ".env",
  "node_modules",
  ".DS_Store",
  "coverage",
  ".tmp",
  ".git",
  ".deno-version",
];

export function isForbiddenFileName(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return FORBIDDEN_SUBSTRINGS.some((needle) =>
    normalized.split("/").includes(needle)
  );
}

export interface FileListCheck {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

/**
 * A packed file list must contain exactly the expected files: nothing extra
 * (no lockfiles, cache, editor, source, or secret files) and nothing missing.
 */
export function checkFileList(
  files: readonly string[],
  expected: readonly string[],
): FileListCheck {
  const messages: string[] = [];
  const actual = [...files].sort();
  const expect = [...expected].sort();
  if (actual.length !== expect.length) {
    messages.push(
      `file count mismatch: expected ${expect.length}, found ${actual.length}`,
    );
  }
  const missing = expect.filter((f) => !actual.includes(f));
  for (const f of missing) {
    messages.push(`expected file missing: ${f}`);
  }
  const extra = actual.filter((f) => !expect.includes(f));
  for (const f of extra) {
    if (isForbiddenFileName(f)) {
      messages.push(`forbidden file packed: ${f}`);
    } else {
      messages.push(`unexpected file packed: ${f}`);
    }
  }
  return { ok: messages.length === 0, messages };
}

export interface PackageJsonSeed {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly bin?: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly license: string;
  readonly type: string;
  readonly files: readonly string[];
}

export function launcherPackageJson(version: string): PackageJsonSeed {
  const optionalDependencies: Record<string, string> = {};
  for (const name of launcherOptionalDependencyNames()) {
    optionalDependencies[name] = version;
  }
  return {
    name: launcherPackageName(),
    version,
    description: "Find attested titles of the same book across languages.",
    license: "MIT",
    type: "commonjs",
    bin: { "book-title": "bin/book-title.js" },
    files: ["bin/"],
    engines: { node: ">=18" },
    optionalDependencies,
  };
}

export function platformPackageJson(
  target: TargetInfo,
  version: string,
): PackageJsonSeed {
  return {
    name: target.packageName,
    version,
    description:
      `Platform binary for book-title-lookup (${target.description}).`,
    license: "MIT",
    type: "commonjs",
    main: "index.js",
    files: ["index.js", "bin/"],
    os: [target.os],
    cpu: [target.cpu],
  };
}
