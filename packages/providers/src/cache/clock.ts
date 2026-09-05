/**
 * Deterministic clock seam (issue #10 section 18). "Now" for the cache and
 * settings seams flows exclusively through a Clock so freshness fixtures are
 * deterministic. Instants are ISO-8601 UTC with millisecond precision.
 */

export type Instant = string;

export interface Clock {
  now(): Instant;
}

export const systemClock: Clock = {
  now(): Instant {
    return new Date().toISOString();
  },
};

export function epochMsOf(instant: Instant): number {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) {
    throw new RangeError(`invalid instant: ${instant}`);
  }
  return ms;
}

export function addMillis(instant: Instant, millis: number): Instant {
  return new Date(epochMsOf(instant) + millis).toISOString();
}

export function isBeforeOrEqual(a: Instant, b: Instant): boolean {
  return epochMsOf(a) <= epochMsOf(b);
}

export function isValidInstant(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms);
}

/** A fixed clock for fixtures; `now` can be advanced explicitly. */
export class FixedClock implements Clock {
  #current: Instant;

  constructor(start: Instant) {
    this.#current = start;
    if (!isValidInstant(start)) {
      throw new RangeError(`invalid start instant: ${start}`);
    }
  }

  now(): Instant {
    return this.#current;
  }

  advance(millis: number): void {
    this.#current = addMillis(this.#current, millis);
  }
}
