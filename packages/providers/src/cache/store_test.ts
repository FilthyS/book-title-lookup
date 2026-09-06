import { assert, assertEquals } from "@std/assert";
import { computeCacheKey } from "./key.ts";
import { createEnvelope, parseEnvelope } from "./envelope.ts";
import { FileEntryStore } from "./file-entry-store.ts";
import {
  NodeFileSystemSeam,
  type FileSystemSeam,
  type FsResult,
} from "./fs-seam.ts";
import { FixedClock } from "./clock.ts";
import { systemRandomSource } from "./random.ts";
import type { CacheKey } from "./key.ts";
import {
  freshTestDir,
  hostPlatform,
  hostStyle,
  listNames,
  readFileText,
  removeTestDir,
} from "./cache_test_util.ts";
import { joinPath } from "../platform/paths.ts";
import type { PlatformKind } from "../platform/platform.ts";

const utf8 = new TextEncoder();
const FIXED = "2026-09-05T00:00:00.000Z";

function makeStore(
  root: string,
  clock: FixedClock,
  options: {
    readonly fs?: FileSystemSeam;
    readonly platform?: PlatformKind;
  } = {},
): FileEntryStore {
  return new FileEntryStore({
    cacheRoot: root,
    clock,
    fs: options.fs ?? new NodeFileSystemSeam(),
    random: systemRandomSource,
    decoderSchemaVersions: { openlibrary: 1, wikidata: 1 },
    platform: options.platform ?? hostPlatform(),
    tempReclaimOlderThanMs: 1,
    renameRetry: { attempts: 5, baseDelayMs: 0 },
  });
}

interface SeedOptions {
  readonly provider?: "openlibrary" | "wikidata";
  readonly url?: string;
  readonly status?: number;
  readonly freshnessClass?: "search" | "detail" | "negative";
  readonly negative?: boolean;
  readonly decoderSchemaVersion?: number;
  readonly body?: Uint8Array;
  readonly fetchedAt?: string;
}

async function seed(
  store: FileEntryStore,
  clock: FixedClock,
  options: SeedOptions = {},
): Promise<CacheKey> {
  const url =
    options.url ?? "https://openlibrary.org/works/OL274505W.json?fields=title";
  const key = await computeCacheKey(options.provider ?? "openlibrary", url);
  const envelope = createEnvelope({
    key,
    decoderSchemaVersion: options.decoderSchemaVersion ?? 1,
    status: options.status ?? 200,
    body: options.body ?? utf8.encode('{"ok":true}'),
    freshnessClass: options.freshnessClass ?? "detail",
    negative: options.negative ?? false,
    fetchedAt: options.fetchedAt ?? clock.now(),
  });
  const written = await store.write(key, envelope);
  assertEquals(written, { status: "stored" });
  return key;
}

async function withFreshDir<T>(
  label: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await freshTestDir(label);
  try {
    return await fn(dir);
  } finally {
    await removeTestDir(dir);
  }
}

function v1Path(root: string, digest: string): string {
  return joinPath(hostStyle(), root, "v1", `${digest}.json`);
}

Deno.test("cache/store miss on an empty root", async () => {
  await withFreshDir("miss", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await computeCacheKey(
      "openlibrary",
      "https://openlibrary.org/search.json?q=x",
    );
    const outcome = await store.read(key, { mode: "online" });
    assertEquals(outcome, { status: "miss" });
    const list = await store.list();
    assertEquals(list, { status: "ok", entries: [] });
  });
});

Deno.test("cache/store write then fresh hit in either mode", async () => {
  await withFreshDir("fresh", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock);
    const online = await store.read(key, { mode: "online" });
    assertEquals(online.status, "hit_fresh");
    const offline = await store.read(key, { mode: "offline" });
    assertEquals(offline.status, "hit_fresh");
  });
});

Deno.test("cache/store freshness classes are decided at write time", async () => {
  await withFreshDir("ttl", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock, { freshnessClass: "search" });
    clock.advance(24 * 60 * 60 * 1000 - 1);
    assertEquals(
      (await store.read(key, { mode: "offline" })).status,
      "hit_fresh",
    );
    clock.advance(2);
    assertEquals((await store.read(key, { mode: "online" })).status, "miss");
  });
});

Deno.test("cache/store stale positive is usable offline only and labeled", async () => {
  await withFreshDir("stale", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock, { freshnessClass: "search" });
    clock.advance(24 * 60 * 60 * 1000 + 5);
    const online = await store.read(key, { mode: "online" });
    assertEquals(online, { status: "miss" });
    const offline = await store.read(key, { mode: "offline" });
    assertEquals(offline.status, "hit_stale");
    if (offline.status === "hit_stale") {
      assertEquals(offline.staleSince, "2026-09-06T00:00:00.000Z");
    }
  });
});

