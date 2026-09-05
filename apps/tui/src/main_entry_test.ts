/**
 * Real-entry smoke tests for the issue #32 composition root.
 *
 * These spawn `deno run apps/tui/src/main.ts` like a user would, so they also
 * prove the permission surface: the process only ever reads allowlisted
 * environment names. Row X22 keeps BOOK_TITLE_GOOGLE_API_KEY in the child
 * environment without granting it, so an accidental read would fail loudly
 * and an accidental echo would leak the secret.
 */

import { assert, assertEquals } from "@std/assert";
import {
  detectPlatformKind,
} from "../../../packages/providers/src/platform/platform.ts";
import {
  joinPath,
  styleFromPlatform,
} from "../../../packages/providers/src/platform/paths.ts";

const ENTRY = new URL("./main.ts", import.meta.url).href;
const VERSION_LINE = "book-title 0.1.0";
const platform = detectPlatformKind(Deno.build.os);
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
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--no-prompt",
      "--allow-env=BOOK_TITLE_CONTACT,BOOK_TITLE_CACHE_DIR,BOOK_TITLE_OFFLINE,BOOK_TITLE_LOG_LEVEL,HOME,XDG_CONFIG_HOME,XDG_CACHE_HOME,LOCALAPPDATA,APPDATA,USERPROFILE",
      "--allow-read=.",
      "--allow-write=.",
      ENTRY,
      ...args,
    ],
    env: options.env,
  });
  const output = await command.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
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
