/**
 * Randomness seam (issue #10 section 18). Temp names, quarantine names, and
 * Windows rename-retry jitter are the only randomness-dependent behaviors and
 * they are injected so fixture tests are deterministic.
 */

import { randomBytes, randomInt } from "node:crypto";

export interface RandomSource {
  /** Returns a lowercase hex string of `bytes` random bytes. */
  hex(bytes: number): string;
  /** Returns an integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export const systemRandomSource: RandomSource = {
  hex(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  },
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return randomInt(maxExclusive);
  },
};

/** A scripted random source for fixtures. */
export class FixedRandomSource implements RandomSource {
  #hexValue: string;
  #intValue: number;

  constructor(options: { readonly hex?: string; readonly int?: number } = {}) {
    this.#hexValue = options.hex ?? "00";
    this.#intValue = options.int ?? 0;
  }

  hex(_bytes: number): string {
    return this.#hexValue;
  }

  int(_maxExclusive: number): number {
    return this.#intValue;
  }
}
