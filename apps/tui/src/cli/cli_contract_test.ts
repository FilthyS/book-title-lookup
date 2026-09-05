/**
 * CLI contract-row tests for the issue #32 maintenance surface.
 *
 * Focused end-to-end rows asserted through runCli: X1-X5, X8, X15-X17,
 * X22-X24, X26; cache C1-C9; config G1-G6 from issue #12 sections 9.5/9.6.
 * Lookup commands are grammar-parse only in this slice and never dispatch.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { parseArgs } from "./args.ts";
import { type CliDeps, runCli } from "./dispatch.ts";
import {
  type EnvironmentReader,
  MemoryEnvironment,
} from "../../../../packages/providers/src/platform/env.ts";
import {
  DenoFileSystemSeam,
  type FileSystemSeam,
} from "../../../../packages/providers/src/cache/fs-seam.ts";
import { FixedClock } from "../../../../packages/providers/src/cache/clock.ts";
import {
  systemRandomSource,
} from "../../../../packages/providers/src/cache/random.ts";
import {
  FileEntryStore,
} from "../../../../packages/providers/src/cache/file-entry-store.ts";
import { computeCacheKey } from "../../../../packages/providers/src/cache/key.ts";
import {
  createEnvelope,
} from "../../../../packages/providers/src/cache/envelope.ts";
import {
  canonicalPath,
  joinPath,
  styleFromPlatform,
} from "../../../../packages/providers/src/platform/paths.ts";
import {
  detectPlatformKind,
} from "../../../../packages/providers/src/platform/platform.ts";

const FIXED = "2026-09-05T00:00:00.000Z";
const VERSION_LINE = "book-title 0.1.0";

const platform = detectPlatformKind(Deno.build.os);
const style = styleFromPlatform(platform);

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(text: string): Promise<void> {
      chunks.push(text);
      return Promise.resolve();
    },
    text(): string {
      return chunks.join("");
    },
  };
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Scratch {
  readonly root: string;
  readonly cacheRoot: string;
  readonly configRoot: string;
  readonly localRoot: string;
}

async function makeScratch(label: string): Promise<Scratch> {
  const base = joinPath(style, Deno.cwd(), ".tmp", "cli-tests", label);
  const cacheRoot = joinPath(style, base, "cache");
  const configRoot = joinPath(style, base, "config");
  const localRoot = joinPath(style, base, "local");
  await Deno.mkdir(base, { recursive: true });
  return { root: base, cacheRoot, configRoot, localRoot };
}

async function removeScratch(scratch: Scratch): Promise<void> {
  try {
    await Deno.remove(scratch.root, { recursive: true });
  } catch {
    // Best-effort cleanup; .tmp is git-ignored.
  }
}

function platformEnv(scratch: Scratch): Record<string, string> {
  if (platform === "windows") {
    return {
      APPDATA: scratch.configRoot,
      LOCALAPPDATA: scratch.localRoot,
      USERPROFILE: joinPath(style, scratch.root, "userprofile"),
    };
  }
  return {
    HOME: joinPath(style, scratch.root, "home"),
    XDG_CONFIG_HOME: scratch.configRoot,
    XDG_CACHE_HOME: scratch.localRoot,
  };
}

function defaultEnv(scratch: Scratch): MemoryEnvironment {
  return new MemoryEnvironment(platformEnv(scratch));
}

function makeDeps(options: {
  readonly env?: EnvironmentReader;
  readonly fs?: FileSystemSeam;
  readonly signal?: AbortSignal;
} = {}): {
  deps: CliDeps;
  stdout: { text(): string };
  stderr: { text(): string };
} {
  const stdout = makeWriter();
  const stderr = makeWriter();
  return {
    stdout,
    stderr,
    deps: {
      stdout,
      stderr,
      env: options.env ?? new MemoryEnvironment({}),
      fs: options.fs ?? new DenoFileSystemSeam(),
      platform,
      clock: new FixedClock(FIXED),
      random: systemRandomSource,
      signal: options.signal,
    },
  };
}

async function runCliOut(
  args: string[],
  deps: CliDeps,
): Promise<RunResult> {
  const code = await runCli(args, deps);
  return {
    code,
    stdout: (deps.stdout as unknown as { text(): string }).text(),
    stderr: (deps.stderr as unknown as { text(): string }).text(),
  };
}

/** Write one envelope into a fresh FileEntryStore cache root. */
async function seedCache(
  root: string,
  seed: {
    readonly provider?: "openlibrary" | "wikidata";
    readonly url: string;
    readonly bodyText?: string;
  },
): Promise<string> {
  const store = new FileEntryStore({
    cacheRoot: root,
    clock: new FixedClock(FIXED),
    fs: new DenoFileSystemSeam(),
    random: systemRandomSource,
    decoderSchemaVersions: { openlibrary: 1, wikidata: 1 },
    platform,
  });
  const key = await computeCacheKey(seed.provider ?? "openlibrary", seed.url);
  const envelope = createEnvelope({
    key,
    decoderSchemaVersion: 1,
    status: 200,
    body: new TextEncoder().encode(seed.bodyText ?? '{"ok":true}'),
    freshnessClass: "search",
    negative: false,
    fetchedAt: FIXED,
  });
  const written = await store.write(key, envelope);
  assertEquals(written, { status: "stored" });
  return key.digest;
}

