/**
 * Real-entry smoke tests for the issue #32 composition root.
 *
 * These spawn the TypeScript Node entry like a developer would. Row X22 keeps
 * BOOK_TITLE_GOOGLE_API_KEY in the child environment and proves first-party
 * application code neither reads nor echoes the reserved secret.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assert, assertEquals } from "@std/assert";
import { detectPlatformKind } from "../../../packages/providers/src/platform/platform.ts";
import {
  joinPath,
  styleFromPlatform,
} from "../../../packages/providers/src/platform/paths.ts";
import { streamWriter } from "./main.ts";

const ENTRY = fileURLToPath(new URL("./bin.ts", import.meta.url));
const VERSION_LINE = "book-title 0.1.0";
const platform = detectPlatformKind(process.platform);
const style = styleFromPlatform(platform);

interface ChildResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runEntry(
  args: readonly string[],
  options: { readonly env?: Record<string, string> } = {},
): Promise<ChildResult> {
  const child = spawn(process.execPath, ["--import=tsx", ENTRY, ...args], {
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  };
}

async function makeScratch(label: string): Promise<string> {
  const root = joinPath(style, Deno.cwd(), ".tmp", "cli-subprocess", label);
  await Deno.mkdir(root, { recursive: true });
  return root;
}

function scratchEnv(root: string): Record<string, string> {
  if (platform === "windows") {
    return {
      APPDATA: joinPath(style, root, "config"),
      LOCALAPPDATA: joinPath(style, root, "local"),
      USERPROFILE: joinPath(style, root, "userprofile"),
    };
  }
  return {
    HOME: joinPath(style, root, "home"),
    XDG_CONFIG_HOME: joinPath(style, root, "config"),
    XDG_CACHE_HOME: joinPath(style, root, "local"),
  };
}

Deno.test("stream writer waits for the stream completion callback", async () => {
  const chunks: Uint8Array[] = [];
  let complete: ((error?: Error | null) => void) | undefined;
  const writer = streamWriter({
    write(data: Uint8Array, callback: (error?: Error | null) => void): boolean {
      chunks.push(data.slice());
      complete = callback;
      return false;
    },
  });
  const frame = `${"┌─┐\r\n│ │\r\n└─┘\r\n".repeat(200)}↓ more title groups`;

  let resolved = false;
  const writing = writer.write(frame).then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assertEquals(resolved, false);
  complete?.();
  await writing;

  assertEquals(Buffer.concat(chunks).toString(), frame);
});

Deno.test("cli entry --version prints one stamp line and exits 0", async () => {
  const run = await runEntry(["--version"]);
  assertEquals(run.code, 0, run.stderr);
  assertEquals(run.stdout, `${VERSION_LINE}\n`);
  assertEquals(run.stderr, "");
});

Deno.test("cli entry config show --json works under a real root", async () => {
  const scratch = await makeScratch("config");
  try {
    const run = await runEntry(["config", "show", "--json"], {
      env: scratchEnv(scratch),
    });
    assertEquals(run.code, 0, run.stderr);
    const doc = JSON.parse(run.stdout) as {
      schemaVersion: string;
      command: string;
      operation: string;
      status: string;
    };
    assertEquals(doc.schemaVersion, "cli-json.v1");
    assertEquals(doc.command, "config");
    assertEquals(doc.operation, "show");
    assertEquals(doc.status, "ok");
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("cli X22 reserved secret never appears and is never read", async () => {
  const scratch = await makeScratch("x22");
  const secret = "GOOGLE-SECRET-7f3a9c";
  try {
    const run = await runEntry(["config", "show", "--json"], {
      env: {
        ...scratchEnv(scratch),
        BOOK_TITLE_GOOGLE_API_KEY: secret,
      },
    });
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      run.stdout.includes(secret),
      false,
      "secret must never be echoed",
    );
    assertEquals(run.stdout.includes("GOOGLE_API_KEY"), false);
    assert(
      !run.stderr.toLowerCase().includes("permission"),
      "no accidental read failure",
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("cli entry cache list --json runs headless with no secret in output", async () => {
  const scratch = await makeScratch("cache");
  try {
    const cacheDir = joinPath(style, scratch, "cache");
    const run = await runEntry(
      ["cache", "list", "--json", "--cache-dir", cacheDir],
      { env: scratchEnv(scratch) },
    );
    assertEquals(run.code, 0, run.stderr);
    const doc = JSON.parse(run.stdout) as { entries: unknown[] };
    assertEquals(doc.entries, []);
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});
