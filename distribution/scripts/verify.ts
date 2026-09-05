/**
 * Post-build verification gates (ticket #20 / section 6.6, product gate G11,
 * npm-release-topology.md sections 7 and 11.1).
 *
 * Reads dist/manifest.json and re-checks, per package: the current
 * `npm pack --dry-run` file list matches both the manifest and the expected
 * frozen file set; no lockfile/cache/secret/source file is packed; the
 * tarball digest and integrity match the manifest; version lockstep holds;
 * and (on POSIX) the launcher carries a shebang and the Linux/macOS binaries
 * carry the executable bit. It also asserts the compiled permission surface
 * is derived from the closed allowlist constants (never `-A`).
 *
 * This script never publishes and never needs a token.
 *
 * Usage:
 *   deno run --allow-run=npm --allow-read --allow-write \
 *     distribution/scripts/verify.ts [--allow-partial]
 */

import {
  compileFlags,
  exists,
  joinPath,
  manifestPath,
  networkHosts,
  npmPackageDir,
  readText,
  runCommand,
  sha256HexOfFile,
  tarballPath,
  TARGETS,
} from "./_common.ts";
import {
  checkFileList,
  launcherExpectedFiles,
  platformExpectedFiles,
} from "./_package.ts";
import type { DistributionManifest, ManifestPackage } from "./manifest.ts";
import { ENV_ALLOWLIST } from "../../packages/providers/src/platform/env.ts";
import { OL_HOSTS } from "../../packages/providers/src/openlibrary/config.ts";
import { WD_HOSTS } from "../../packages/providers/src/wikidata/config.ts";

interface PackedFile {
  readonly path: string;
  readonly size: number;
}

async function readManifest(): Promise<DistributionManifest> {
  const text = await readText(manifestPath());
  return JSON.parse(text) as DistributionManifest;
}