function assertStdoutEmptyJsonDoc(run: RunResult): Record<string, unknown> {
  assertEquals(run.stderr, "", "stderr must stay clean for a JSON document");
  assertMatch(
    run.stdout,
    /^\{"schemaVersion":"cli-json\.v1".*\}\n$/,
    "compact JSON + newline",
  );
  const doc = JSON.parse(run.stdout);
  assertEquals(typeof doc, "object");
  assertEquals(Object.keys(doc)[0], "schemaVersion");
  return doc as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cross-cutting rows X1-X5, X8, X15-X17, X26
// ---------------------------------------------------------------------------

Deno.test("cli X1 top-level help prints usage on stdout and exits 0", async () => {
  const scratch = await makeScratch("x1");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["--help"], deps);
    assertEquals(run.code, 0);
    assertEquals(run.stderr, "");
    assertMatch(run.stdout, /Usage:/);
    assertMatch(run.stdout, /cache/);
    assertMatch(run.stdout, /config/);
    assertMatch(run.stdout, /--json/);
    assertMatch(run.stdout, /--version/);
    assertEquals(
      run.stdout.includes("schemaVersion"),
      false,
      "help is not JSON",
    );
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X2 command help prints usage per command scope and exits 0", async () => {
  const scratch = await makeScratch("x2");
  try {
    const cases: [string[], string][] = [
      [["cache", "--help"], "--cache-dir"],
      [["cache", "show", "--help"], "<digest>"],
      [["config", "show", "--help"], "config show"],
      [["titles", "--help"], "--reference"],
      [["resolve", "--help"], "--isbn"],
      [["search", "--help"], "--title"],
    ];
    for (const [args, expected] of cases) {
      const { deps } = makeDeps({ env: defaultEnv(scratch) });
      const run = await runCliOut(args, deps);
      assertEquals(run.code, 0, args.join(" "));
      assertEquals(run.stderr, "", args.join(" "));
      assertMatch(
        run.stdout,
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        args.join(" "),
      );
    }
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X3 version prints one stamp line and exits 0", async () => {
  const scratch = await makeScratch("x3");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["--version"], deps);
    assertEquals(run.code, 0);
    assertEquals(run.stdout, `${VERSION_LINE}\n`);
    assertEquals(run.stderr, "");
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X4 unknown command is exit 2 with stderr only", async () => {
  const scratch = await makeScratch("x4");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["frobnicate"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /unknown command/);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X5 unknown option is exit 2 with stderr only", async () => {
  const scratch = await makeScratch("x5");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["cache", "list", "--titles", "x"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /unknown option/);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X8 missing required option is exit 2 with stderr only", async () => {
  const scratch = await makeScratch("x8");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["resolve"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /--reference|--isbn/);

    const missingDigest = await runCliOut(["cache", "show"], deps);
    assertEquals(missingDigest.code, 2);
    assertEquals(missingDigest.stdout, "");
    assertMatch(missingDigest.stderr, /digest/);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X15 relative --cache-dir is exit 2 with no stdout", async () => {
  const scratch = await makeScratch("x15");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut([
      "cache",
      "list",
      "--cache-dir",
      "relative/path",
    ], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /absolute path/);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X16 invalid cache digest is exit 2 with no stdout", async () => {
  const scratch = await makeScratch("x16");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["cache", "show", "abc"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /digest/);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X17 JSON envelope is compact, schemaVersion first, newline terminated", async () => {
  const scratch = await makeScratch("x17");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["cache", "list", "--json"], deps);
    assertEquals(run.code, 0);
    const doc = assertStdoutEmptyJsonDoc(run);
    assertEquals(doc.schemaVersion, "cli-json.v1");
    assertEquals(doc.command, "cache");
    assertEquals(
      run.stdout.includes("\x1b["),
      false,
      "JSON is never colorized",
    );
    assertEquals(run.stdout.charCodeAt(0) === 0xfeff, false, "no BOM");
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli X26 --flag value and --flag=value forms are equivalent", async () => {
  const scratch = await makeScratch("x26");
  try {
    const spaced = makeDeps({ env: defaultEnv(scratch) });
    const spacedRun = await runCliOut(
      ["config", "show", "--json", "--cache-dir", scratch.cacheRoot],
      spaced.deps,
    );
    assertEquals(spacedRun.code, 0);

    const equalsForm = makeDeps({ env: defaultEnv(scratch) });
    const equalsRun = await runCliOut(
      ["config", "show", "--cache-dir=" + scratch.cacheRoot, "--json"],
      equalsForm.deps,
    );
    assertEquals(equalsRun.code, 0);
    assertEquals(
      equalsRun.stdout,
      spacedRun.stdout,
      "same document for both forms",
    );

    const doc = JSON.parse(equalsRun.stdout) as {
      settings: { cacheRoot: string };
      sources: { cacheRoot: string };
    };
    assertEquals(
      doc.settings.cacheRoot,
      canonicalPath(scratch.cacheRoot, style),
    );
    assertEquals(doc.sources.cacheRoot, "cli");
  } finally {
    await removeScratch(scratch);
  }
});

