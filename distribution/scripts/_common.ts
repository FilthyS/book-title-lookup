/**
 * Shared constants and file utilities for the distribution scripts (ticket
 * #20 / section 6.6).
 *
 * This module is not part of a Deno workspace member; the build scripts and
 * their tests import it directly. It owns the frozen target matrix from
 * docs/design/npm-release-topology.md section 4, the derivation of
 * `deno compile` permission flags from the closed allowlist constants
 * (issue #5 D7/D9, docs/research/deno-persistence-and-permissions.md), and
 * the `dist/` output layout. Nothing in here publishes to npm.
 */

import { ENV_ALLOWLIST } from "../../packages/providers/src/platform/env.ts";
import { OL_HOSTS } from "../../packages/providers/src/openlibrary/config.ts";
import { WD_HOSTS } from "../../packages/providers/src/wikidata/config.ts";

/** Frozen launcher package name (docs/design/npm-release-topology.md 3.1). */
export const LAUNCHER_NAME = "book-title-lookup";

/** Frozen platform package name rule: `<launcher>-<os>-<cpu>`. */
export function platformPackageName(os: string, cpu: string): string {
  return `${LAUNCHER_NAME}-${os}-${cpu}`;
}

export interface TargetInfo {
  /** Exact `deno compile --target` token. */
  readonly denoTarget: string;
  /** Node `process.platform` token (win32 | linux | darwin). */
  readonly os: string;
  /** Node `process.arch` token (x64 | arm64). */
  readonly cpu: string;
  /** npm platform package name. */
  readonly packageName: string;
  /** File name of the compiled binary under `bin/`. */
  readonly binaryFile: string;
  /** Human description for docs and the manifest. */
  readonly description: string;
  /** GitHub Actions runner label expectation for native smoke. */
  readonly runner: string;
}

/**
 * The four frozen MVP targets (npm-release-topology.md section 4). Do not add
 * musl, linux-arm64, or Windows ARM64 here: they are out of MVP scope.
 */
export const TARGETS: readonly TargetInfo[] = [
  {
    denoTarget: "x86_64-pc-windows-msvc",
    os: "win32",
    cpu: "x64",
    packageName: platformPackageName("win32", "x64"),
    binaryFile: "book-title.exe",
    description: "win32/x64",
    runner: "windows-latest",
  },
  {
    denoTarget: "x86_64-unknown-linux-gnu",
    os: "linux",
    cpu: "x64",
    packageName: platformPackageName("linux", "x64"),
    binaryFile: "book-title",
    description: "linux/x64 (glibc)",
    runner: "ubuntu-latest",
  },
  {
    denoTarget: "x86_64-apple-darwin",
    os: "darwin",
    cpu: "x64",
    packageName: platformPackageName("darwin", "x64"),
    binaryFile: "book-title",
    description: "darwin/x64",
    runner: "macos-13",
  },
  {
    denoTarget: "aarch64-apple-darwin",
    os: "darwin",
    cpu: "arm64",
    packageName: platformPackageName("darwin", "arm64"),
    binaryFile: "book-title",
    description: "darwin/arm64",
    runner: "macos-14",
  },
] as const;

export function targetByDenoTarget(denoTarget: string): TargetInfo | undefined {
  return TARGETS.find((t) => t.denoTarget === denoTarget);
}

export function targetForHost(
  os: string,
  cpu: string,
): TargetInfo | undefined {
  return TARGETS.find((t) => t.os === os && t.cpu === cpu);
}

/** Exact union of the catalog network hosts compiled artifacts may reach. */
export function networkHosts(): readonly string[] {
  const set = new Set<string>([...OL_HOSTS, ...WD_HOSTS]);
  return [...set];
}

/**
 * Build the `deno compile` permission flags from the closed allowlist
 * constants. Environment is exactly the ENV_ALLOWLIST union; network is
 * exactly the catalog hosts. Filesystem read/write is baked broadly because a
 * prebuilt binary cannot express a runtime-computed per-user directory grant
 * (issue #5 D9 option b) — the application's sealed seam constrains real
 * writes — but `-A` is never used and environment/network stay narrow.
 */
export function compileFlags(): readonly string[] {
  const env = [...ENV_ALLOWLIST].join(",");
  const net = networkHosts().join(",");
  return [
    `--allow-env=${env}`,
    `--allow-net=${net}`,
    "--allow-read",
    "--allow-write",
  ];
}

