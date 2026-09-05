/**
 * Launcher process-contract tests (npm-release-topology.md sections 11.2 and
 * 11.4; fixtures/npm/README.md).
 *
 * These tests exercise the real Node launcher
 * (distribution/npm/launcher/bin/book-title.js) as a subprocess the way a
 * consumer would: the launcher is installed into a fabricated npm project
 * under `.tmp/` together with the matching host platform package, and its
 * compiled platform binary is produced on the current host with `deno compile`
 * from fixtures/npm/stub_binary.ts (no committed binary). We assert:
 *
 *   - CLI arguments reach the binary unchanged and the launcher never writes
 *     to stdout itself (11.2);
 *   - a synthetic application exit code (4) passes through unchanged (11.2);
 *   - child stderr is relayed to stderr and stdout stays empty (11.2);
 *   - an omitted optional platform dependency exits 70 with an actionable
 *     stderr message and no stdout (11.4);
 *   - an unsupported platform exits 70 with the same fallback contract (11.4),
 *     driven through a tiny driver that overrides the frozen platform table
 *     lookup because a supported host can never produce that miss by itself.
 *
 * Run via `deno task test:launcher` (needs `node` and `deno` on PATH).
 */

import {
  assertEquals,
  assertMatch,
  assert,
  fail,
} from "@std/assert";
import {
  copyFile,
  dirName,
  ensureDir,
  joinPath,
  readText,
  removeTree,
  repoRoot,
  runCommand,
  targetForHost,
  writeText,
} from "./_common.ts";

const LAUNCHER_SOURCE = joinPath(
  repoRoot(),
  "distribution",
  "npm",
  "launcher",
);
const STUB_SOURCE = joinPath(repoRoot(), "fixtures", "npm", "stub_binary.ts");

// ---------------------------------------------------------------------------
// Host platform resolution
// ---------------------------------------------------------------------------

/** Map Deno's build tokens to the launcher's Node platform/arch tokens. */
function hostNodePlatform(): string {
  return Deno.build.os === "windows" ? "win32" : Deno.build.os;
}

function hostNodeCpu(): string | undefined {
  if (Deno.build.arch === "x86_64") return "x64";
  if (Deno.build.arch === "aarch64" || Deno.build.arch === "arm64") {
    return "arm64";
  }
  return undefined;
}

/** The frozen host target the compiled stub binary stands in for, if any. */
function hostTarget() {
  const cpu = hostNodeCpu();
  if (cpu === undefined) return undefined;
  return targetForHost(hostNodePlatform(), cpu);
}

// ---------------------------------------------------------------------------
// Scratch + one-time host-native stub binary
// ---------------------------------------------------------------------------

const BIN_SCRATCH = joinPath(repoRoot(), ".tmp", "launcher-contract-bin");
let compiledBinary: string | null = null;

/** Compile fixtures/npm/stub_binary.ts for the current host, once. */
async function ensureCompiledBinary(): Promise<string> {
  if (compiledBinary !== null) return compiledBinary;
  const target = hostTarget();
  if (target === undefined) {
    fail(`distribution: host ${Deno.build.os}/${Deno.build.arch} is not a ` +
      "frozen launcher target; launcher contract tests cannot run here");
  }
  const out = joinPath(BIN_SCRATCH, target.binaryFile);
  await ensureDir(dirName(out));
  const result = await runCommand("deno", ["compile", "--output", out, STUB_SOURCE]);
  if (result.code !== 0) {
    fail(`distribution: deno compile stub failed (${result.code}):\n` +
      result.stderr);
  }
  compiledBinary = out;
  return out;
}

interface Project {
  readonly dir: string;
  readonly launcherBin: string;
  readonly platformPackageName: string;
}

let caseCounter = 0;

/**
 * Fabricate a clean npm install of the launcher (and, when `withPlatform` is
 * true, the matching host platform package exporting `binaryPath`) so the
 * real launcher file resolves the optional dependency through node_modules.
 */
async function makeProject(
  withPlatform: boolean,
): Promise<Project> {
  const target = hostTarget();
  if (target === undefined) {
    fail("no frozen host target for launcher contract tests");
  }
  const dir = joinPath(repoRoot(), ".tmp", "launcher-contract", `case-${caseCounter++}`);
  await removeTree(dir);
  await ensureDir(dir);

  const launcherDir = joinPath(dir, "node_modules", "book-title-lookup");
  const launcherBin = joinPath(launcherDir, "bin", "book-title.js");
  await copyFile(
    joinPath(LAUNCHER_SOURCE, "bin", "book-title.js"),
    launcherBin,
  );
  await writeText(
    joinPath(launcherDir, "package.json"),
    await readText(joinPath(LAUNCHER_SOURCE, "package.json")),
  );

  if (withPlatform) {
    const binaryPath = await ensureCompiledBinary();
    const pkgDir = joinPath(dir, "node_modules", target.packageName);
    await ensureDir(pkgDir);
    await writeText(
      joinPath(pkgDir, "package.json"),
      JSON.stringify({
        name: target.packageName,
        version: "1.2.3",
        type: "commonjs",
        main: "index.js",
        os: [target.os],
        cpu: [target.cpu],
      }, null, 2) + "\n",
    );
    // The platform package's index.js exports the compiled stub binary so the
    // launcher can spawn it exactly as it would a real distribution binary.
    await writeText(
      joinPath(pkgDir, "index.js"),
      `"use strict";\nmodule.exports = ${JSON.stringify(binaryPath)};\n`,
    );
  }

  return {
    dir,
    launcherBin,
    platformPackageName: target.packageName,
  };
}

