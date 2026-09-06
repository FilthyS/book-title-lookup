/**
 * Retry/backoff helpers (issue #8 section 5). Pure math only: the runtime
 * decides eligibility and budgets; these functions compute delays.
 */

/**
 * Exponential backoff with full jitter:
 * `delay = random() * min(maxBackoffMs, baseBackoffMs * 2^attempt)`.
 * `attempt` is the zero-based number of the *next* attempt after the first
 * (so the first retry uses `2^0`).
 */
export function jitteredBackoffDelayMs(
  baseBackoffMs: number,
  maxBackoffMs: number,
  attempt: number,
  random: number,
): number {
  const cap = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, attempt));
  return Math.floor(random * cap);
}

/** True when an HTTP status is a retryable server error (502/503/504). */
export function isRetryableServerStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** True when an HTTP status is a retryable redirect. */
export function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/** Parse a Retry-After header: an HTTP-date or seconds since now. Returns
 *  undefined when the value is absent or unparseable. */
export function parseRetryAfterSeconds(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^[0-9]+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed));
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - nowMs) / 1000));
}

export interface RetryDecision {
  readonly retry: boolean;
  /** Delay in ms to honor before the next attempt (undefined = immediate
   *  eligibility is decided by the runtime's backoff/spacing policy). */
  readonly delayMs?: number;
  /** True when the caller should NOT retry because it was rate limited
   *  without a usable Retry-After or with an unaffordable wait. */
  readonly rateLimited: boolean;
}

/**
 * Decide whether a 429 response can be retried and with what delay.
 * A Retry-After replaces the computed backoff; without one the response is
 * rate-limited with no automatic retry. `budgetRemainingMs` gates whether
 * the wait can be afforded.
 */
export function retryAfterDecision(
  retryAfterHeader: string | null,
  nowMs: number,
  budgetRemainingMs: number,
): RetryDecision {
  const seconds = parseRetryAfterSeconds(retryAfterHeader, nowMs);
  if (seconds === undefined) {
    return { retry: false, rateLimited: true };
  }
  const waitMs = seconds * 1000;
  if (waitMs > budgetRemainingMs) {
    return { retry: false, rateLimited: true, delayMs: waitMs };
  }
  return { retry: true, rateLimited: false, delayMs: waitMs };
}