// ---------------------------------------------------------------------------
// Path helpers (forward-slash on every host so scripts are Windows-safe).
// ---------------------------------------------------------------------------

function slashed(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Absolute repository root as a forward-slash path (no trailing slash). */
export function repoRoot(): string {
  return slashed(fromFileUrl(new URL("../../", import.meta.url)))
    .replace(/\/+$/, "");
}

export function distRoot(): string {
  return joinPath(repoRoot(), "dist");
}

export function joinPath(...parts: readonly string[]): string {
  return parts.filter((p) => p !== "").join("/").replace(/\/+/g, "/");
}

export function dirName(file: string): string {
  const idx = file.lastIndexOf("/");
  return idx === -1 ? "." : file.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Output layout under dist/ (gitignored; never a source member).
// ---------------------------------------------------------------------------

export function binariesDir(): string {
  return joinPath(distRoot(), "binaries");
}

export function binaryPath(packageName: string, binaryFile: string): string {
  return joinPath(binariesDir(), packageName, binaryFile);
}

export function binaryDenoVersionPath(packageName: string): string {
  return joinPath(binariesDir(), packageName, ".deno-version");
}

export function npmDir(): string {
  return joinPath(distRoot(), "npm");
}

export function npmPackageDir(packageName: string): string {
  return joinPath(npmDir(), packageName);
}

export function tarballsDir(): string {
  return joinPath(distRoot(), "tarballs");
}

export function tarballPath(packageName: string, version: string): string {
  return joinPath(tarballsDir(), `${packageName}-${version}.tgz`);
}

export function manifestPath(): string {
  return joinPath(distRoot(), "manifest.json");
}

// ---------------------------------------------------------------------------
// Filesystem helpers (call time only, so importing is side-effect free).
// ---------------------------------------------------------------------------

export async function readText(file: string): Promise<string> {
  return await Deno.readTextFile(file);
}

export async function writeText(file: string, text: string): Promise<void> {
  await Deno.mkdir(dirName(file), { recursive: true });
  await Deno.writeTextFile(file, text);
}

export async function copyFile(source: string, target: string): Promise<void> {
  await Deno.mkdir(dirName(target), { recursive: true });
  await Deno.copyFile(source, target);
}

export async function exists(file: string): Promise<boolean> {
  try {
    await Deno.stat(file);
    return true;
  } catch {
    return false;
  }
}

export async function statOf(file: string): Promise<Deno.FileInfo> {
  return await Deno.stat(file);
}

export async function ensureDir(file: string): Promise<void> {
  await Deno.mkdir(file, { recursive: true });
}

export async function removeTree(file: string): Promise<void> {
  try {
    await Deno.remove(file, { recursive: true });
  } catch {
    // The path may not exist; removal is best-effort cleanup.
  }
}

// ---------------------------------------------------------------------------
// Subprocess + digest helpers.
// ---------------------------------------------------------------------------

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<CommandResult> {
  const process = new Deno.Command(command, {
    args: [...args],
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await process.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function digestBytes(
  algorithm: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest(algorithm, buffer);
  return new Uint8Array(digest);
}

/** Lowercase hex SHA-256 of a file (artifact manifest tarball hash). */
export async function sha256HexOfFile(file: string): Promise<string> {
  const data = await Deno.readFile(file);
  const digest = await digestBytes("SHA-256", data);
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 SHA-512 in npm `integrity` form (`sha512-<base64>`). */
export async function sha512IntegrityOfFile(file: string): Promise<string> {
  const data = await Deno.readFile(file);
  const digest = await digestBytes("SHA-512", data);
  let binary = "";
  for (const b of digest) binary += String.fromCharCode(b);
  return `sha512-${btoa(binary)}`;
}

function fromFileUrl(url: URL): string {
  const decoded = decodeURIComponent(url.pathname);
  if (Deno.build.os === "windows") {
    // A file:// URL on Windows is file:///C:/...; strip the leading slash.
    return decoded.startsWith("/") ? decoded.slice(1) : decoded;
  }
  return decoded;
}

export function isValidTarget(denoTarget: string): boolean {
  return targetByDenoTarget(denoTarget) !== undefined;
}
