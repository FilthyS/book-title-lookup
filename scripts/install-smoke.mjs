import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const npmCli = process.env.npm_execpath;
if (npmCli === undefined) {
  throw new Error("install smoke must run through npm");
}

function npm(args, options = {}) {
  return spawnSync(process.execPath, [npmCli, ...args], {
    encoding: "utf8",
    ...options,
  });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}:\n${result.error?.message ?? result.stderr}`,
    );
  }
}

function runCli(installRoot, args) {
  return npm([
    "exec",
    "--offline",
    "--prefix",
    installRoot,
    "--",
    "book-title",
    ...args,
  ]);
}

const installRoot = await mkdtemp(join(tmpdir(), "book-title-install-"));
let tarball;
try {
  const packed = npm(["pack", "--json"]);
  requireSuccess("npm pack", packed);
  const report = JSON.parse(packed.stdout)[0];
  tarball = resolve(report.filename);

  const installed = npm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    installRoot,
    tarball,
  ]);
  requireSuccess("npm install", installed);

  const version = runCli(installRoot, ["--version"]);
  requireSuccess("installed CLI --version", version);
  const expectedVersion = `book-title ${packageJson.version}`;
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(
      `installed CLI reported ${JSON.stringify(version.stdout.trim())}; expected ${JSON.stringify(expectedVersion)}`,
    );
  }

  const help = runCli(installRoot, ["--help"]);
  requireSuccess("installed CLI --help", help);
  if (!help.stdout.includes("Usage:")) {
    throw new Error("installed CLI --help did not print usage");
  }

  const noCommand = runCli(installRoot, []);
  if (noCommand.status !== 2) {
    throw new Error(
      `installed CLI without a TTY exited ${noCommand.status}; expected 2`,
    );
  }

  console.log(
    `installed and exercised ${packageJson.name}@${packageJson.version} from ${report.filename}`,
  );
} finally {
  await rm(installRoot, { recursive: true, force: true });
  if (tarball !== undefined) {
    await rm(tarball, { force: true });
  }
}
