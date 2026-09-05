// Interactive TUI driver (issue #13 section 13; issue #12 section 3.1).
//
// The driver owns terminal acquire/restore and keyboard input; lookup policy
// lives entirely in the shared coordinator. It pumps a stream of events — raw
// key bytes (decoded through the issue #9 token vocabulary) and request
// outcomes — into the pure reducer `update(state, message)`, performing each
// returned effect through the injected catalog and the reducer's
// requestStarted/outcome handshake. The effect runner is owned here: request
// ids are allocated by the injected id source, one AbortController is
// registered per in-flight request, and stale outcomes are dropped by the
// reducer.
//
// Keyboard and outcome events arrive on the same microtask/event queue so a
// user can cancel (Esc) or interrupt (Ctrl+C) while a request is in flight.
// Terminal restore runs in a finally block and is idempotent (see
// TerminalController).

import { KeyDecoder, type Token } from "./input-decoder.ts";
import type { TerminalIo } from "./terminal.ts";
import { TerminalController } from "./terminal.ts";
import { ANSI } from "./ansi.ts";
import { renderFrame, type UiSelection } from "./render.ts";
import { padTo } from "./width.ts";
import { update } from "../coordinator/reducer.ts";
import type { Message } from "../coordinator/messages.ts";
import type { Effect } from "../coordinator/effects.ts";
import { emptyQueryDraft, type SessionState } from "../coordinator/state.ts";
import type { BookTitleCatalog } from "../../../../packages/core/src/module.ts";

export interface RequestIdSource {
  readonly next: () => string;
}

/** Fixed, deterministic id sequence for tests (1, 2, ...). */
export function fixedRequestIds(): RequestIdSource {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return String(counter);
    },
  };
}

/** Fresh interactive session state: a Query node under the lookup goal. */
export function initialSession(): SessionState {
  return {
    screen: "query",
    goal: { kind: "lookup" },
    draft: emptyQueryDraft(),
    targetLanguages: [],
    notice: null,
  };
}

export interface RunTuiOptions {
  readonly io: TerminalIo;
  readonly catalog: BookTitleCatalog;
  readonly ids?: RequestIdSource;
  readonly seed?: SessionState;
}

type RequestEffect = Extract<
  Effect,
  { readonly kind: "search" | "resolve" | "findTitles" }
>;

function slotOf(effect: RequestEffect): "search" | "resolve" | "titles" {
  if (effect.kind === "search") return "search";
  if (effect.kind === "resolve") return "resolve";
  return "titles";
}

/** Decode one terminal key token into a coordinator message. Returns null
 *  when the token maps to driver-local behavior handled elsewhere. */
export function messageForToken(
  state: SessionState,
  token: Token,
): Message | null {
  switch (token.kind) {
    case "cancel":
      return { type: "interrupt" };
    case "escape":
      return state.screen === "query" ? { type: "quit" } : { type: "back" };
    case "enter":
      switch (state.screen) {
        case "query":
          return { type: "submitSearch" };
        case "candidates":
          return { type: "confirmCandidate" };
        case "resolved":
          return state.goal.kind === "lookup" ? { type: "viewTitles" } : null;
        default:
          return null; // titles/group_detail/loading handled by the driver
      }
    case "up":
      return state.screen === "candidates"
        ? { type: "moveSelection", step: -1 }
        : null;
    case "down":
      return state.screen === "candidates"
        ? { type: "moveSelection", step: 1 }
        : null;
    case "left":
      return { type: "moveCursor", step: -1 };
    case "right":
      return { type: "moveCursor", step: 1 };
    case "home":
      return { type: "home" };
    case "end":
      return { type: "end" };
    case "backspace":
      return { type: "backspace" };
    case "delete":
      return { type: "delete" };
    case "text":
      return { type: "text", value: token.value };
    default:
      return null; // tab / unknown ignored
  }
}