/** Parse the JSON file list from `npm pack --json`/`--dry-run --json`. */
export function parsePackFileList(stdout: string): PackedFile[] {
  const text = stdout.trim();
  const open = text.indexOf("[");
  const json = open === -1 ? text : text.slice(open);
  const data = JSON.parse(json) as Array<
    { readonly files?: readonly unknown[] }
  >;
  const first = data[0];
  const files = first?.files ?? [];
  const out: PackedFile[] = [];
  for (const raw of files) {
    const entry = raw as { readonly path?: string; readonly size?: number };
    if (typeof entry.path !== "string") continue;
    const path = entry.path.replace(/^package\//, "");
    out.push({ path, size: entry.size ?? 0 });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function expectedFor(pkg: ManifestPackage): readonly string[] {
  const target = TARGETS.find((t) => t.packageName === pkg.name);
  return target === undefined
    ? launcherExpectedFiles()
    : platformExpectedFiles(target);
}

function checkPermissionDerivation(messages: string[]): void {
  const flags = compileFlags();
  if (flags.some((f) => f === "-A" || f === "--allow-all")) {
    messages.push("compile flags must never use -A / --allow-all");
  }
  const envFlag = flags.find((f) => f.startsWith("--allow-env="));
  const envGranted = envFlag === undefined
    ? []
    : envFlag.slice("--allow-env=".length).split(",").filter((n) => n !== "");
  const envExpected = [...ENV_ALLOWLIST].sort();
  const envSorted = [...envGranted].sort();
  if (JSON.stringify(envSorted) !== JSON.stringify(envExpected)) {
    messages.push("compile env grants do not match the ENV_ALLOWLIST union");
  }
  const netFlag = flags.find((f) => f.startsWith("--allow-net="));
  const netGranted = netFlag === undefined
    ? []
    : netFlag.slice("--allow-net=".length).split(",").filter((h) => h !== "");
  const hosts = [...new Set([...OL_HOSTS, ...WD_HOSTS])].sort();
  const netSorted = [...netGranted].sort();
  if (JSON.stringify(netSorted) !== JSON.stringify(hosts)) {
    messages.push("compile network grants do not match the catalog hosts");
  }
}

async function checkModesAndShebang(
  pkg: ManifestPackage,
  messages: string[],
): Promise<void> {
  const dir = npmPackageDir(pkg.name);
  if (pkg.kind === "launcher") {
    const launcherFile = joinPath(dir, "bin", "book-title.js");
    const text = await readText(launcherFile);
    if (!text.startsWith("#!")) {
      messages.push(`${pkg.name}: launcher has no shebang`);
    }
    if (Deno.build.os !== "windows") {
      const stat = await Deno.stat(launcherFile);
      if (((stat.mode ?? 0) & 0o111) === 0) {
        messages.push(`${pkg.name}: launcher is not executable`);
      }
    }
    return;
  }
  const target = TARGETS.find((t) => t.packageName === pkg.name);
  if (target === undefined || Deno.build.os === "windows") return;
  if (target.os === "windows") return;
  const binaryFile = joinPath(dir, "bin", target.binaryFile);
  const stat = await Deno.stat(binaryFile);
  if (((stat.mode ?? 0) & 0o111) === 0) {
    messages.push(`${pkg.name}: binary is not executable`);
  }
}

async function verifyTarball(
  pkg: ManifestPackage,
  messages: string[],
): Promise<void> {
  const path = tarballPath(pkg.name, pkg.version);
  if (!(await exists(path))) {
    messages.push(`${pkg.name}: tarball missing ${path}`);
    return;
  }
  const actual = await sha256HexOfFile(path);
  if (actual !== pkg.tarballSha256) {
    messages.push(`${pkg.name}: tarball SHA-256 drift from manifest`);
  }
}

async function entry(argv: readonly string[]): Promise<number> {
  const allowPartial = argv.includes("--allow-partial");
  try {
    const manifest = await readManifest();
    const messages: string[] = [];

    if (manifest.version === undefined || manifest.version === "") {
      messages.push("manifest has no version");
    }

    const names = new Set(manifest.packages.map((p) => p.name));
    if (!allowPartial) {
      const required = [
        "book-title-lookup",
        ...TARGETS.map((t) => t.packageName),
      ];
      for (const name of required) {
        if (!names.has(name)) {
          messages.push(`release-shaped manifest incomplete: missing ${name}`);
        }
      }
    }

    // Version lockstep across the wave.
    const versions = new Set(manifest.packages.map((p) => p.version));
    if (versions.size !== 1) {
      messages.push(`version lockstep violated: ${[...versions].join(", ")}`);
    }

    checkPermissionDerivation(messages);

    for (const pkg of manifest.packages) {
      const dir = npmPackageDir(pkg.name);
      const result = await runCommand(
        "npm",
        ["pack", "--dry-run", "--json"],
        { cwd: dir },
      );
      if (result.code !== 0) {
        messages.push(
          `${pkg.name}: npm pack --dry-run failed:\n${result.stderr}`,
        );
        continue;
      }
      const packed = parsePackFileList(result.stdout).map((f) => f.path);
      const expected = expectedFor(pkg);
      const listCheck = checkFileList(packed, expected);
      for (const m of listCheck.messages) messages.push(`${pkg.name}: ${m}`);

      const manifestPaths = pkg.files.map((f) => f.path).sort();
      const packedSorted = [...packed].sort();
      if (JSON.stringify(packedSorted) !== JSON.stringify(manifestPaths)) {
        messages.push(
          `${pkg.name}: npm pack file list differs from manifest file list`,
        );
      }

      await verifyTarball(pkg, messages);
      await checkModesAndShebang(pkg, messages);
    }

    if (messages.length > 0) {
      for (const m of messages) console.error(`- ${m}`);
      console.error(
        `verify failed with ${messages.length} problem(s); ` +
          `manifest packages: ${manifest.packages.length}`,
      );
      return 1;
    }
    console.log(
      `verify ok: ${manifest.packages.length} package(s) at ` +
        `${manifest.version}${
          manifest.denoVersion ? ` (deno ${manifest.denoVersion})` : ""
        }`,
    );
    return 0;
  } catch (error) {
    console.error(
      `distribution: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

// Re-export network derivation for the unit test that checks metadata.
export function compiledNetworkHosts(): readonly string[] {
  return networkHosts();
}

if (import.meta.main) {
  Deno.exit(await entry(Deno.args));
}
