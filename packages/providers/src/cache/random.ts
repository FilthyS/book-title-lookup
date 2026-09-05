/**
 * Randomness seam (issue #10 section 18). Temp names, quarantine names, and
 * Windows rename-retry jitter are the only randomness-dependent behaviors and
 * they are injected so fixture tests are deterministic.
 */

export interface RandomSource {
  /** Returns a lowercase hex string of `bytes` random bytes. */
  hex(bytes: number): string;
  /** Returns an integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

const HEX_ALPHABET = "0123456789abcdef";

export const systemRandomSource: RandomSource = {
  hex(bytes: number): string {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    let out = "";
    for (const v of values) {
      out += HEX_ALPHABET[v >> 4] + HEX_ALPHABET[v & 0x0f];
    }
    return out;
  },
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % maxExclusive;
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