/** Run the real launcher CLI file as a consumer would (`node bin/...`). */
function launch(
  project: Project,
  args: readonly string[],
) {
  return runCommand("node", [project.launcherBin, ...args], { cwd: project.dir });
}

/** Driver that forces the launcher's platform-table lookup to miss. */
const UNSUPPORTED_DRIVER = [
  '"use strict";',
  "// Unsupported-platform driver: a supported host can never make the frozen",
  "// launcher platform table miss, so this driver overrides the platform/arch",
  "// process tokens before running the launcher's real exported entry path.",
  "const launcher = require(process.argv[2]);",
  'Object.defineProperty(process, "platform", { value: "sunos" });',
  'Object.defineProperty(process, "arch", { value: "x64" });',
  "const outcome = launcher.run({ ...launcher.defaultDeps(), argv: [] });",
  "if (outcome.ok) {",
  "  launcher.spawnAndRelay(outcome.binaryPath, outcome.argv);",
  "} else {",
  '  process.stderr.write(launcher.distributionFailureMessage(outcome.failure) + "\\n");',
  "  process.exitCode = outcome.failure.code;",
  "}",
].join("\n");

Deno.test({
  name: "launcher/contract host is a frozen MVP target",
  fn: () => {
    const target = hostTarget();
    assert(target !== undefined, `host ${Deno.build.os}/${Deno.build.arch}`);
    assertEquals(target!.packageName, expectPlatformPackageName());
  },
});

function expectPlatformPackageName(): string {
  const os = hostNodePlatform();
  const cpu = hostNodeCpu();
  if (cpu === "arm64") return `book-title-lookup-${os}-arm64`;
  return `book-title-lookup-${os}-x64`;
}

Deno.test("launcher/contract argv reaches the binary unchanged, no own stdout", async () => {
  const project = await makeProject(true);
  try {
    const args = ["--json", "search", "--title", "百年孤独", "--limit", "5"];
    const run = await launch(project, args);
    assertEquals(run.code, 0, run.stderr);
    // The launcher writes nothing itself: stdout is exactly the child's echo.
    assertEquals(run.stdout, `stub-ok ${args.join(" ")}\n`);
    assertEquals(run.stderr, "");
  } finally {
    await removeTree(project.dir);
  }
});

Deno.test("launcher/contract a synthetic exit code 4 passes through unchanged", async () => {
  const project = await makeProject(true);
  try {
    const run = await launch(project, ["4"]);
    assertEquals(run.code, 4, run.stderr);
    assertEquals(run.stdout, "stub-ok 4\n");
    assertEquals(run.stderr, "");
  } finally {
    await removeTree(project.dir);
  }
});

Deno.test("launcher/contract child stderr is relayed and stdout stays empty", async () => {
  const project = await makeProject(true);
  try {
    const run = await launch(project, ["--stderr", "--json"]);
    assertEquals(run.code, 0, run.stderr);
    assertEquals(run.stdout, "");
    assertEquals(run.stderr, "stub-err --stderr --json\n");
  } finally {
    await removeTree(project.dir);
  }
});

Deno.test("launcher/contract omitted optional dep exits 70, actionable stderr, no stdout", async () => {
  const project = await makeProject(false);
  try {
    const run = await launch(project, []);
    assertEquals(run.code, 70, run.stderr);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /missing platform package/);
    assertMatch(run.stderr, /without --omit=optional/);
    assertMatch(run.stderr, /Supported platforms: win32\/x64, linux\/x64/);
  } finally {
    await removeTree(project.dir);
  }
});

Deno.test("launcher/contract unsupported platform exits 70, actionable stderr, no stdout", async () => {
  const project = await makeProject(false);
  try {
    const driver = joinPath(project.dir, "unsupported_driver.cjs");
    await writeText(driver, UNSUPPORTED_DRIVER);
    const run = await runCommand("node", [driver, project.launcherBin], {
      cwd: project.dir,
    });
    assertEquals(run.code, 70, run.stderr);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /unsupported platform sunos\/x64/);
    assertMatch(run.stderr, /without --omit=optional/);
    assertMatch(run.stderr, /Supported platforms:/);
  } finally {
    await removeTree(project.dir);
  }
});
