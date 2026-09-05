/**
 * ProviderRuntime: the deep transport module (issue #8 decisions 1-8).
 *
 * Executes typed request plans and owns HTTP execution, redirect resolution,
 * host allowlisting, per-source rate limiting and concurrency, bounded retry
 * with jitter, Retry-After, per-source deadline budgeting, cancellation
 * propagation, raw-response capture, cache read-through/write-through, and
 * transport failure classification. Providers never wrap this module in
 * per-stage decorators.
 *
 * Cache write rules follow issue #10 sections 8-9: terminal successes,
 * definitive negatives (404/410 or a decoder-marked empty result), and
 * deterministic redirect maps are cacheable; failures, retries, 429s, 422s,
 * and malformed bodies are never cached.
 */

import type { SourceFailure, SourceWarning } from "../../../core/src/domain.ts";
import { type CacheKey, computeCacheKey } from "../cache/key.ts";
import {
  createEnvelope,
  type RawResponseEnvelopeV1,
} from "../cache/envelope.ts";
import type { RuntimeEffects } from "./effects.ts";
import {
  isRedirectStatus,
  isRetryableServerStatus,
  jitteredBackoffDelayMs,
  retryAfterDecision,
} from "./backoff.ts";
import { resolveRedirectLocation, validateRequestUrl } from "./redirect.ts";
import { SourceScheduler } from "./schedule.ts";
import type {
  RequestPlan,
  ResponseMeta,
  RunOutcome,
  RuntimeCachePort,
  RuntimeConfig,
  RuntimeOperation,
  RuntimeRequestOptions,
  TransportEnvelope,
} from "./types.ts";

interface HttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly location: string | null;
  readonly retryAfter: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly body: Uint8Array;
}

type AttemptResult =
  | { readonly kind: "http"; readonly response: HttpResponse }
  | { readonly kind: "failure"; readonly failure: SourceFailure }
  | { readonly kind: "cancelled" }
  | { readonly kind: "timeout" };

type ResolveResult =
  | { readonly kind: "terminal"; readonly state: TerminalState }
  | { readonly kind: "failure"; readonly failure: SourceFailure }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" };

interface TerminalState {
  readonly envelope?: RawResponseEnvelopeV1;
  readonly response?: HttpResponse;
  readonly servedFromCache: boolean;
  readonly stale: boolean;
  readonly finalUrl: string;
}

interface ExecuteContext {
  readonly plan: RequestPlan<unknown>;
  readonly mode: "online" | "offline";
  readonly signal?: AbortSignal;
  readonly deadlineMs: number;
  readonly requestedUrl: string;
  readonly redirects: { readonly from: string; readonly to: string }[];
  readonly warnings: SourceWarning[];
}

export class ProviderRuntime {
  readonly #effects: RuntimeEffects;
  readonly #cache: RuntimeCachePort;
  readonly #config: RuntimeConfig;
  readonly #scheduler: SourceScheduler;