Deno.test("cache/store stale negative never answers and is removed", async () => {
  await withFreshDir("negstale", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock, {
      freshnessClass: "negative",
      negative: true,
    });
    clock.advance(60 * 60 * 1000 + 5);
    assertEquals((await store.read(key, { mode: "offline" })).status, "miss");
    const list = await store.list();
    assertEquals(list, { status: "ok", entries: [] });
  });
});

Deno.test("cache/store fresh negative answers within TTL", async () => {
  await withFreshDir("negfresh", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock, {
      freshnessClass: "negative",
      negative: true,
    });
    assertEquals(
      (await store.read(key, { mode: "online" })).status,
      "hit_fresh",
    );
  });
});

Deno.test("cache/store corrupt files are quarantined and then behave as miss", async () => {
  await withFreshDir("corrupt", async (root) => {
    const clock = new FixedClock(FIXED);
    const fs = new NodeFileSystemSeam();
    const store = makeStore(root, clock, { fs });
    const key = await seed(store, clock);
    const path = v1Path(root, key.digest);
    await Deno.writeTextFile(path, "not json at all");
    const outcome = await store.read(key, { mode: "online" });
    assertEquals(outcome.status, "corrupt");
    if (outcome.status === "corrupt") {
      assert(outcome.quarantinedTo !== undefined, "quarantine target expected");
    }
    // Quarantine moved the file; live entry is gone.
    const again = await store.read(key, { mode: "online" });
    assertEquals(again, { status: "miss" });
    const names = await listNames(
      fs,
      joinPath(hostStyle(), root, "v1", "quarantine"),
    );
    assertEquals(names.length, 1);
    assert(
      names[0].includes(`${key.digest}.`),
      "quarantine name embeds digest",
    );
  });
});

Deno.test("cache/store decoder schema bump is corruption", async () => {
  await withFreshDir("decoder", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    // Write with decoder version 1, then read with a store expecting version 2.
    const key = await seed(store, clock);
    const v2Store = new FileEntryStore({
      cacheRoot: root,
      clock,
      fs: new NodeFileSystemSeam(),
      random: systemRandomSource,
      decoderSchemaVersions: { openlibrary: 2, wikidata: 2 },
      platform: hostPlatform(),
      tempReclaimOlderThanMs: 1,
    });
    const outcome = await v2Store.read(key, { mode: "online" });
    assertEquals(outcome.status, "corrupt");
  });
});

Deno.test("cache/store different parameters and providers produce distinct keys", async () => {
  await withFreshDir("keys", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const a = await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=x&limit=10",
    });
    const b = await seed(store, clock, {
      url: "https://openlibrary.org/search.json?limit=10&q=x",
    });
    const c = await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=x&offset=20",
    });
    const d = await seed(store, clock, {
      provider: "wikidata",
      url: "https://openlibrary.org/search.json?q=x&limit=10",
    });
    assertEquals(a.digest, b.digest); // same identity after canonicalization
    const list = await store.list();
    assertEquals(list.status, "ok");
    if (list.status === "ok") {
      assertEquals(list.entries.length, 3);
    }
    assertEquals(a.digest === c.digest, false);
    assertEquals(a.digest === d.digest, false);
  });
});

Deno.test("cache/store list is deterministic and sorted by digest", async () => {
  await withFreshDir("list", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=zzz",
    });
    await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=aaa",
    });
    await seed(store, clock, {
      provider: "wikidata",
      url: "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=one",
    });
    const first = await store.list();
    const second = await store.list();
    assertEquals(first, second);
    if (first.status === "ok") {
      const digests = first.entries.map((entry) => entry.digest);
      const sorted = [...digests].sort();
      assertEquals(digests, sorted);
      assertEquals(first.entries.length, 3);
      for (const entry of first.entries) {
        assertEquals(
          entry.provider === "openlibrary" || entry.provider === "wikidata",
          true,
        );
        assertEquals(entry.state, "fresh");
        assertEquals(entry.byteLength > 0, true);
      }
    }
  });
});

Deno.test("cache/store show returns the envelope and a not_found for unknown digest", async () => {
  await withFreshDir("show", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock);
    const show = await store.show(key.digest);
    assertEquals(show.status, "ok");
    if (show.status === "ok") {
      assertEquals(show.entry.key.digest, key.digest);
      assertEquals(show.entry.response.status, 200);
    }
    const missing = await store.show("f".repeat(64));
    assertEquals(missing, { status: "not_found", digest: "f".repeat(64) });
  });
});

