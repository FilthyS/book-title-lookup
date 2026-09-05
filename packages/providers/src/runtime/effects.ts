/**
 * Runtime effects (issue #8 section "Runtime effects: clock, randomness, and
 * delay"). Time, randomness, and abortable delay are injected so every
 * budget, backoff, retry, and rate-spacing policy is deterministic under
 * test. Production defaults use Date.now, Math.random, and setTimeout; tests
 * inject fakes and never rely on real timers.
 */

/** The narrow effects seam the ProviderRuntime depends on. */
export interface RuntimeEffects {
  /** Epoch milliseconds. Drives budgets, Retry-After, and spacing. */
  now(): number;
  /** Uniform [0, 1). Drives retry jitter and spacing decisions. */
  random(): number;
  /** Sleep that aborts promptly when the signal fires. */
  delay(ms: number, signal?: AbortSignal): Promise<void>;
}

function sleepWithAbort(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, Math.max(0, ms));
    if (signal !== undefined) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }
  });
}

/** Production effects. */
export const systemEffects: RuntimeEffects = {
  now(): number {
    return Date.now();
  },
  random(): number {
    return Math.random();
  },
  delay(ms: number, signal?: AbortSignal): Promise<void> {
    return sleepWithAbort(ms, signal);
  },
};
