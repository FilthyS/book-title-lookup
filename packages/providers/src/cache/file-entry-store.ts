/**
 * FileEntryStore: the private file-backed ResponseCache implementation
 * (issue #10 sections 7-15). One JSON envelope per SHA-256 digest beneath
 * `<cacheRoot>/v1`; writes are same-directory temp + flush + close + rename
 * with a bounded Windows rename-retry, corrupt entries are quarantined, and
 * no advisory locks exist anywhere.
 */

import type { CacheKey } from "./key.ts";
import {
  parseEnvelope,
  type RawResponseEnvelopeV1,
  serializeEnvelope,
  summarizeEntry,
  validateEnvelopeForRead,
} from "./envelope.ts";
import { type Clock, epochMsOf } from "./clock.ts";
import type { FileSystemSeam, FsResult } from "./fs-seam.ts";
import type { RandomSource } from "./random.ts";
import {
  canonicalPath,
  isPathWithin,
  joinPath,
  styleFromPlatform,
} from "../platform/paths.ts";
import { detectPlatformKind, type PlatformKind } from "../platform/platform.ts";
import type {
  CacheClearOutcome,
  CacheListOutcome,
  CacheMutationOutcome,
  CacheReadOptions,
  CacheReadOutcome,
  CacheReclaimOutcome,
  CacheRemoveOutcome,
  CacheShowOutcome,
  CacheWriteOutcome,
  ProviderId,
  ResponseCache,
} from "./store.ts";
import process from "node:process";

const LIVE_ENTRY = /^[0-9a-f]{64}\.json$/;
const TEMP_SUFFIX = ".tmp";

export interface FileEntryStoreOptions {
  readonly cacheRoot: string;
  readonly clock: Clock;
  readonly fs: FileSystemSeam;
  readonly random: RandomSource;
  readonly decoderSchemaVersions: Readonly<Record<ProviderId, number>>;
  readonly platform?: PlatformKind;
  readonly tempReclaimOlderThanMs?: number;
  readonly renameRetry?: {
    readonly attempts: number;
    readonly baseDelayMs: number;
  };
}

