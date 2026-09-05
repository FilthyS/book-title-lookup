/**
 * Per-source concurrency slot and spacing scheduler (issue #8 section 5).
 * One scheduler per source serializes slot acquisition and minimum spacing
 * so contract tests can assert the policy without real timers: waiting uses
 * the injected effects `delay`, so a fake effects instance makes everything
 * deterministic.
 */

import type { RuntimeEffects } from "./effects.ts";

export type SlotAcquireResult = "acquired" | "cancelled";

interface Waiter {
  readonly signal: AbortSignal | undefined;
  readonly resolve: (result: SlotAcquireResult) => void;
  readonly onAbort: () => void;
}

export class SourceScheduler {
  readonly #effects: RuntimeEffects;
  readonly #maxConcurrent: number;
  readonly #minSpacingMs: number;
  #active = 0;
  #lastRequestMs = Number.NEGATIVE_INFINITY;
  #waiters: Waiter[] = [];

  constructor(
    effects: RuntimeEffects,
    maxConcurrent: number,
    minSpacingMs: number,
  ) {
    this.#effects = effects;
    this.#maxConcurrent = Math.max(1, maxConcurrent);
    this.#minSpacingMs = Math.max(0, minSpacingMs);
  }

  get active(): number {
    return this.#active;
  }

  /** Wait for a free concurrency slot, abortably. */
  async acquire(signal?: AbortSignal): Promise<SlotAcquireResult> {
    if (signal?.aborted) return "cancelled";
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1;
      return "acquired";
    }
    return await new Promise<SlotAcquireResult>((resolve) => {
      const onAbort = (): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        resolve("cancelled");
      };
      const waiter: Waiter = { signal, resolve, onAbort };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  /** Release a slot and admit the next waiter. */
  release(): void {
    this.#active = Math.max(0, this.#active - 1);
    const next = this.#waiters.shift();
    if (next !== undefined) {
      next.signal?.removeEventListener("abort", next.onAbort);
      this.#active += 1;
      next.resolve("acquired");
    }
  }

  /** Wait until `minSpacingMs` has elapsed since the last request start. */
  async waitSpacing(signal?: AbortSignal): Promise<"waited" | "cancelled"> {
    if (signal?.aborted) return "cancelled";
    const elapsed = this.#effects.now() - this.#lastRequestMs;
    const waitMs = this.#minSpacingMs - elapsed;
    if (waitMs > 0) await this.#effects.delay(waitMs, signal);
    if (signal?.aborted) return "cancelled";
    return "waited";
  }

  /** Record that a request starts now (drives the spacing gate). */
  markRequested(): void {
    this.#lastRequestMs = this.#effects.now();
  }
}
