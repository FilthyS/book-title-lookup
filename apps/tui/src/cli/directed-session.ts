/**
 * Directed CLI sessions (issue #13 section 12).
 *
 * A directed session is a headless coordinator session seeded from parsed
 * options and driven by a small scripted sequence. It runs through the pure
 * reducer while the effect runner (injected request-id source and real
 * AbortControllers) performs catalog calls, then stops at the terminal state.
 */

import type {
  BookTitleCatalog,
  RequestOptions,
} from "../../../../packages/core/src/module.ts";
import { update, type UpdateResult } from "../coordinator/reducer.ts";
import type { Message } from "../coordinator/messages.ts";
import type { Effect } from "../coordinator/effects.ts";
import type { SessionState } from "../coordinator/state.ts";

export interface SequenceRequestIdSource {
  readonly next: () => string;
}

export function fixedRequestIds(): SequenceRequestIdSource {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return String(counter);
    },
  };
}

export interface DirectedInput {
  readonly seed: SessionState;
  readonly messages: readonly Message[];
  readonly catalog: BookTitleCatalog;
  readonly ids?: SequenceRequestIdSource;
  readonly signal?: AbortSignal;
}

export interface DirectedResult {
  readonly state: SessionState;
  readonly exitCode?: number;
}

function slotOf(effect: Effect): "search" | "resolve" | "titles" | null {
  if (effect.kind === "search") return "search";
  if (effect.kind === "resolve") return "resolve";
  if (effect.kind === "findTitles") return "titles";
  return null;
}

/**
 * Pump messages through the reducer, performing request effects through the
 * catalog and delivering the requestStarted handshake before each outcome.
 */
export async function runDirectedSession(
  input: DirectedInput,
): Promise<DirectedResult> {
  const ids = input.ids ?? fixedRequestIds();
  const controllers = new Map<string, AbortController>();
  const queue: Message[] = [...input.messages];
  let state = input.seed;
  let exitCode: number | undefined;

  const runRequest = async (
    effect: Extract<
      Effect,
      { readonly kind: "search" | "resolve" | "findTitles" }
    >,
  ) => {
    const slot = slotOf(effect) as "search" | "resolve" | "titles";
    const requestId = ids.next();
    const controller = new AbortController();
    controllers.set(requestId, controller);
    const options: RequestOptions = { signal: controller.signal };
    queue.push({ type: "requestStarted", slot, requestId });
    if (effect.kind === "search") {
      const outcome = await input.catalog.search(effect.query, options);
      queue.push({ type: "searchOutcome", requestId, outcome });
    } else if (effect.kind === "resolve") {
      const target = effect.target.kind === "candidate"
        ? { kind: "candidate" as const, ref: effect.target.ref as never }
        : {
          kind: "externalReference" as const,
          reference: effect.target.reference,
        };
      const outcome = await input.catalog.resolve(target, options);
      queue.push({ type: "resolveOutcome", requestId, outcome });
    } else {
      const outcome = await input.catalog.findTitles(
        effect.workRef,
        effect.query,
        options,
      );
      queue.push({ type: "titlesOutcome", requestId, outcome });
    }
    controllers.delete(requestId);
  };

  while (queue.length > 0 && exitCode === undefined) {
    const message = queue.shift() as Message;
    const result: UpdateResult = update(state, message);
    state = result.next;
    for (const effect of result.effects) {
      if (effect.kind === "abort") {
        controllers.get(effect.requestId)?.abort();
        continue;
      }
      if (effect.kind === "exit") {
        exitCode = effect.code;
        continue;
      }
      if (
        effect.kind === "search" || effect.kind === "resolve" ||
        effect.kind === "findTitles"
      ) {
        await runRequest(effect);
      }
    }
  }

  return { state, ...(exitCode !== undefined ? { exitCode } : {}) };
}
