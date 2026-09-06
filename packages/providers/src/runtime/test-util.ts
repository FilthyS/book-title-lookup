/**
 * Deterministic test harness for the provider runtime: fake effects, a
 * scripted fetch transport, and an in-memory cache so contract tests never
 * use real timers, files, or live services.
 */

import type { RuntimeEffects } from "./effects.ts";
import type { RawResponseEnvelopeV1 } from "../cache/envelope.ts";
import type { CacheKey } from "../cache/key.ts";
import type {
  CacheReadOutcomeForRuntime,
  CacheWriteOutcomeForRuntime,
  RuntimeCachePort,
} from "./types.ts";

export const FIXED_START_MS = Date.parse("2026-09-05T00:00:00.000Z");

export interface FakeEffectsOptions {
  readonly startMs?: number;
  readonly random?: number;
}

export class FakeEffects implements RuntimeEffects {
  #nowMs: number;
  readonly #random: number;
  readonly delays: readonly number[];
  #delayLog: number[] = [];

  constructor(options: FakeEffectsOptions = {}) {
    this.#nowMs = options.startMs ?? FIXED_START_MS;
    this.#random = options.random ?? 0.5;
    this.delays = this.#delayLog;
  }

  now(): number {
    return this.#nowMs;
  }

  random(): number {
    return this.#random;
  }

  async delay(ms: number, _signal?: AbortSignal): Promise<void> {
    await Promise.resolve();
    this.#delayLog.push(Math.max(0, ms));
    // Deterministic: delays resolve immediately; callers never wait on a
    // real timer.
  }
  advance(ms: number): void {
    this.#nowMs += ms;
  }
}

export interface ScriptedResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly bytes?: Uint8Array;
}

export interface ScriptedFetchOptions {
  /** Called once per fetch with the URL and caller headers. */
  readonly onRequest?: (url: string, init?: RequestInit) => void;
  /** Responses chosen by index for repeated calls to the same URL. */
  readonly byUrl?: Readonly<
    Record<string, ScriptedResponse | readonly ScriptedResponse[]>
  >;
  /** Fallback handler when no byUrl entry matches. */
  readonly fallback?: (url: string) => ScriptedResponse;
}

/** A fetch implementation whose per-URL responses are scripted. */
export function scriptedFetch(options: ScriptedFetchOptions): typeof fetch {
  const callsByUrl = new Map<string, number>();
  return async function fetchLike(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    await Promise.resolve();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    options.onRequest?.(url, init);
    const index = callsByUrl.get(url) ?? 0;
    callsByUrl.set(url, index + 1);
    const entry = options.byUrl?.[url];
    let scripted: ScriptedResponse;
    if (entry === undefined) {
      if (options.fallback === undefined) {
        throw new TypeError(`no scripted response for ${url}`);
      }
      scripted = options.fallback(url);
    } else if (Array.isArray(entry)) {
      const chosen = entry[Math.min(index, entry.length - 1)];
      scripted = chosen;
    } else {
      scripted = entry as ScriptedResponse;
    }
    const headers = new Headers(scripted.headers ?? {});
    if (scripted.bytes !== undefined) {
      return new Response(scripted.bytes as unknown as BodyInit, {
        status: scripted.status,
        headers,
      });
    }
    return new Response(scripted.body ?? "", {
      status: scripted.status,
      headers,
    });
  };
}

/** Tracks how many times each URL was requested. */
export function requestRecorder(): {
  readonly urls: string[];
  readonly count: (url: string) => number;
  readonly total: number;
} {
  const urls: string[] = [];
  return {
    get urls() {
      return urls;
    },
    count(url: string): number {
      return urls.filter((entry) => entry === url).length;
    },
    get total(): number {
      return urls.length;
    },
  };
}

/** In-memory ResponseCache over envelopes for fast hit/miss fixtures. */
export class MemoryCache implements RuntimeCachePort {
  readonly entries = new Map<string, RawResponseEnvelopeV1>();
  #nowMs: () => number;
  #corruptNext = new Set<string>();

  constructor(nowMs: () => number = () => Date.now()) {
    this.#nowMs = nowMs;
  }

  async read(
    key: CacheKey,
    options: { readonly mode: "online" | "offline" },
  ): Promise<CacheReadOutcomeForRuntime> {
    await Promise.resolve();
    if (this.#corruptNext.delete(key.digest)) {
      return { status: "corrupt" };
    }
    const envelope = this.entries.get(key.digest);
    if (envelope === undefined) return { status: "miss" };
    const freshUntilMs = Date.parse(envelope.freshness.freshUntil);
    const stale = this.#nowMs() >= freshUntilMs;
    if (envelope.freshness.negative) {
      if (stale) return { status: "miss" };
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
  ): Promise<CacheWriteOutcomeForRuntime> {
    await Promise.resolve();
    this.entries.set(key.digest, envelope);
    return { status: "stored" };
  }

  /** Simulate corruption: return `corrupt` on the next read, then miss. */
  corrupt(digest: string): void {
    this.#corruptNext.add(digest);
  }
}

/** A clock value advanced by the same fake effects instance. */
export function epochOf(instant: string): number {
  return Date.parse(instant);
}