class InteractiveSession {
  #state: SessionState;
  #decoder = new KeyDecoder();
  #io: TerminalIo;
  #catalog: BookTitleCatalog;
  #ids: RequestIdSource;
  #terminal: TerminalController;
  #requests = new Map<string, AbortController>();

  // Pending keyboard tokens decoded from reads not yet consumed.
  #tokens: Token[] = [];
  // A single outstanding read; never lost across race iterations.
  #readInFlight: Promise<Uint8Array | null> | null = null;
  #inputEnded = false;

  // Request outcomes queued by running requests, with a one-slot waiter.
  #outcomes: Message[] = [];
  #outcomeWaiter: (() => void) | null = null;

  #exitCode: number | undefined;
  #groupSelection = 0;
  #wasTitles = false;

  constructor(options: RunTuiOptions) {
    this.#io = options.io;
    this.#catalog = options.catalog;
    this.#ids = options.ids ?? fixedRequestIds();
    this.#terminal = new TerminalController(this.#io);
    this.#state = options.seed ?? initialSession();
  }

  async run(): Promise<number> {
    await this.#terminal.acquire();
    try {
      this.#paint();
      while (this.#exitCode === undefined) {
        const event = await this.#nextEvent();
        if (event === "outcome") {
          const message = this.#outcomes.shift() as Message;
          this.#dispatch(message);
        } else if (event === "token") {
          const token = this.#tokens.shift() as Token;
          this.#handleToken(token);
        }
        // "eof" keeps waiting only for outcomes; a terminal session ends via
        // an explicit quit or interrupt, so a dropped stream is never fatal.
      }
    } finally {
      this.#abortAll();
      await this.#terminal.release();
    }
    return this.#exitCode ?? 0;
  }

  // -------------------------------------------------------------------------
  // Event loop
  // -------------------------------------------------------------------------

  /** Resolve the next of: a buffered outcome, a buffered key token, a future
   *  outcome, or a future key token. Returns the kind of event that won. */
  #nextEvent(): Promise<"outcome" | "token" | "eof"> {
    if (this.#outcomes.length > 0) return Promise.resolve("outcome");
    if (this.#tokens.length > 0) return Promise.resolve("token");
    if (this.#inputEnded) {
      // Only outcomes can still arrive.
      return this.#waitForOutcome().then(() => "outcome");
    }
    const outcomeP = this.#waitForOutcome().then(() => "outcome" as const);
    const tokenP = this.#pullToken().then((kind) => kind);
    return Promise.race([outcomeP, tokenP]);
  }

  /** Pull reads until a token is decoded or input ends. */
  async #pullToken(): Promise<"token" | "eof"> {
    while (this.#tokens.length === 0 && !this.#inputEnded) {
      this.#readInFlight ??= this.#io.read();
      const chunk = await this.#readInFlight;
      this.#readInFlight = null;
      if (chunk === null) {
        this.#inputEnded = true;
        return "eof";
      }
      this.#tokens.push(...this.#decoder.push(chunk));
    }
    return this.#tokens.length > 0 ? "token" : "eof";
  }