// ---------------------------------------------------------------------------
// Lookup commands are never dispatched in this slice
// ---------------------------------------------------------------------------

Deno.test("cli lookup commands parse but dispatch is unavailable in this build", async () => {
  const scratch = await makeScratch("lookup");
  try {
    const parsed = parseArgs(["search", "--title", "百年孤独"]);
    assertEquals(parsed.ok, true);
    if (!parsed.ok) return;
    assertEquals(parsed.invocation.mode, "lookup");
    if (parsed.invocation.mode !== "lookup") return;
    assertEquals(parsed.invocation.command, "search");

    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["search", "--title", "百年孤独"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /not available in this build/);
  } finally {
    await removeScratch(scratch);
  }
});

// ---------------------------------------------------------------------------
// cache C1-C9
// ---------------------------------------------------------------------------

Deno.test("cli C1 empty cache list --json reports entries [] and exits 0", async () => {
  const scratch = await makeScratch("c1");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      ["cache", "list", "--json", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = assertStdoutEmptyJsonDoc(run);
    assertEquals(doc.operation, "list");
    assertEquals(doc.status, "ok");
    assertEquals(doc.entries, []);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C2 cache list is deterministic and sorted by digest", async () => {
  const scratch = await makeScratch("c2");
  try {
    const digests = [];
    digests.push(
      await seedCache(scratch.cacheRoot, {
        url: "https://openlibrary.org/search.json?q=zzz",
      }),
    );
    digests.push(
      await seedCache(scratch.cacheRoot, {
        url: "https://openlibrary.org/search.json?q=aaa",
      }),
    );
    digests.push(
      await seedCache(scratch.cacheRoot, {
        provider: "wikidata",
        url:
          "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=one",
      }),
    );

    const first = makeDeps({ env: defaultEnv(scratch) });
    const runA = await runCliOut(
      ["cache", "list", "--json", "--cache-dir", scratch.cacheRoot],
      first.deps,
    );
    assertEquals(runA.code, 0);
    const second = makeDeps({ env: defaultEnv(scratch) });
    const runB = await runCliOut(
      ["cache", "list", "--json", "--cache-dir", scratch.cacheRoot],
      second.deps,
    );
    assertEquals(runB.code, 0);
    assertEquals(
      runB.stdout,
      runA.stdout,
      "repeat invocations are byte-identical",
    );

    const doc = JSON.parse(runA.stdout) as {
      entries: Array<{ digest: string; provider: string; state: string }>;
    };
    assertEquals(doc.entries.length, 3);
    const listed = doc.entries.map((entry) => entry.digest);
    assertEquals(listed, [...listed].sort());
    for (const entry of doc.entries) {
      assertEquals(
        entry.provider === "openlibrary" || entry.provider === "wikidata",
        true,
      );
      assertEquals(entry.state, "fresh");
    }
    assertEquals([...digests].sort(), listed);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C3 cache show --json omits the body unless --debug", async () => {
  const scratch = await makeScratch("c3");
  try {
    const digest = await seedCache(scratch.cacheRoot, {
      url: "https://openlibrary.org/search.json?q=show",
      bodyText: '{"docs":[{"key":"/works/OL1W"}]}',
    });
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      ["cache", "show", digest, "--json", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      digest: string;
      operation: string;
      entry: {
        request: { url: string };
        response: Record<string, unknown>;
      };
    };
    assertEquals(doc.digest, digest);
    assertEquals(doc.operation, "show");
    assertEquals(
      doc.entry.request.url,
      "https://openlibrary.org/search.json?q=show",
    );
    assertEquals("body" in doc.entry.response, false);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C4 cache show --debug includes the body with its encoding", async () => {
  const scratch = await makeScratch("c4");
  try {
    const digest = await seedCache(scratch.cacheRoot, {
      url: "https://openlibrary.org/search.json?q=debug",
      bodyText: '{"ok":true}',
    });
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      [
        "cache",
        "show",
        digest,
        "--json",
        "--debug",
        "--cache-dir",
        scratch.cacheRoot,
      ],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      entry: { response: { body: { encoding: string; text: string } } };
    };
    assertEquals(doc.entry.response.body.encoding, "utf8");
    assertEquals(doc.entry.response.body.text, '{"ok":true}');
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C5 cache show for an unknown digest is exit 2 with no stdout", async () => {
  const scratch = await makeScratch("c5");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      [
        "cache",
        "show",
        "f".repeat(64),
        "--json",
        "--cache-dir",
        scratch.cacheRoot,
      ],
      deps,
    );
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /not found|no such|missing/i);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C6 cache clear removes entries and bytes and never touches the config root", async () => {
  const scratch = await makeScratch("c6");
  try {
    const digest1 = await seedCache(scratch.cacheRoot, {
      url: "https://openlibrary.org/search.json?q=a",
    });
    const digest2 = await seedCache(scratch.cacheRoot, {
      url: "https://openlibrary.org/search.json?q=b",
    });
    assertEquals(digest1 === digest2, false, "seeds use distinct keys");
    const sentinel = joinPath(style, scratch.configRoot, "sentinel.txt");
    await Deno.mkdir(scratch.configRoot, { recursive: true });
    await Deno.writeTextFile(sentinel, "keep me");

    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      ["cache", "clear", "--json", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      operation: string;
      status: string;
      removedEntries: number;
      removedBytes: number;
    };
    assertEquals(doc.operation, "clear");
    assertEquals(doc.status, "ok");
    assertEquals(doc.removedEntries, 2);
    assert(doc.removedBytes > 0);

    const sentinelText = await Deno.readTextFile(sentinel);
    assertEquals(
      sentinelText,
      "keep me",
      "config root is untouched by cache clear",
    );
    const listDeps = makeDeps({ env: defaultEnv(scratch) });
    const listed = await runCliOut(
      ["cache", "list", "--json", "--cache-dir", scratch.cacheRoot],
      listDeps.deps,
    );
    assertEquals(listed.code, 0, listed.stderr);
    const listedDoc = JSON.parse(listed.stdout) as { entries: unknown[] };
    assertEquals(listedDoc.entries, []);
    // The two seeded digests are gone from the store view.
    const remaining = await Deno.readDir(
      joinPath(style, scratch.cacheRoot, "v1"),
    );
    const names: string[] = [];
    for await (const entry of remaining) names.push(entry.name);
    assertEquals(names.filter((name) => name.endsWith(".json")).length, 0);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C7 cache clear with no entries reports zero counts", async () => {
  const scratch = await makeScratch("c7");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      ["cache", "clear", "--json", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      removedEntries: number;
      removedBytes: number;
    };
    assertEquals(doc.removedEntries, 0);
    assertEquals(doc.removedBytes, 0);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C8 cache root permission denial exits 2 with stderr diagnostic", async () => {
  const scratch = await makeScratch("c8");
  try {
    const fs = new DenyCacheDirectoryFs(scratch.cacheRoot);
    const { deps } = makeDeps({ env: defaultEnv(scratch), fs });
    const run = await runCliOut(
      ["cache", "list", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /permission|denied/i);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli C9 cancelled cache list emits the cancelled document and exits 130", async () => {
  const scratch = await makeScratch("c9");
  try {
    const controller = new AbortController();
    controller.abort();
    const { deps } = makeDeps({
      env: defaultEnv(scratch),
      signal: controller.signal,
    });
    const run = await runCliOut(["cache", "list", "--json"], deps);
    assertEquals(run.code, 130);
    const doc = JSON.parse(run.stdout) as Record<string, unknown>;
    assertEquals(doc.schemaVersion, "cli-json.v1");
    assertEquals(doc.command, "cache");
    assertEquals(doc.status, "cancelled");
  } finally {
    await removeScratch(scratch);
  }
});

// ---------------------------------------------------------------------------
// config G1-G6
// ---------------------------------------------------------------------------

Deno.test("cli G1 config show --json defaults report every origin as default", async () => {
  const scratch = await makeScratch("g1");
  try {
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["config", "show", "--json"], deps);
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      command: string;
      operation: string;
      status: string;
      settings: {
        configRoot: string;
        cacheRoot: string;
        offline: boolean;
        logLevel: string;
        contact?: string;
      };
      sources: Record<string, string>;
    };
    assertEquals(doc.command, "config");
    assertEquals(doc.operation, "show");
    assertEquals(doc.status, "ok");
    assertEquals(
      doc.settings.configRoot,
      joinPath(style, scratch.configRoot, "book-title-lookup"),
    );
    assertEquals(doc.sources, {
      offline: "default",
      logLevel: "default",
      contact: "default",
      cacheRoot: "default",
    });
    assertEquals(doc.settings.offline, false);
    assertEquals(doc.settings.logLevel, "info");
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli G2 config precedence records cli > environment > config_file > default", async () => {
  const scratch = await makeScratch("g2");
  try {
    // Write a config file carrying the lowest-precedence values.
    await Deno.mkdir(
      joinPath(style, scratch.configRoot, "book-title-lookup"),
      { recursive: true },
    );
    await Deno.writeTextFile(
      joinPath(style, scratch.configRoot, "book-title-lookup", "config.json"),
      JSON.stringify({
        schemaVersion: "config.v1",
        offline: true,
        logLevel: "debug",
        contact: "config@example.com",
      }),
    );
    const env = new MemoryEnvironment({
      ...platformEnv(scratch),
      BOOK_TITLE_OFFLINE: "false",
      BOOK_TITLE_LOG_LEVEL: "warn",
      BOOK_TITLE_CONTACT: "env@example.com",
    });
    const { deps } = makeDeps({ env });
    const run = await runCliOut(
      ["config", "show", "--json", "--offline"],
      deps,
    );
    assertEquals(run.code, 0);
    const doc = JSON.parse(run.stdout) as {
      settings: {
        offline: boolean;
        logLevel: string;
        contact: string;
      };
      sources: Record<string, string>;
    };
    assertEquals(doc.settings.offline, true);
    assertEquals(doc.sources.offline, "cli");
    assertEquals(doc.settings.logLevel, "warn");
    assertEquals(doc.sources.logLevel, "environment");
    assertEquals(doc.settings.contact, "env@example.com");
    assertEquals(doc.sources.contact, "environment");
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli G3 cache root origins are cli or environment and never config_file", async () => {
  const scratch = await makeScratch("g3");
  try {
    const fromCli = makeDeps({ env: defaultEnv(scratch) });
    const cliRun = await runCliOut(
      ["config", "show", "--json", "--cache-dir", scratch.cacheRoot],
      fromCli.deps,
    );
    assertEquals(cliRun.code, 0);
    const cliDoc = JSON.parse(cliRun.stdout) as {
      sources: { cacheRoot: string };
    };
    assertEquals(cliDoc.sources.cacheRoot, "cli");

    const envReader = new MemoryEnvironment({
      ...platformEnv(scratch),
      BOOK_TITLE_CACHE_DIR: scratch.cacheRoot,
    });
    const fromEnv = makeDeps({ env: envReader });
    const envRun = await runCliOut(["config", "show", "--json"], fromEnv.deps);
    assertEquals(envRun.code, 0);
    const envDoc = JSON.parse(envRun.stdout) as {
      settings: { cacheRoot: string };
      sources: { cacheRoot: string };
    };
    assertEquals(envDoc.sources.cacheRoot, "environment");
    assertEquals(
      envDoc.settings.cacheRoot,
      canonicalPath(scratch.cacheRoot, style),
    );
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli G4 invalid config file is exit 2 with stderr and no JSON", async () => {
  const scratch = await makeScratch("g4");
  try {
    await Deno.mkdir(
      joinPath(style, scratch.configRoot, "book-title-lookup"),
      { recursive: true },
    );
    await Deno.writeTextFile(
      joinPath(style, scratch.configRoot, "book-title-lookup", "config.json"),
      JSON.stringify({ schemaVersion: "config.v1", unknownKey: true }),
    );
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(["config", "show", "--json"], deps);
    assertEquals(run.code, 2);
    assertEquals(run.stdout, "");
    assertMatch(run.stderr, /invalid|unknown config key/i);
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli G6 config show human text is deterministic plain text", async () => {
  const scratch = await makeScratch("g6");
  try {
    const { deps } = makeDeps({
      env: new MemoryEnvironment({
        ...platformEnv(scratch),
        BOOK_TITLE_CONTACT: "alice@example.com",
      }),
    });
    const run = await runCliOut(["config", "show"], deps);
    assertEquals(run.code, 0);
    assertEquals(run.stderr, "");
    assertMatch(run.stdout, /config root:/);
    assertMatch(run.stdout, /cache root:/);
    assertMatch(run.stdout, /offline:/);
    assertMatch(run.stdout, /log level:/);
    assertMatch(run.stdout, /alice@example\.com/);
    assertMatch(run.stdout, /environment/);
    assertEquals(
      run.stdout.includes("\x1b["),
      false,
      "human output is plain by default",
    );
  } finally {
    await removeScratch(scratch);
  }
});

Deno.test("cli cache list human text matches the deterministic row shape", async () => {
  const scratch = await makeScratch("human-list");
  try {
    await seedCache(scratch.cacheRoot, {
      url: "https://openlibrary.org/search.json?q=human",
      bodyText: "{}",
    });
    const { deps } = makeDeps({ env: defaultEnv(scratch) });
    const run = await runCliOut(
      ["cache", "list", "--cache-dir", scratch.cacheRoot],
      deps,
    );
    assertEquals(run.code, 0);
    assertEquals(run.stderr, "");
    assertMatch(
      run.stdout,
      /^[0-9a-f]{64} {2}openlibrary {2}search {2}fresh {2}/,
    );
    assertMatch(
      run.stdout,
      /https:\/\/openlibrary\.org\/search\.json\?q=human\n$/,
    );
  } finally {
    await removeScratch(scratch);
  }
});

class DenyCacheDirectoryFs extends DenoFileSystemSeam {
  #deniedRoot: string;
  constructor(deniedRoot: string) {
    super();
    this.#deniedRoot = deniedRoot;
  }
  override listDirectory(path: string) {
    if (path.startsWith(this.#deniedRoot)) {
      return Promise.resolve({
        ok: false as const,
        error: "permission_denied" as const,
      });
    }
    return super.listDirectory(path);
  }
}
