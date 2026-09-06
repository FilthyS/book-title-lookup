/**
 * Shared helpers for cache fixture tests. Real-filesystem tests run beneath a
 * git-ignored `.tmp/cache-tests` directory inside the workspace so the suite
 * needs no ambient write grants outside the repository tree.
 */

import { mkdir, rm } from "node:fs/promises";
import {
  canonicalPath,
  joinPath,
  styleFromPlatform,
} from "../platform/paths.ts";
import { detectPlatformKind, type PlatformKind } from "../platform/platform.ts";
import { systemRandomSource } from "./random.ts";
import type { FileSystemSeam } from "./fs-seam.ts";

export function hostPlatform(): PlatformKind {
  return detectPlatformKind(process.platform);
}

export function hostStyle(): "posix" | "windows" {
  return styleFromPlatform(hostPlatform());
}

export function testBaseDir(): string {
  return joinPath(hostStyle(), process.cwd(), ".tmp", "cache-tests");
}

export async function freshTestDir(label: string): Promise<string> {
  const base = testBaseDir();
  await mkdir(base, { recursive: true });
  const dir = canonicalPath(
    joinPath(
      hostStyle(),
      base,
      `${label}-${Date.now()}-${systemRandomSource.hex(4)}`,
    ),
    hostStyle(),
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeTestDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true });
  } catch {
    // Ignore cleanup failures; .tmp is git-ignored and removed next run.
  }
}

/** List bare file/dir names beneath an absolute path using the seam. */
export async function listNames(
  fs: FileSystemSeam,
  path: string,
): Promise<string[]> {
  const result = await fs.listDirectory(path);
  if (!result.ok) throw new Error(`listDirectory failed: ${result.error}`);
  return result.names;
}

export async function readFileText(
  fs: FileSystemSeam,
  path: string,
): Promise<string> {
  const result = await fs.readTextFile(path);
  if (!result.ok) throw new Error(`readTextFile failed: ${result.error}`);
  return result.text;
}