  constructor(
    effects: RuntimeEffects,
    cache: RuntimeCachePort,
    config: RuntimeConfig,
  ) {
    this.#effects = effects;
    this.#cache = cache;
    this.#config = config;
    this.#scheduler = new SourceScheduler(
      effects,
      config.maxConcurrent,
      config.minSpacingMs,
    );
  }

  async execute<D>(
    plan: RequestPlan<D>,
    options: RuntimeRequestOptions = {},
  ): Promise<RunOutcome<D>> {
    const mode = options.mode ?? "online";
    const budgetMs = options.sourceBudgetMs ?? this.#config.sourceBudgetMs;
    const deadlineMs = this.#effects.now() + Math.max(1, budgetMs);
    return await this.#executeWithin(plan, mode, options.signal, deadlineMs);
  }

  /**
   * Bind multiple request plans to one source-operation deadline. Source
   * workflows must use this for redirects and pagination rather than granting
   * every plan a fresh budget.
   */
  beginOperation(
    options: RuntimeRequestOptions = {},
  ): RuntimeOperation {
    const mode = options.mode ?? "online";
    const budgetMs = options.sourceBudgetMs ?? this.#config.sourceBudgetMs;
    const deadlineMs = this.#effects.now() + Math.max(1, budgetMs);
    return {
      execute: <D>(plan: RequestPlan<D>): Promise<RunOutcome<D>> =>
        this.#executeWithin(plan, mode, options.signal, deadlineMs),
    };
  }

  async #executeWithin<D>(
    plan: RequestPlan<D>,
    mode: "online" | "offline",
    signal: AbortSignal | undefined,
    deadlineMs: number,
  ): Promise<RunOutcome<D>> {
    if (signal?.aborted) return { kind: "cancelled" };
    const context: ExecuteContext = {
      plan: plan as RequestPlan<unknown>,
      mode,
      signal,
      deadlineMs,
      requestedUrl: plan.url,
      redirects: [],
      warnings: [],
    };

    const validation = validateRequestUrl(plan.url, this.#config.hosts);
    if (!validation.ok) {
      return {
        kind: "source_failure",
        failure: this.#failure("unavailable", {
          url: plan.url,
          reason: validation.reason ?? "invalid_url",
        }),
      };
    }

    const result = await this.#resolveUntilTerminal(context, plan.url, 0);
    if (result.kind === "cancelled") return { kind: "cancelled" };
    if (result.kind === "failure") {
      return { kind: "source_failure", failure: result.failure };
    }
    if (result.kind === "timeout") {
      return {
        kind: "source_failure",
        failure: this.#failure("timeout", {
          url: context.requestedUrl,
          reason: "source_budget_exhausted",
        }),
      };
    }
    return await this.#finalize<D>(context, result.state);
  }

  // -------------------------------------------------------------------------
  // Terminal resolution: cache-first, then online attempts with redirects
  // -------------------------------------------------------------------------

  async #resolveUntilTerminal(
    context: ExecuteContext,
    currentUrl: string,
    hop: number,
  ): Promise<ResolveResult> {
    if (context.signal?.aborted) return { kind: "cancelled" };
    if (this.#effects.now() >= context.deadlineMs) {
      return { kind: "timeout" };
    }

    if (context.plan.cacheClass !== undefined) {
      const cached = await this.#cacheStep(context, currentUrl);
      if (cached.kind === "cancelled") return { kind: "cancelled" };
      if (cached.kind === "failure") {
        return { kind: "failure", failure: cached.failure };
      }
      if (cached.kind === "terminal") {
        return { kind: "terminal", state: cached.state };
      }
      if (cached.kind === "next") {
        if (hop >= this.#config.maxRedirects) {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url: currentUrl,
              reason: "redirect_limit",
            }),
          };
        }
        return await this.#resolveUntilTerminal(context, cached.url, hop + 1);
      }
      // miss: fall through to fetch below.
    }

    if (context.mode === "offline") {
      return {
        kind: "failure",
        failure: this.#failure("unavailable", {
          url: currentUrl,
          reason: "offline_no_cache",
        }),
      };
    }

    return await this.#attemptUrl(context, currentUrl, hop);
  }

  async #cacheStep(
    context: ExecuteContext,
    currentUrl: string,
  ): Promise<
    | { readonly kind: "cancelled" }
    | { readonly kind: "failure"; readonly failure: SourceFailure }
    | { readonly kind: "terminal"; readonly state: TerminalState }
    | { readonly kind: "next"; readonly url: string }
    | { readonly kind: "miss" }
  > {
    const key = await this.#cacheKey(currentUrl);
    const read = await this.#cache.read(key, {
      mode: context.mode,
      signal: context.signal,
    });
    switch (read.status) {
      case "cancelled":
        return { kind: "cancelled" };
      case "permission_denied":
        context.warnings.push(
          this.#warning("unavailable", {
            url: currentUrl,
            reason: "cache_permission_denied",
          }),
        );
        if (context.mode === "offline") {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url: currentUrl,
              reason: "offline_no_cache",
            }),
          };
        }
        return { kind: "miss" };
      case "unsupported_environment":
        context.warnings.push(
          this.#warning("unavailable", {
            url: currentUrl,
            reason: "cache_unsupported_environment",
          }),
        );
        if (context.mode === "offline") {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url: currentUrl,
              reason: "offline_no_cache",
            }),
          };
        }
        return { kind: "miss" };
      case "corrupt": {
        context.warnings.push(
          this.#warning("decode", {
            url: currentUrl,
            reason: "corrupt_cache_entry",
          }),
        );
        if (context.mode === "offline") {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url: currentUrl,
              reason: "offline_no_cache",
            }),
          };
        }
        return { kind: "miss" };
      }
      case "miss":
        return { kind: "miss" };
      case "hit_fresh":
      case "hit_stale": {
        const envelope = read.envelope;
        const state: TerminalState = {
          envelope,
          servedFromCache: true,
          stale: read.status === "hit_stale",
          finalUrl: currentUrl,
        };
        const location = envelope.response.location;
        if (
          isRedirectStatus(envelope.response.status) && location !== undefined
        ) {
          const resolved = this.#followRedirect(currentUrl, location);
          if (!resolved.ok) {
            return {
              kind: "failure",
              failure: this.#failure("unavailable", {
                url: currentUrl,
                reason: resolved.reason ?? "redirect_not_allowed",
              }),
            };
          }
          context.redirects.push({ from: currentUrl, to: resolved.to });
          return { kind: "next", url: resolved.to };
        }
        return { kind: "terminal", state };
      }
    }
  }

  #followRedirect(
    currentUrl: string,
    location: string,
  ): { readonly ok: true; readonly to: string } | {
    readonly ok: false;
    readonly reason: string;
  } {
    return resolveRedirectLocation(currentUrl, location, this.#config.hosts);
  }

  // -------------------------------------------------------------------------
  // Online fetch attempts for one URL
  // -------------------------------------------------------------------------

  async #attemptUrl(
    context: ExecuteContext,
    url: string,
    hop: number,
  ): Promise<ResolveResult> {
    let attempt = 0;
    while (true) {
      if (context.signal?.aborted) return { kind: "cancelled" };
      if (this.#effects.now() >= context.deadlineMs) {
        return { kind: "timeout" };
      }

      const attemptResult = await this.#fetchOnce(context, url);
      if (attemptResult.kind === "cancelled") return { kind: "cancelled" };
      if (attemptResult.kind === "timeout") return { kind: "timeout" };
      if (attemptResult.kind === "failure") {
        return { kind: "failure", failure: attemptResult.failure };
      }

      const response = attemptResult.response;
      if (isRedirectStatus(response.status) && response.location !== null) {
        if (hop >= this.#config.maxRedirects) {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url,
              reason: "redirect_limit",
            }),
          };
        }
        const resolved = this.#followRedirect(url, response.location);
        if (!resolved.ok) {
          return {
            kind: "failure",
            failure: this.#failure("unavailable", {
              url,
              reason: resolved.reason ?? "redirect_not_allowed",
            }),
          };
        }
        if (context.plan.cacheClass !== undefined) {
          await this.#writeRedirectEnvelope(context, url, response);
        }
        context.redirects.push({ from: url, to: resolved.to });
        if (context.signal?.aborted) return { kind: "cancelled" };
        return await this.#resolveUntilTerminal(context, resolved.to, hop + 1);
      }

      const eligibility = this.#classifyStatus(response.status);
      if (eligibility === "rate_limited") {
        const decision = retryAfterDecision(
          response.retryAfter,
          this.#effects.now(),
          context.deadlineMs - this.#effects.now(),
        );
        if (attempt < this.#config.maxRetries && decision.retry) {
          await this.#sleepAbortable(context, decision.delayMs ?? 0);
          if (context.signal?.aborted) return { kind: "cancelled" };
          attempt += 1;
          continue;
        }
        return {
          kind: "failure",
          failure: this.#failure("rate_limited", {
            url,
            retryAfter: response.retryAfter ?? "none",
          }),
        };
      }
      if (eligibility === "retryable" || eligibility === "network") {
        if (attempt < this.#config.maxRetries) {
          const backoff = jitteredBackoffDelayMs(
            this.#config.baseBackoffMs,
            this.#config.maxBackoffMs,
            attempt,
            this.#effects.random(),
          );
          await this.#sleepAbortable(context, backoff);
          if (context.signal?.aborted) return { kind: "cancelled" };
          attempt += 1;
          continue;
        }
        return {
          kind: "failure",
          failure: this.#failure("unavailable", {
            url,
            status: response.status === 0 ? "network" : String(response.status),
            reason: "retries_exhausted",
          }),
        };
      }
      if (eligibility === "unretryable_server") {
        return {
          kind: "failure",
          failure: this.#failure("unavailable", {
            url,
            status: String(response.status),
            reason: "upstream_error",
          }),
        };
      }
      if (eligibility === "rejected") {
        return {
          kind: "failure",
          failure: this.#failure("unavailable", {
            url,
            status: String(response.status),
            reason: "request_rejected",
          }),
        };
      }

      return {
        kind: "terminal",
        state: {
          response,
          servedFromCache: false,
          stale: false,
          finalUrl: url,
        },
      };
    }
  }

  async #fetchOnce(
    context: ExecuteContext,
    url: string,
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const remaining = context.deadlineMs - this.#effects.now();
    // One deadline signal covers queueing, spacing, fetch, and body reads.
    // Fake effects may resolve delay without advancing time, so only abort
    // after confirming that the injected clock reached the deadline.
    const deadlineTimer = this.#effects
      .delay(Math.max(0, remaining), controller.signal)
      .then(() => {
        if (this.#effects.now() >= context.deadlineMs) controller.abort();
      });
    const stopped = (): AttemptResult | undefined => {
      if (context.signal?.aborted) return { kind: "cancelled" };
      if (this.#effects.now() >= context.deadlineMs) {
        return { kind: "timeout" };
      }
      if (controller.signal.aborted) return { kind: "cancelled" };
      return undefined;
    };
    try {
      const acquired = await this.#scheduler.acquire(controller.signal);
      if (acquired === "cancelled") {
        return stopped() ?? { kind: "cancelled" };
      }
      try {
        const spacing = await this.#scheduler.waitSpacing(controller.signal);
        if (spacing === "cancelled") {
          return stopped() ?? { kind: "cancelled" };
        }
        this.#scheduler.markRequested();

        const stoppedBeforeFetch = stopped();
        if (stoppedBeforeFetch !== undefined) return stoppedBeforeFetch;
        const raw = await this.#config.fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": this.#config.userAgent,
            Accept: "application/json, text/html;q=0.9, */*;q=0.1",
          },
        });
        const stoppedAfterFetch = stopped();
        if (stoppedAfterFetch !== undefined) return stoppedAfterFetch;
        const response = await this.#readResponse(raw);
        const stoppedAfterRead = stopped();
        if (stoppedAfterRead !== undefined) return stoppedAfterRead;
        return { kind: "http", response };
      } catch {
        const stoppedAfterError = stopped();
        if (stoppedAfterError !== undefined) return stoppedAfterError;
        const response: HttpResponse = {
          status: 0,
          contentType: null,
          location: null,
          retryAfter: null,
          etag: null,
          lastModified: null,
          body: new Uint8Array(),
        };
        // A network failure before a response is retry-eligible.
        return { kind: "http", response };
      } finally {
        this.#scheduler.release();
      }
    } finally {
      context.signal?.removeEventListener("abort", onCallerAbort);
      // Release the deadline: aborting the attempt resolves the pending
      // budget delay (its signal clears the real timer) so one attempt never
      // pins the operation open for the full budget.
      if (!controller.signal.aborted) controller.abort();
      await deadlineTimer.catch(() => undefined);
    }
  }

  async #readResponse(raw: Response): Promise<HttpResponse> {
    const bytes = new Uint8Array(await raw.arrayBuffer());
    return {
      status: raw.status,
      contentType: raw.headers.get("content-type"),
      location: raw.headers.get("location"),
      retryAfter: raw.headers.get("retry-after"),
      etag: raw.headers.get("etag"),
      lastModified: raw.headers.get("last-modified"),
      body: bytes,
    };
  }

  // -------------------------------------------------------------------------
  // Terminal finalization: cache write, decode, outcome
  // -------------------------------------------------------------------------

  async #finalize<D>(
    context: ExecuteContext,
    state: TerminalState,
  ): Promise<RunOutcome<D>> {
    const envelope = state.envelope;
    const response = state.response;
    const transport: TransportEnvelope = envelope !== undefined
      ? {
        status: envelope.response.status,
        contentType: envelope.response.contentType ?? null,
        body: decodeEnvelopeBody(envelope),
        finalUrl: state.finalUrl,
      }
      : {
        status: response?.status ?? 0,
        contentType: response?.contentType ?? null,
        body: response?.body ?? new Uint8Array(),
        finalUrl: state.finalUrl,
      };

    const decoded = await context.plan.decoder(transport);
    if (decoded.kind === "malformed") {
      return {
        kind: "source_failure",
        failure: this.#failure("decode", {
          url: state.finalUrl,
          detail: decoded.detail,
        }),
      };
    }

    if (
      envelope === undefined && context.mode === "online" &&
      context.plan.cacheClass !== undefined &&
      isCacheableTerminal(transport, decoded.kind)
    ) {
      const negative = isDefinitiveAbsence(transport.status) ||
        (decoded.kind === "data" && decoded.negative === true);
      await this.#writeTerminalEnvelope(
        context,
        state.finalUrl,
        transport,
        negative,
      );
    }

    const meta = this.#metaFor(context, state);
    if (decoded.kind === "no_record") {
      return { kind: "no_record", meta };
    }
    if (decoded.kind === "data") {
      return { kind: "ok", data: decoded.value as D, meta };
    }
    return { kind: "cancelled" };
  }

  #metaFor(context: ExecuteContext, state: TerminalState): ResponseMeta {
    const status = state.envelope?.response.status ??
      state.response?.status;
    const contentType = state.envelope?.response.contentType ??
      state.response?.contentType ?? null;
    const fetchedAt = new Date(this.#effects.now()).toISOString();
    return {
      requestedUrl: context.requestedUrl,
      finalUrl: state.finalUrl,
      ...(status !== undefined && status !== 0 ? { status } : {}),
      contentType,
      fetchedAt,
      servedFromCache: state.servedFromCache,
      stale: state.stale,
      redirects: context.redirects,
      warnings: context.warnings,
    };
  }

  async #writeRedirectEnvelope(
    context: ExecuteContext,
    url: string,
    response: HttpResponse,
  ): Promise<void> {
    if (response.location === null) return;
    if (context.signal?.aborted) return;
    const key = await this.#cacheKey(url);
    const envelope = createEnvelope({
      key,
      decoderSchemaVersion: this.#config.decoderSchemaVersion,
      status: response.status,
      contentType: response.contentType ?? undefined,
      location: response.location,
      body: new Uint8Array(),
      freshnessClass: "detail",
      negative: false,
      fetchedAt: new Date(this.#effects.now()).toISOString(),
    });
    await this.#cache.write(key, envelope, { signal: context.signal });
  }

  async #writeTerminalEnvelope(
    context: ExecuteContext,
    url: string,
    transport: TransportEnvelope,
    negative: boolean,
  ): Promise<void> {
    if (context.signal?.aborted) return;
    const key = await this.#cacheKey(url);
    const freshnessClass: "search" | "detail" | "negative" = negative
      ? "negative"
      : (context.plan.cacheClass ?? "detail");
    const envelope = createEnvelope({
      key,
      decoderSchemaVersion: this.#config.decoderSchemaVersion,
      status: transport.status,
      contentType: transport.contentType ?? undefined,
      body: transport.body,
      freshnessClass,
      negative,
      fetchedAt: new Date(this.#effects.now()).toISOString(),
    });
    await this.#cache.write(key, envelope, { signal: context.signal });
  }

  async #cacheKey(url: string): Promise<CacheKey> {
    return await computeCacheKey(this.#config.provider, url);
  }

  #sleepAbortable(context: ExecuteContext, ms: number): Promise<void> {
    const remaining = Math.max(0, context.deadlineMs - this.#effects.now());
    return this.#effects.delay(
      Math.min(Math.max(0, ms), remaining),
      context.signal,
    );
  }

  #failure(
    code: SourceFailure["code"],
    details: Readonly<Record<string, string>>,
  ): SourceFailure {
    return {
      source: this.#config.provider as SourceFailure["source"],
      code,
      references: [],
      details,
    };
  }

  #warning(
    code: SourceWarning["code"],
    details: Readonly<Record<string, string>>,
  ): SourceWarning {
    return {
      source: this.#config.provider as SourceWarning["source"],
      code,
      references: [],
      details,
    };
  }

  #classifyStatus(status: number): string {
    if (status === 0) return "network";
    if (isRetryableServerStatus(status)) return "retryable";
    if (status === 429) return "rate_limited";
    if (status === 500 || status === 501) return "unretryable_server";
    if (status >= 400 && status < 500 && status !== 404 && status !== 410) {
      return "rejected";
    }
    return "terminal";
  }
}

function isCacheableTerminal(
  transport: TransportEnvelope,
  decodedKind: "data" | "no_record",
): boolean {
  if (transport.status >= 200 && transport.status < 300) {
    return decodedKind === "data";
  }
  if (!isDefinitiveAbsence(transport.status) || decodedKind !== "no_record") {
    return false;
  }
  const contentType = transport.contentType?.toLowerCase() ?? "";
  if (contentType.includes("json")) return true;
  if (transport.contentType !== null) return false;
  const firstNonWhitespace = transport.body.find((byte) =>
    byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d
  );
  return firstNonWhitespace === 0x7b || firstNonWhitespace === 0x5b;
}

function isDefinitiveAbsence(status: number): boolean {
  return status === 404 || status === 410;
}

function decodeEnvelopeBody(envelope: RawResponseEnvelopeV1): Uint8Array {
  const body = envelope.response.body;
  if (body.encoding === "utf8") {
    return new TextEncoder().encode(body.text);
  }
  const binary = atob(body.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