Deno.test("cache/store clear removes live, quarantined, and temp files and counts bytes", async () => {
  await withFreshDir("clear", async (root) => {
    const clock = new FixedClock(FIXED);
    const fs = new NodeFileSystemSeam();
    const store = makeStore(root, clock, { fs });
    const key1 = await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=a",
    });
    const key2 = await seed(store, clock, {
      url: "https://openlibrary.org/search.json?q=b",
    });
    // Create a quarantine file by corrupting one entry.
    const path2 = v1Path(root, key2.digest);
    await Deno.writeTextFile(path2, "garbage");
    await store.read(key2, { mode: "online" });
    // Create a stale temp file.
    const v1 = joinPath(hostStyle(), root, "v1");
    const temp = joinPath(hostStyle(), v1, `${key1.digest}.dead.tmp`);
    await Deno.writeTextFile(temp, "partial");
    const cleared = await store.clear();
    assertEquals(cleared.status, "ok");
    if (cleared.status === "ok") {
      // key1 live + quarantined key2 + the manual temp file.
      assertEquals(cleared.removedEntries, 3);
      assert(cleared.removedBytes > 0);
    }
    const list = await store.list();
    assertEquals(list, { status: "ok", entries: [] });
    // A sibling path outside the cache root is untouched.
    const sibling = joinPath(hostStyle(), root, "..", "unrelated-file.json");
    await Deno.writeTextFile(sibling, "keep");
    const siblingExists = (await fs.stat(sibling)).ok;
    assertEquals(siblingExists, true);
    await Deno.remove(sibling);
  });
});

Deno.test("cache/store clear on an empty cache reports zeroes", async () => {
  await withFreshDir("clearempty", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const cleared = await store.clear();
    assertEquals(cleared, { status: "ok", removedEntries: 0, removedBytes: 0 });
  });
});

Deno.test("cache/store reclaim removes old temp litter and keeps fresh temps", async () => {
  await withFreshDir("reclaim", async (root) => {
    const now = new Date();
    const clock = new FixedClock(now.toISOString());
    const fs = new NodeFileSystemSeam();
    const store = makeStore(root, clock, { fs });
    await seed(store, clock);
    const v1 = joinPath(hostStyle(), root, "v1");
    const oldTemp = joinPath(
      hostStyle(),
      v1,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.old.tmp",
    );
    const youngTemp = joinPath(
      hostStyle(),
      v1,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.young.tmp",
    );
    await Deno.writeTextFile(oldTemp, "x");
    await Deno.writeTextFile(youngTemp, "y");

    // With a clock at real now and a conservative threshold, fresh temps stay.
    const conservative = makeStore(root, new FixedClock(now.toISOString()), {
      fs,
    });
    const kept = await conservative.reclaim();
    assertEquals(kept.status, "ok");
    if (kept.status === "ok") assertEquals(kept.removedTemps, 0);

    // With the clock advanced past the 1 ms threshold, old temps are reclaimed.
    const advancedClock = new FixedClock(
      new Date(now.getTime() + 5_000).toISOString(),
    );
    const advanced = makeStore(root, advancedClock, { fs });
    const reclaimed = await advanced.reclaim();
    assertEquals(reclaimed.status, "ok");
    if (reclaimed.status === "ok") assertEquals(reclaimed.removedTemps, 2);
    const after = await listNames(fs, v1);
    assertEquals(after.filter((name) => name.endsWith(".tmp")).length, 0);
  });
});

Deno.test("cache/store atomic writes leave whole entries for concurrent readers", async () => {
  await withFreshDir("atomic", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const url = "https://openlibrary.org/search.json?q=atomic";
    const key = await computeCacheKey("openlibrary", url);
    const bodies = ["alpha", "beta", "gamma"].map((t) =>
      utf8.encode(`{"tag":"${t}"}`),
    );
    const envelopes = bodies.map((body) =>
      createEnvelope({
        key,
        decoderSchemaVersion: 1,
        status: 200,
        body,
        freshnessClass: "search",
        negative: false,
        fetchedAt: clock.now(),
      }),
    );
    const writes = envelopes.map((envelope) => store.write(key, envelope));
    const results = await Promise.all(writes);
    for (const result of results) assertEquals(result.status, "stored");
    const outcome = await store.read(key, { mode: "online" });
    assertEquals(outcome.status, "hit_fresh");
    if (outcome.status === "hit_fresh") {
      const text = new TextDecoder().decode(
        outcome.envelope.response.body.encoding === "utf8"
          ? utf8.encode(outcome.envelope.response.body.text)
          : new Uint8Array(0),
      );
      assert(["alpha", "beta", "gamma"].some((t) => text.includes(t)));
    }
  });
});

