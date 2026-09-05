/**
 * Artifact-manifest generation and validation (ticket #20 / section 6.6,
 * npm-release-topology.md section 7.2).
 *
 * Walks the stamped package trees under dist/npm and the tarballs produced by
 * pack.ts, then writes dist/manifest.json recording, per package: name,
 * version, tarball file name, tarball SHA-256, npm `integrity` (sha512), the
 * ordered file list with sizes, and (for platform packages) the `deno
 * compile` target, binary size and hash, and the Deno version used. It also
 * verifies version lockstep and that no package retained the placeholder
 * version.
 */

import {
  binaryDenoVersionPath,
  exists,
  manifestPath,
  npmDir,
  readText,
  sha256HexOfFile,
  sha512IntegrityOfFile,
  statOf,
  tarballPath,
  TARGETS,
  writeText,
} from "./_common.ts";
import { PLACEHOLDER_VERSION } from "./_package.ts";

export const MANIFEST_SCHEMA = "book-title-distribution-manifest.v1";

export interface ManifestFileEntry {
  readonly path: string;
  readonly size: number;
}

export interface ManifestBinaryInfo {
  readonly file: string;
  readonly denoTarget: string;
  readonly denoVersion?: string;
  readonly source: "compiled" | "stub";
  readonly size: number;
  readonly sha256: string;
}

export interface ManifestPackage {
  readonly name: string;
  readonly kind: "launcher" | "platform";
  readonly version: string;
  readonly files: readonly ManifestFileEntry[];
  readonly tarball: string;
  readonly tarballSha256: string;
  readonly integrity: string;
  readonly binary?: ManifestBinaryInfo;
}

export interface DistributionManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly version: string;
  readonly denoVersion?: string;
  readonly packages: readonly ManifestPackage[];
}

async function walkFiles(
  dir: string,
  base: string,
): Promise<readonly string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      const child = await walkFiles(full, `${base}/${entry.name}`);
      for (const c of child) out.push(c);
    } else {
      out.push(`${base}/${entry.name}`.replace(/^\/+/, ""));
    }
  }
  return out;
}

async function fileEntries(
  pkgDir: string,
  base: string,
): Promise<readonly ManifestFileEntry[]> {
  const rel = await walkFiles(pkgDir, base);
  const entries: ManifestFileEntry[] = [];
  for (const path of rel) {
    const relative = path.slice(base.length + 1);
    const stat = await statOf(`${pkgDir}/${relative}`);
    entries.push({ path: relative, size: stat.size });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

async function readPackageVersion(pkgDir: string): Promise<string> {
  const text = await readText(`${pkgDir}/package.json`);
  const parsed = JSON.parse(text) as { readonly version: string };
  return parsed.version;
}

export async function buildManifest(): Promise<DistributionManifest> {
  const packages: ManifestPackage[] = [];
  let denoVersion: string | undefined;

  const launcherDir = `${npmDir()}/book-title-lookup`;
  if (await exists(launcherDir)) {
    const version = await readPackageVersion(launcherDir);
    const tarball = tarballName("book-title-lookup", version);
    const files = await fileEntries(launcherDir, "book-title-lookup");
    packages.push({
      name: "book-title-lookup",
      kind: "launcher",
      version,
      files,
      tarball,
      tarballSha256: await sha256HexOfFile(
        tarballPath("book-title-lookup", version),
      ),
      integrity: await sha512IntegrityOfFile(
        tarballPath("book-title-lookup", version),
      ),
    });
  }

  for (const target of TARGETS) {
    const pkgDir = `${npmDir()}/${target.packageName}`;
    if (!(await exists(pkgDir))) continue;
    const version = await readPackageVersion(pkgDir);
    const tarball = tarballName(target.packageName, version);
    const files = await fileEntries(pkgDir, target.packageName);
    const binaryFile = `bin/${target.binaryFile}`;
    const staged = `${pkgDir}/${binaryFile}`;
    const stat = await statOf(staged);
    let binary: ManifestBinaryInfo = {
      file: binaryFile,
      denoTarget: target.denoTarget,
      size: stat.size,
      sha256: await sha256HexOfFile(staged),
      source: "stub",
    };
    const denoVersionFile = binaryDenoVersionPath(target.packageName);
    if (await exists(denoVersionFile)) {
      const raw = (await readText(denoVersionFile)).trim();
      binary = {
        ...binary,
        source: "compiled",
        denoVersion: raw.replace(/^deno\s*/, ""),
      };
      denoVersion = binary.denoVersion;
    }
    packages.push({
      name: target.packageName,
      kind: "platform",
      version,
      files,
      tarball,
      tarballSha256: await sha256HexOfFile(
        tarballPath(target.packageName, version),
      ),
      integrity: await sha512IntegrityOfFile(
        tarballPath(target.packageName, version),
      ),
      binary,
    });
  }

  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Version lockstep across every package present in this build wave.
  const versions = new Set(packages.map((p) => p.version));
  if (versions.size > 1) {
    throw new Error(
      `distribution: version lockstep violation across packages: ` +
        `${[...versions].join(", ")}`,
    );
  }
  const version = packages[0]?.version ?? PLACEHOLDER_VERSION;
  for (const p of packages) {
    if (p.version === PLACEHOLDER_VERSION) {
      throw new Error(
        `distribution: ${p.name} retained the placeholder version ` +
          `${PLACEHOLDER_VERSION}; pack.ts did not stamp it`,
      );
    }
  }
  for (const p of packages) {
    if (!(await exists(tarballPath(p.name, p.version)))) {
      throw new Error(`distribution: missing tarball for ${p.name}`);
    }
  }

  return { schema: MANIFEST_SCHEMA, version, denoVersion, packages };
}

function tarballName(name: string, version: string): string {
  return `${name}-${version}.tgz`;
}

/** Convenience helper for verify: the four platform package names. */
export function platformPackageNames(): readonly string[] {
  return TARGETS.map((t) => t.packageName);
}

async function entry(): Promise<number> {
  try {
    const manifest = await buildManifest();
    await writeText(manifestPath(), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote ${manifestPath()}`);
    console.log(`  version: ${manifest.version}`);
    for (const p of manifest.packages) {
      console.log(
        `  ${p.name}@${p.version} (${p.kind}, ${p.files.length} files, ` +
          (p.binary
            ? `${p.binary.source} ${p.binary.denoTarget})`
            : "launcher)"),
      );
    }
    return 0;
  } catch (error) {
    console.error(
      `distribution: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await entry());
}
