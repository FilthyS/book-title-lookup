/**
 * `deno compile` build script for the frozen target matrix (ticket #20 /
 * section 6.6, npm-release-topology.md section 4, product gate G10).
 *
 * Compiles apps/tui/src/main.ts into a self-contained binary under
 * `dist/binaries/<platform-package>/<binary-file>`, baking only the narrow
 * permission surface derived from the closed allowlist constants (never
 * `-A`): the ENV_ALLOWLIST union, the exact catalog network hosts, and
 * broad read/write for the runtime-computed per-user config/cache directories
 * that a prebuilt binary cannot express as static path grants (issue #5 D9
 * option b; the sealed seam constrains real writes).
 *
 * This script only builds; it never publishes and holds no credentials.
 *
 * Usage:
 *   deno run --allow-run=deno --allow-read --allow-write \
 *     distribution/scripts/compile.ts [--target <deno-target>]
 */

import {
  binaryDenoVersionPath,
  binaryPath,
  compileFlags,
  ensureDir,
  joinPath,
  repoRoot,
  runCommand,
  targetByDenoTarget,
  targetForHost,
  type TargetInfo,
  writeText,
} from "./_common.ts";

const MAIN_ENTRY = "apps/tui/src/main.ts";

export function archToCpu(arch: string): string | undefined {
  if (arch === "x86_64") return "x64";
  if (arch === "aarch64" || arch === "arm64") return "arm64";
  return undefined;
}

export function hostTarget(): TargetInfo | undefined {
  const cpu = archToCpu(Deno.build.arch);
  if (cpu === undefined) return undefined;
  return targetForHost(Deno.build.os, cpu);
}

function parseArgs(argv: readonly string[]): {
  readonly denoTarget: string;
} {
  const targetIndex = argv.indexOf("--target");
  const requested = targetIndex === -1 ? undefined : argv[targetIndex + 1];
  if (requested !== undefined) return { denoTarget: requested };
  const host = hostTarget();
  if (host === undefined) {
    throw new Error(
      `distribution: current host ${Deno.build.os}/${Deno.build.arch} is not ` +
        `an MVP target; pass --target explicitly`,
    );
  }
  return { denoTarget: host.denoTarget };
}

export async function compileTarget(denoTarget: string): Promise<TargetInfo> {
  const target = targetByDenoTarget(denoTarget);
  if (target === undefined) {
    const supported = TARGETS_DOC;
    throw new Error(
      `distribution: unsupported deno compile target ${denoTarget}; ` +
        `supported: ${supported}`,
    );
  }
  const output = binaryPath(target.packageName, target.binaryFile);
  await ensureDir(joinPath(output, ".."));
  const flags = compileFlags();
  const result = await runCommand(
    "deno",
    [
      "compile",
      "--target",
      target.denoTarget,
      ...flags,
      "--output",
      output,
      MAIN_ENTRY,
    ],
    { cwd: repoRoot() },
  );
  if (result.code !== 0) {
    throw new Error(
      `distribution: deno compile ${target.denoTarget} failed (${result.code}):\n` +
        result.stderr,
    );
  }
  await writeText(
    binaryDenoVersionPath(target.packageName),
    `deno ${Deno.version.deno}`,
  );
  return target;
}

const TARGETS_DOC =
  "x86_64-pc-windows-msvc, x86_64-unknown-linux-gnu, x86_64-apple-darwin, aarch64-apple-darwin";

export function supportedTargetsDoc(): string {
  return TARGETS_DOC;
}

async function entry(argv: readonly string[]): Promise<number> {
  try {
    const { denoTarget } = parseArgs(argv);
    const target = await compileTarget(denoTarget);
    console.log(
      `compiled ${target.packageName} (${target.denoTarget}) -> ` +
        binaryPath(target.packageName, target.binaryFile),
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