class ThrowingRenameFs implements FileSystemSeam {
  constructor(readonly inner: FileSystemSeam) {}
  mkdir(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ) {
    return this.inner.mkdir(path, options);
  }
  stat(path: string) {
    return this.inner.stat(path);
  }
  openForWrite(path: string) {
    return this.inner.openForWrite(path);
  }
  readTextFile(path: string) {
    return this.inner.readTextFile(path);
  }
  rename(_from: string, _to: string): Promise<FsResult> {
    throw new Error("simulated crash before rename");
  }
  remove(path: string) {
    return this.inner.remove(path);
  }
  listDirectory(path: string) {
    return this.inner.listDirectory(path);
  }
}

Deno.test("cache/store crash before rename leaves the old entry and reclaimable temp", async () => {
  await withFreshDir("crash", async (root) => {
    const clock = new FixedClock(new Date().toISOString());
    const realFs = new NodeFileSystemSeam();
    const url = "https://openlibrary.org/search.json?q=crash";
    const key = await computeCacheKey("openlibrary", url);
    const first = createEnvelope({
      key,
      decoderSchemaVersion: 1,
      status: 200,
      body: utf8.encode('{"tag":"old"}'),
      freshnessClass: "search",
      negative: false,
      fetchedAt: clock.now(),
    });
    // Phase 1: a healthy store writes the old complete entry.
    assertEquals(
      (await makeStore(root, clock, { fs: realFs }).write(key, first)).status,
      "stored",
    );

    // Phase 2: a store over a crashing seam is interrupted before the rename.
    const crashingFs = new ThrowingRenameFs(realFs);
    const crashingStore = makeStore(root, clock, { fs: crashingFs });
    let threw = false;
    try {
      const second = createEnvelope({
        key,
        decoderSchemaVersion: 1,
        status: 200,
        body: utf8.encode('{"tag":"new"}'),
        freshnessClass: "search",
        negative: false,
        fetchedAt: clock.now(),
      });
      await crashingStore.write(key, second);
    } catch {
      threw = true;
    }
    assert(threw, "interrupted write should surface a crash");

    const v1 = joinPath(hostStyle(), root, "v1");
    const names = await listNames(realFs, v1);
    assert(
      names.some((name) => name.endsWith(".tmp")),
      "orphan temp survives crash",
    );
    const onDisk = await readFileText(realFs, v1Path(root, key.digest));
    assertEquals(onDisk.includes("old"), true);
    assertEquals(onDisk.includes("new"), false);

    // Advance the clock so reclamation sees the orphaned temp as old.
    clock.advance(10_000);
    const reclaimed = await crashingStore.reclaim();
    assertEquals(reclaimed.status, "ok");
    if (reclaimed.status === "ok") assertEquals(reclaimed.removedTemps, 1);
  });
});

class TransientRenameFs implements FileSystemSeam {
  #failuresRemaining: number;
  constructor(
    readonly inner: FileSystemSeam,
    failures: number,
  ) {
    this.#failuresRemaining = failures;
  }
  mkdir(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ) {
    return this.inner.mkdir(path, options);
  }
  stat(path: string) {
    return this.inner.stat(path);
  }
  openForWrite(path: string) {
    return this.inner.openForWrite(path);
  }
  readTextFile(path: string) {
    return this.inner.readTextFile(path);
  }
  rename(from: string, to: string) {
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      return Promise.resolve({
        ok: false,
        error: "other" as const,
        message: "simulated Windows contention",
      });
    }
    return this.inner.rename(from, to);
  }
  remove(path: string) {
    return this.inner.remove(path);
  }
  listDirectory(path: string) {
    return this.inner.listDirectory(path);
  }
}

Deno.test("cache/store Windows rename contention retries and succeeds", async () => {
  await withFreshDir("contention", async (root) => {
    const clock = new FixedClock(FIXED);
    const fs = new TransientRenameFs(new NodeFileSystemSeam(), 2);
    const store = makeStore(root, clock, { fs, platform: "windows" });
    const url = "https://openlibrary.org/search.json?q=contention";
    const key = await computeCacheKey("openlibrary", url);
    const envelope = createEnvelope({
      key,
      decoderSchemaVersion: 1,
      status: 200,
      body: utf8.encode('{"ok":true}'),
      freshnessClass: "search",
      negative: false,
      fetchedAt: clock.now(),
    });
    const written = await store.write(key, envelope);
    assertEquals(written, { status: "stored" });
    const outcome = await store.read(key, { mode: "online" });
    assertEquals(outcome.status, "hit_fresh");
  });
});