  #waitForOutcome(): Promise<void> {
    if (this.#outcomes.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#outcomeWaiter = resolve;
    });
  }

  #wakeOutcomeWaiters(): void {
    if (this.#outcomeWaiter !== null) {
      const waiter = this.#outcomeWaiter;
      this.#outcomeWaiter = null;
      waiter();
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch and effects
  // -------------------------------------------------------------------------

  #dispatch(message: Message): void {
    const result = update(this.#state, message);
    const changed = result.next !== this.#state;
    this.#state = result.next;
    if (changed) {
      if (this.#state.screen === "titles" && !this.#wasTitles) {
        this.#groupSelection = 0;
      }
      this.#wasTitles = this.#state.screen === "titles";
      this.#paint();
    }
    for (const effect of result.effects) {
      this.#runEffect(effect);
    }
  }

  #runEffect(effect: Effect): void {
    switch (effect.kind) {
      case "abort":
        this.#requests.get(effect.requestId)?.abort();
        break;
      case "exit":
        this.#exitCode = effect.code;
        break;
      case "search":
      case "resolve":
      case "findTitles":
        this.#startRequest(effect);
        break;
    }
  }

  #startRequest(effect: RequestEffect): void {
    const slot = slotOf(effect);
    const requestId = this.#ids.next();
    const controller = new AbortController();
    this.#requests.set(requestId, controller);
    this.#dispatch({ type: "requestStarted", slot, requestId });
    const run = async (): Promise<void> => {
      try {
        const outcome = await this.#callCatalog(
          effect,
          requestId,
          controller.signal,
        );
        this.#enqueueOutcome(outcome);
      } finally {
        this.#requests.delete(requestId);
      }
    };
    // Fire-and-forget: outcomes are delivered through the event queue so the
    // loop keeps accepting keys while a request is in flight.
    void run();
  }

  #callCatalog(
    effect: RequestEffect,
    requestId: string,
    signal: AbortSignal,
  ): Promise<Message> {
    const options = { signal };
    if (effect.kind === "search") {
      return this.#catalog.search(effect.query, options).then((outcome) => ({
        type: "searchOutcome" as const,
        requestId,
        outcome,
      }));
    }
    if (effect.kind === "resolve") {
      const target = effect.target.kind === "candidate"
        ? { kind: "candidate" as const, ref: effect.target.ref as never }
        : {
          kind: "externalReference" as const,
          reference: effect.target.reference,
        };
      return this.#catalog.resolve(target, options).then((outcome) => ({
        type: "resolveOutcome" as const,
        requestId,
        outcome,
      }));
    }
    return this.#catalog.findTitles(effect.workRef, effect.query, options).then(
      (outcome) => ({
        type: "titlesOutcome" as const,
        requestId,
        outcome,
      }),
    );
  }

  #enqueueOutcome(message: Message): void {
    this.#outcomes.push(message);
    this.#wakeOutcomeWaiters();
  }

  #abortAll(): void {
    for (const controller of this.#requests.values()) controller.abort();
    this.#requests.clear();
  }

  // -------------------------------------------------------------------------
  // Input and rendering
  // -------------------------------------------------------------------------

  #handleToken(token: Token): void {
    // Driver-local selections that are not reducer state.
    if (
      (token.kind === "up" || token.kind === "down") &&
      this.#state.screen === "titles"
    ) {
      const step = token.kind === "up" ? -1 : 1;
      const count = this.#state.payload.groups.length;
      const next = Math.max(
        0,
        Math.min(count - 1, this.#groupSelection + step),
      );
      if (next !== this.#groupSelection) {
        this.#groupSelection = next;
        this.#paint();
      }
      return;
    }
    if (
      token.kind === "enter" && this.#state.screen === "titles" &&
      this.#state.payload.groups[this.#groupSelection] !== undefined
    ) {
      this.#dispatch({
        type: "selectGroup",
        index: this.#groupSelection,
      });
      return;
    }
    const message = messageForToken(this.#state, token);
    if (message !== null) {
      this.#dispatch(message);
    }
  }

  #paint(): void {
    const size = this.#io.size();
    const selection: UiSelection = { groups: this.#groupSelection };
    const frame = renderFrame(this.#state, size, selection)
      .map((line) => padTo(line, size.columns))
      .join("\r\n");
    void this.#io.write(ANSI.clearScreen + frame + "\r\n");
  }
}

/**
 * Run one interactive TUI session and return its exit code. The caller is
 * responsible for terminal ownership; the driver restores it in a finally
 * block and reports the code from the reducer's `exit` effect (0 for a normal
 * quit, 130 for an interrupt).
 */
export function runTuiSession(options: RunTuiOptions): Promise<number> {
  return new InteractiveSession(options).run();
}
