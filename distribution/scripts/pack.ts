/**
 * npm package-tree generation and `npm pack` (ticket #20 / section 6.6).
 *
 * Reads the distribution/npm templates, stamps each package.json copy with
 * the single resolved release version (never `0.0.0`, never a divergent
 * version), places the compiled binary (or, with `--stubs`, a committed
 * fixture stub) into each platform tree, and runs `npm pack` to produce local
 * tarballs under dist/tarballs. It never publishes: no token, no `npm
 * publish`, no credentials. The dry-run/tarball gates (npm-release-topology.md
 * section 11.1) are enforced by manifest.ts and verify.ts.
 *
 * Usage:
 *   deno run --allow-run=deno,npm --allow-read --allow-write \
 *     distribution/scripts/pack.ts [--version <v>] [--stubs] [--dry-run]
 *
 * Options:
 *   --version <v>   explicit release version override (default: env/tag/default)
 *   --stubs         fill missing platform binaries from fixtures/npm (source
 *                   and single-host dry-runs; never shipped)
 *   --dry-run       no publishing intent; still produces local tarballs for
 *                   inspection
 */

import {
  binaryPath,
  copyFile,
  ensureDir,
  exists,
  joinPath,
  npmDir,
  npmPackageDir,
  readText,
  removeTree,
  repoRoot,
  runCommand,
  tarballsDir,
  TARGETS,
  writeText,
} from "./_common.ts";
import { launcherPackageJson, platformPackageJson } from "./_package.ts";
import { resolveReleaseVersion } from "./version.ts";

const LAUNCHER_SOURCE = "distribution/npm/launcher";
const PLATFORM_TEMPLATE_SOURCE = "distribution/npm/platform-package";
const FIXTURES_NPM = "fixtures/npm";

const BINARY_TOKEN = "__BINARY_FILE__";

function parseArgs(argv: readonly string[]): {
  readonly version?: string;
  readonly stubs: boolean;
  readonly dryRun: boolean;
} {
  let version: string | undefined;
  const versionIndex = argv.indexOf("--version");
  if (versionIndex !== -1) version = argv[versionIndex + 1];
  return {
    version,
    stubs: argv.includes("--stubs"),
    dryRun: argv.includes("--dry-run"),
  };
}

interface BinaryChoice {
  readonly target: (typeof TARGETS)[number];
  readonly kind: "compiled" | "stub";
  readonly source: string;
}

export async function chooseBinaries(
  useStubs: boolean,
): Promise<
  {
    readonly chosen: readonly BinaryChoice[];
    readonly missing: readonly string[];
  }
> {
  const chosen: BinaryChoice[] = [];
  const missing: string[] = [];
  for (const target of TARGETS) {
    const compiled = binaryPath(target.packageName, target.binaryFile);
    if (await exists(compiled)) {
      chosen.push({ target, kind: "compiled", source: compiled });
      continue;
    }
    if (useStubs) {
      const stub = joinPath(
        repoRoot(),
        FIXTURES_NPM,
        target.packageName,
        "bin",
        target.binaryFile,
      );
      chosen.push({ target, kind: "stub", source: stub });
      continue;
    }
    missing.push(target.packageName);
  }
  return { chosen, missing };
}

async function makeExecutableIfPosix(file: string): Promise<void> {
  if (Deno.build.os !== "windows") {
    try {
      await Deno.chmod(file, 0o755);
    } catch {
      // Modes are advisory on some filesystems; never fail a build over this.
    }
  }
}

async function buildLauncherTree(version: string): Promise<string> {
  const dir = npmPackageDir(launcherPackageNameOf());
  await removeTree(dir);
  await copyFile(
    joinPath(repoRoot(), LAUNCHER_SOURCE, "bin", "book-title.js"),
    joinPath(dir, "bin", "book-title.js"),
  );
  await makeExecutableIfPosix(joinPath(dir, "bin", "book-title.js"));
  const seed = launcherPackageJson(version);
  await writeText(
    joinPath(dir, "package.json"),
    JSON.stringify(seed, null, 2) + "\n",
  );
  return dir;
}

async function buildPlatformTree(
  choice: BinaryChoice,
  version: string,
): Promise<string> {
  const { target } = choice;
  const dir = npmPackageDir(target.packageName);
  await removeTree(dir);
  const templateIndex = await readText(
    joinPath(repoRoot(), PLATFORM_TEMPLATE_SOURCE, "index.js"),
  );
  await writeText(
    joinPath(dir, "index.js"),
    templateIndex.split(BINARY_TOKEN).join(target.binaryFile),
  );
  const seed = platformPackageJson(target, version);
  await writeText(
    joinPath(dir, "package.json"),
    JSON.stringify(seed, null, 2) + "\n",
  );
  const binaryTarget = joinPath(dir, "bin", target.binaryFile);
  await copyFile(choice.source, binaryTarget);
  await makeExecutableIfPosix(binaryTarget);
  return dir;
}

async function packTree(pkgDir: string): Promise<void> {
  await ensureDir(tarballsDir());
  const result = await runCommand("npm", [
    "pack",
    "--json",
    "--pack-destination",
    tarballsDir(),
  ], { cwd: pkgDir });
  if (result.code !== 0) {
    throw new Error(`npm pack failed in ${pkgDir}:\n${result.stderr}`);
  }
}

function launcherPackageNameOf(): string {
  return launcherPackageJson("0.0.0").name;
}

async function entry(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  try {
    const resolved = await resolveReleaseVersion({
      env: options.version === undefined
        ? undefined
        : (name) =>
          name === "BOOK_TITLE_RELEASE_VERSION" ? options.version : undefined,
      readTag: options.version === undefined
        ? undefined
        : () => Promise.resolve(null),
    });
    const { chosen, missing } = await chooseBinaries(options.stubs);
    if (missing.length > 0 && !options.stubs) {
      throw new Error(
        `missing compiled binaries for: ${missing.join(", ")}\n` +
          `run compile.ts for each target, or add --stubs for a source dry-run`,
      );
    }

    await removeTree(npmDir());
    await removeTree(tarballsDir());

    const launcherDir = await buildLauncherTree(resolved.version);
    const platforms = await Promise.all(
      chosen.map((choice) =>
        buildPlatformTree(choice, resolved.version).then((dir) => ({
          choice,
          dir,
        }))
      ),
    );

    await packTree(launcherDir);
    for (const { dir } of platforms) await packTree(dir);

    console.log(
      `packed launcher + ${platforms.length} platform package(s) ` +
        `at version ${resolved.version} (source: ${resolved.source})`,
    );
    for (const { choice } of platforms) {
      console.log(`  ${choice.target.packageName} <- ${choice.kind}`);
    }
    console.log(
      "mode:",
      options.dryRun ? "dry-run (no publish)" : "local pack",
    );
    return 0;
  } catch (error) {
    console.error(
      `distribution: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await entry(Deno.args));
}