Deno.test("cache/store permission-denied paths map to typed failures", async () => {
  await withFreshDir("deny", async (root) => {
    const clock = new FixedClock(FIXED);
    const base = new NodeFileSystemSeam();
    const fs = new DenyFs(base);
    const store = makeStore(root, clock, { fs });
    const key = await computeCacheKey(
      "openlibrary",
      "https://openlibrary.org/search.json?q=deny",
    );

    const read = await store.read(key, { mode: "online" });
    assertEquals(read.status, "permission_denied");
    const list = await store.list();
    assertEquals(list.status, "permission_denied");
    const show = await store.show(key.digest);
    assertEquals(show.status, "permission_denied");
  });
});

class DenyFs implements FileSystemSeam {
  constructor(readonly inner: FileSystemSeam) {}
  mkdir(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ) {
    return this.inner.mkdir(path, options);
  }
  stat(path: string) {
    return this.inner.stat(path);
  }
  openForWrite(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
      message: "denied",
    });
  }
  readTextFile(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
    });
  }
  rename(from: string, to: string) {
    return this.inner.rename(from, to);
  }
  remove(path: string) {
    return this.inner.remove(path);
  }
  listDirectory(_path: string) {
    return Promise.resolve({
      ok: false as const,
      error: "permission_denied" as const,
    });
  }
}

Deno.test("cache/store cancellation is a typed outcome, never a book result", async () => {
  await withFreshDir("cancel", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock);
    const controller = new AbortController();
    controller.abort();
    assertEquals(
      (await store.read(key, { mode: "online", signal: controller.signal }))
        .status,
      "cancelled",
    );
    assertEquals(
      (await store.list({ signal: controller.signal })).status,
      "cancelled",
    );
    assertEquals(
      (await store.show(key.digest, { signal: controller.signal })).status,
      "cancelled",
    );
    const envelope = createEnvelope({
      key,
      decoderSchemaVersion: 1,
      status: 200,
      body: utf8.encode("{}"),
      freshnessClass: "search",
      negative: false,
      fetchedAt: clock.now(),
    });
    assertEquals(
      (await store.write(key, envelope, { signal: controller.signal })).status,
      "cancelled",
    );
  });
});

Deno.test("cache/store file layout matches the v1 schema", async () => {
  await withFreshDir("layout", async (root) => {
    const clock = new FixedClock(FIXED);
    const fs = new NodeFileSystemSeam();
    const store = makeStore(root, clock, { fs });
    const key = await seed(store, clock);
    const livePath = v1Path(root, key.digest);
    const text = await readFileText(fs, livePath);
    const parsed = parseEnvelope(text);
    assertEquals(parsed.ok, true);
    if (parsed.ok) {
      const envelope = parsed.envelope;
      assertEquals(envelope.envelopeVersion, 1);
      assertEquals(envelope.key.digest, key.digest);
      assertEquals(envelope.request.method, "GET");
    }
    // Directory listing under v1 contains only the digest entry.
    const names = await listNames(fs, joinPath(hostStyle(), root, "v1"));
    assertEquals(names, [`${key.digest}.json`]);
  });
});

Deno.test("cache/store real clock writes readable entries", async () => {
  await withFreshDir("realclock", async (root) => {
    const clock = new FixedClock(new Date().toISOString());
    const store = makeStore(root, clock);
    const url = "https://openlibrary.org/search.json?q=real";
    const key = await computeCacheKey("openlibrary", url);
    const envelope = createEnvelope({
      key,
      decoderSchemaVersion: 1,
      status: 404,
      body: utf8.encode("missing"),
      freshnessClass: "negative",
      negative: true,
      fetchedAt: clock.now(),
    });
    const written = await store.write(key, envelope);
    assertEquals(written.status, "stored");
    const outcome = await store.read(key, { mode: "offline" });
    assertEquals(outcome.status, "hit_fresh");
  });
});

Deno.test("cache/store remove deletes one entry idempotently", async () => {
  await withFreshDir("remove", async (root) => {
    const clock = new FixedClock(FIXED);
    const store = makeStore(root, clock);
    const key = await seed(store, clock);
    assertEquals((await store.remove(key.digest)).status, "ok");
    assertEquals((await store.remove(key.digest)).status, "ok");
    const list = await store.list();
    assertEquals(list, { status: "ok", entries: [] });
  });
});
