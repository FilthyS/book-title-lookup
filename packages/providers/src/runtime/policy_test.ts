/**
 * Pure helper tests for the runtime retry/backoff and redirect validation
 * math (issue #8 sections 4-5).
 */

import { assertEquals } from "@std/assert";
import {
  isRedirectStatus,
  isRetryableServerStatus,
  jitteredBackoffDelayMs,
  parseRetryAfterSeconds,
  retryAfterDecision,
} from "./backoff.ts";
import {
  isAllowlistedHost,
  resolveRedirectLocation,
  validateRequestUrl,
} from "./redirect.ts";

Deno.test("backoff full jitter is bounded by the exponential cap", () => {
  assertEquals(jitteredBackoffDelayMs(200, 2000, 0, 1.0), 200);
  assertEquals(jitteredBackoffDelayMs(200, 2000, 1, 1.0), 400);
  assertEquals(jitteredBackoffDelayMs(200, 2000, 2, 1.0), 800);
  assertEquals(jitteredBackoffDelayMs(200, 2000, 3, 1.0), 1600);
  assertEquals(jitteredBackoffDelayMs(200, 2000, 10, 1.0), 2000, "capped");
  assertEquals(jitteredBackoffDelayMs(200, 2000, 1, 0), 0);
});

Deno.test("retryable status classification", () => {
  assertEquals(isRetryableServerStatus(502), true);
  assertEquals(isRetryableServerStatus(503), true);
  assertEquals(isRetryableServerStatus(504), true);
  assertEquals(isRetryableServerStatus(500), false);
  assertEquals(isRetryableServerStatus(200), false);
  assertEquals(isRedirectStatus(301), true);
  assertEquals(isRedirectStatus(302), true);
  assertEquals(isRedirectStatus(200), false);
});

Deno.test("Retry-After seconds and date forms parse", () => {
  assertEquals(parseRetryAfterSeconds("5", 0), 5);
  assertEquals(parseRetryAfterSeconds(null, 0), undefined);
  assertEquals(parseRetryAfterSeconds("   ", 0), undefined);
  const date = new Date("2026-09-05T00:00:10.000Z");
  const parsed = parseRetryAfterSeconds(
    "Sat, 05 Sep 2026 00:00:10 GMT",
    date.getTime() - 7_000,
  );
  assertEquals(parsed, 7);
});

Deno.test("retry-after decision honors the budget", () => {
  assertEquals(retryAfterDecision("2", 0, 5_000), {
    retry: true,
    rateLimited: false,
    delayMs: 2000,
  });
  assertEquals(retryAfterDecision(null, 0, 5_000), {
    retry: false,
    rateLimited: true,
  });
  assertEquals(retryAfterDecision("2", 0, 1_000), {
    retry: false,
    rateLimited: true,
    delayMs: 2000,
  });
});

Deno.test("redirect allowlist is exact and https-only", () => {
  assertEquals(isAllowlistedHost("openlibrary.org", ["openlibrary.org"]), true);
  assertEquals(
    isAllowlistedHost("evil.openlibrary.org", ["openlibrary.org"]),
    false,
    "no suffix globbing",
  );
  assertEquals(
    resolveRedirectLocation(
      "https://openlibrary.org/a",
      "https://openlibrary.org/b",
      ["openlibrary.org"],
    ),
    { ok: true, to: "https://openlibrary.org/b" },
  );
  assertEquals(
    resolveRedirectLocation(
      "https://openlibrary.org/a",
      "https://evil.example.org/b",
      ["openlibrary.org"],
    ).ok,
    false,
  );
  assertEquals(
    resolveRedirectLocation(
      "https://openlibrary.org/a",
      "http://openlibrary.org/b",
      ["openlibrary.org"],
    ).ok,
    false,
  );
});

Deno.test("initial URL validation requires an allowlisted https host", () => {
  assertEquals(
    validateRequestUrl("https://openlibrary.org/a", ["openlibrary.org"]).ok,
    true,
  );
  assertEquals(
    validateRequestUrl("http://openlibrary.org/a", ["openlibrary.org"]).ok,
    false,
  );
  assertEquals(
    validateRequestUrl("https://evil.example.org/a", ["openlibrary.org"]).ok,
    false,
  );
});