export class FileEntryStore implements ResponseCache {
  readonly #root: string;
  readonly #clock: Clock;
  readonly #fs: FileSystemSeam;
  readonly #random: RandomSource;
  readonly #decoderSchemaVersions: Readonly<Record<ProviderId, number>>;
  readonly #platform: PlatformKind;
  readonly #style: "posix" | "windows";
  readonly #tempReclaimOlderThanMs: number;
  readonly #renameRetry: {
    readonly attempts: number;
    readonly baseDelayMs: number;
  };

  constructor(options: FileEntryStoreOptions) {
    const platform = options.platform ?? detectPlatformKind(process.platform);
    this.#platform = platform;
    this.#style = styleFromPlatform(platform);
    this.#root = canonicalPath(options.cacheRoot, this.#style);
    this.#clock = options.clock;
    this.#fs = options.fs;
    this.#random = options.random;
    this.#decoderSchemaVersions = options.decoderSchemaVersions;
    this.#tempReclaimOlderThanMs = options.tempReclaimOlderThanMs ?? 60_000;
    this.#renameRetry = options.renameRetry ?? { attempts: 5, baseDelayMs: 25 };
  }

  get cacheRoot(): string {
    return this.#root;
  }

  #v1Dir(): string {
    return joinPath(this.#style, this.#root, "v1");
  }

  #quarantineDir(): string {
    return joinPath(this.#style, this.#v1Dir(), "quarantine");
  }

  #livePath(digest: string): string {
    return joinPath(this.#style, this.#v1Dir(), `${digest}.json`);
  }

  #guard(path: string): void {
    if (!isPathWithin(this.#root, path, this.#style)) {
      throw new RangeError(`path escapes cache root: ${path}`);
    }
  }

  #sep(): string {
    return this.#style === "windows" ? "\\" : "/";
  }

  async read(
    key: CacheKey,
    options: CacheReadOptions,
  ): Promise<CacheReadOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const path = this.#livePath(key.digest);
    this.#guard(path);
    const readResult = await this.#fs.readTextFile(path);
    if (!readResult.ok) {
      if (readResult.error === "not_found") return { status: "miss" };
      if (readResult.error === "permission_denied") {
        return { status: "permission_denied", path };
      }
      return { status: "miss" };
    }

    const parsed = parseEnvelope(readResult.text);
    if (!parsed.ok) {
      const quarantinedTo = await this.#quarantine(key.digest, path);
      return { status: "corrupt", ...(quarantinedTo ? { quarantinedTo } : {}) };
    }

    const validation = await validateEnvelopeForRead(parsed.envelope, {
      expectedDigest: key.digest,
      decoderSchemaVersions: this.#decoderSchemaVersions,
    });
    if (!validation.ok) {
      const quarantinedTo = await this.#quarantine(key.digest, path);
      return { status: "corrupt", ...(quarantinedTo ? { quarantinedTo } : {}) };
    }

    const envelope = parsed.envelope;
    const now = this.#clock.now();
    const stale = epochMsOf(now) >= epochMsOf(envelope.freshness.freshUntil);
    if (envelope.freshness.negative) {
      if (stale) {
        // Stale negatives never answer; remove opportunistically.
        await this.#fs.remove(path);
        return { status: "miss" };
      }
      return { status: "hit_fresh", envelope };
    }
    if (!stale) return { status: "hit_fresh", envelope };
    if (options.mode === "offline") {
      return {
        status: "hit_stale",
        envelope,
        staleSince: envelope.freshness.freshUntil,
      };
    }
    return { status: "miss" };
  }

  async write(
    key: CacheKey,
    envelope: RawResponseEnvelopeV1,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheWriteOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    if (envelope.key.digest !== key.digest) {
      throw new RangeError("envelope digest does not match key digest");
    }
    const finalPath = this.#livePath(key.digest);
    this.#guard(finalPath);
    const dirResult = await this.#fs.mkdir(this.#v1Dir(), {
      recursive: true,
      mode: 0o700,
    });
    if (!dirResult.ok) {
      if (dirResult.error === "permission_denied") {
        return { status: "permission_denied", path: this.#v1Dir() };
      }
      return { status: "unsupported_environment" };
    }

    const tempName = `${key.digest}.${this.#random.hex(8)}${TEMP_SUFFIX}`;
    const tempPath = joinPath(this.#style, this.#v1Dir(), tempName);
    this.#guard(tempPath);
    const text = serializeEnvelope(envelope);

    const openResult = await this.#fs.openForWrite(tempPath);
    if (!openResult.ok) return this.#writeFailure(openResult.error, tempPath);
    const handle = openResult.handle;
    try {
      await handle.write(text);
      await handle.sync();
    } catch {
      // Best effort cleanup; an orphaned temp is reclaimed later.
      try {
        await handle.close();
      } catch {
        // ignore
      }
      await this.#fs.remove(tempPath);
      return { status: "cancelled" };
    }
    await handle.close();

    if (options.signal?.aborted) {
      await this.#fs.remove(tempPath);
      return { status: "cancelled" };
    }

    const renameOutcome = await this.#renameWithRetry(
      tempPath,
      finalPath,
      options.signal,
    );
    if (renameOutcome.status !== "stored") return renameOutcome;
    return { status: "stored" };
  }

  async #renameWithRetry(
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<CacheWriteOutcome> {
    let lastError: FsResult = { ok: false, error: "other" };
    for (let attempt = 0; attempt < this.#renameRetry.attempts; attempt++) {
      if (signal?.aborted) {
        await this.#fs.remove(from);
        return { status: "cancelled" };
      }
      const result = await this.#fs.rename(from, to);
      if (result.ok) return { status: "stored" };
      lastError = result;
      if (
        this.#platform === "windows" &&
        attempt < this.#renameRetry.attempts - 1
      ) {
        const jitter = this.#random.int(this.#renameRetry.baseDelayMs + 1);
        await new Promise((resolve) => setTimeout(resolve, jitter));
      } else {
        break;
      }
    }
    await this.#fs.remove(from);
    return this.#writeFailure(lastError.error ?? "other", to);
  }

  #writeFailure(
    error: "not_found" | "permission_denied" | "other",
    path: string,
  ): CacheWriteOutcome {
    if (error === "permission_denied") {
      return { status: "permission_denied", path };
    }
    // The typed failure surface of the port has no generic slot; every
    // persistent storage failure maps to the configuration/permission class.
    return { status: "permission_denied", path };
  }

  #mutationForFs(result: FsResult, path: string): CacheMutationOutcome {
    if (result.ok) return { status: "ok" };
    if (result.error === "permission_denied") {
      return { status: "permission_denied", path };
    }
    return { status: "unsupported_environment" };
  }

  async list(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheListOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const v1 = this.#v1Dir();
    this.#guard(v1);
    const listed = await this.#fs.listDirectory(v1);
    if (!listed.ok) {
      if (listed.error === "not_found") return { status: "ok", entries: [] };
      if (listed.error === "permission_denied") {
        return { status: "permission_denied", path: v1 };
      }
      return { status: "ok", entries: [] };
    }
    const entries = [];
    for (const name of listed.names) {
      if (!LIVE_ENTRY.test(name)) continue;
      if (options.signal?.aborted) return { status: "cancelled" };
      const digest = name.slice(0, 64);
      const path = joinPath(this.#style, v1, name);
      const textResult = await this.#fs.readTextFile(path);
      if (!textResult.ok) continue;
      const parsed = parseEnvelope(textResult.text);
      if (!parsed.ok) continue;
      const validation = await validateEnvelopeForRead(parsed.envelope, {
        expectedDigest: digest,
        decoderSchemaVersions: this.#decoderSchemaVersions,
      });
      if (!validation.ok) continue;
      entries.push(summarizeEntry(parsed.envelope, this.#clock.now()));
    }
    entries.sort((a, b) =>
      a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0,
    );
    return { status: "ok", entries };
  }

  async show(
    digest: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheShowOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const path = this.#livePath(digest);
    this.#guard(path);
    const readResult = await this.#fs.readTextFile(path);
    if (!readResult.ok) {
      if (readResult.error === "not_found") {
        return { status: "not_found", digest };
      }
      if (readResult.error === "permission_denied") {
        return { status: "permission_denied", path };
      }
      return { status: "not_found", digest };
    }
    const parsed = parseEnvelope(readResult.text);
    if (!parsed.ok) {
      const quarantinedTo = await this.#quarantine(digest, path);
      return { status: "corrupt", ...(quarantinedTo ? { quarantinedTo } : {}) };
    }
    const validation = await validateEnvelopeForRead(parsed.envelope, {
      expectedDigest: digest,
      decoderSchemaVersions: this.#decoderSchemaVersions,
    });
    if (!validation.ok) {
      const quarantinedTo = await this.#quarantine(digest, path);
      return { status: "corrupt", ...(quarantinedTo ? { quarantinedTo } : {}) };
    }
    return { status: "ok", entry: parsed.envelope };
  }

  async remove(
    digest: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheRemoveOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const path = this.#livePath(digest);
    this.#guard(path);
    const removed = await this.#fs.remove(path);
    if (removed.ok) return { status: "ok" };
    if (removed.error === "not_found") return { status: "ok" };
    return this.#mutationForFs(removed, path);
  }

  async clear(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheClearOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const v1 = this.#v1Dir();
    this.#guard(v1);
    const files = await this.#collectFiles(v1, options.signal);
    if (files === "permission_denied") {
      return { status: "permission_denied", path: v1 };
    }
    if (files === "cancelled") return { status: "cancelled" };
    let removedEntries = 0;
    let removedBytes = 0;
    for (const file of files) {
      if (options.signal?.aborted) return { status: "cancelled" };
      const stat = await this.#fs.stat(file);
      if (stat.ok) removedBytes += stat.stat.size;
      const removed = await this.#fs.remove(file);
      if (removed.ok || removed.error === "not_found") {
        removedEntries += 1;
      } else if (removed.error === "permission_denied") {
        return { status: "permission_denied", path: file };
      }
    }
    return { status: "ok", removedEntries, removedBytes };
  }

  async reclaim(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CacheReclaimOutcome> {
    if (options.signal?.aborted) return { status: "cancelled" };
    const v1 = this.#v1Dir();
    this.#guard(v1);
    const files = await this.#collectFiles(v1, options.signal);
    if (files === "permission_denied") {
      return { status: "permission_denied", path: v1 };
    }
    if (files === "cancelled") return { status: "cancelled" };
    const now = epochMsOf(this.#clock.now());
    let removedTemps = 0;
    for (const file of files) {
      if (options.signal?.aborted) return { status: "cancelled" };
      const name = file.split(this.#sep()).pop() ?? file;
      const stat = await this.#fs.stat(file);
      const isTemp = name.endsWith(TEMP_SUFFIX);
      if (
        isTemp &&
        stat.ok &&
        now - stat.stat.mtimeMs >= this.#tempReclaimOlderThanMs
      ) {
        const removed = await this.#fs.remove(file);
        if (removed.ok || removed.error === "not_found") removedTemps += 1;
      }
    }
    return { status: "ok", removedTemps };
  }

  async #collectFiles(
    dir: string,
    signal?: AbortSignal,
  ): Promise<string[] | "permission_denied" | "cancelled"> {
    if (signal?.aborted) return "cancelled";
    const listed = await this.#fs.listDirectory(dir);
    if (!listed.ok) {
      if (listed.error === "not_found") return [];
      if (listed.error === "permission_denied") return "permission_denied";
      return [];
    }
    const files: string[] = [];
    for (const name of listed.names) {
      if (signal?.aborted) return "cancelled";
      const child = joinPath(this.#style, dir, name);
      this.#guard(child);
      const stat = await this.#fs.stat(child);
      if (stat.ok && stat.stat.kind === "dir") {
        const nested = await this.#collectFiles(child, signal);
        if (nested === "permission_denied" || nested === "cancelled") {
          return nested;
        }
        files.push(...nested);
      } else if (stat.ok) {
        files.push(child);
      }
    }
    return files;
  }

  async #quarantine(
    digest: string,
    sourcePath: string,
  ): Promise<string | undefined> {
    const quarantineDir = this.#quarantineDir();
    this.#guard(quarantineDir);
    const mkdir = await this.#fs.mkdir(quarantineDir, {
      recursive: true,
      mode: 0o700,
    });
    if (!mkdir.ok) return undefined;
    const name = `${digest}.${epochMsOf(this.#clock.now())}.${this.#random.hex(
      4,
    )}.json`;
    const target = joinPath(this.#style, quarantineDir, name);
    this.#guard(target);
    const moved = await this.#fs.rename(sourcePath, target);
    if (moved.ok) return target;
    // If the move fails, delete rather than leave the corrupt entry live.
    await this.#fs.remove(sourcePath);
    return undefined;
  }
}
