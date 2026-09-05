// Testable session kernel for the thin renderer.
//
// runSession drives one TUI session from injected input/output so the full
// update-render loop can run against memory streams in tests and against the
// real terminal in the interactive run. The alternate-screen lifecycle is
// written in a finally block so an unexpected error cannot leave the terminal
// in raw mode with a hidden cursor.

import type { AppState, Candidate, Message } from "../shared/model.ts";
import { initialState } from "../shared/model.ts";
import { update } from "../shared/update.ts";
import { ANSI, enterAlternateScreen, leaveAlternateScreen } from "./ansi.ts";
import { KeyDecoder, type Token } from "./decoder.ts";
import { renderFrame, type Size } from "./render.ts";
import { padTo } from "./width.ts";

/** Input sources signal "no input this poll tick" with null and end with EOF. */
export const EOF = Symbol("EOF");

export interface InputSource {
  next(): Promise<Uint8Array | null | typeof EOF>;
}

export interface OutputSink {
  write(data: string): void;
}

export interface SessionDeps {
  readonly input: InputSource;
  readonly output: OutputSink;
  /** Current terminal size; called on every repaint so resize is observed. */
  readonly size: () => Size;
  /** Lookup effect; returning [] or throwing is reported as a no-result. */
  readonly onSearch: (query: string) => Promise<readonly Candidate[]>;
  /** When true the session owns the alternate-screen enter/leave lifecycle. */
  readonly terminalControl?: boolean;
  /** When true, a null poll tick may repaint when the terminal size changed. */
  readonly pollResize?: boolean;
}

export type Action =
  | { readonly kind: "quit" }
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "none" };

/** Translate one decoded key token into a pure message for the current state. */
export function messageForToken(state: AppState, token: Token): Action {
  switch (token.kind) {
    case "cancel":
      return { kind: "quit" };
    case "enter":
      return state.query.text !== ""
        ? { kind: "message", message: { type: "submit" } }
        : { kind: "none" };
    case "backspace":
      return { kind: "message", message: { type: "backspace" } };
    case "delete":
      return { kind: "message", message: { type: "delete" } };
    case "up":
      return {
        kind: "message",
        message: { type: "select", step: -1 },
      };
    case "down":
      return { kind: "message", message: { type: "select", step: 1 } };
    case "left":
      return { kind: "message", message: { type: "move", step: -1 } };
    case "right":
      return { kind: "message", message: { type: "move", step: 1 } };
    case "home":
      return { kind: "message", message: { type: "home" } };
    case "end":
      return { kind: "message", message: { type: "end" } };
    case "escape":
      return state.screen === "results"
        ? { kind: "message", message: { type: "back" } }
        : { kind: "none" };
    case "text":
      return { kind: "message", message: { type: "text", value: token.value } };
    default:
      return { kind: "none" };
  }
}

function sizesEqual(a: Size, b: Size): boolean {
  return a.columns === b.columns && a.rows === b.rows;
}

export async function runSession(deps: SessionDeps): Promise<void> {
  const control = deps.terminalControl ?? false;
  const output = deps.output;
  const decoder = new KeyDecoder();
  let state = initialState();
  let lastSize = deps.size();
  let quit = false;

  const paint = (current: AppState): void => {
    lastSize = deps.size();
    const lines = renderFrame(current, lastSize)
      .map((line) => padTo(line, lastSize.columns));
    output.write(ANSI.clearScreen + lines.join("\r\n") + "\r\n");
  };

  try {
    if (control) {
      output.write(enterAlternateScreen());
    }
    paint(state);
    while (!quit) {
      const chunk = await deps.input.next();
      if (chunk === EOF) {
        break;
      }
      if (chunk === null) {
        if (deps.pollResize) {
          const current = deps.size();
          if (!sizesEqual(current, lastSize)) {
            paint(state);
          }
        }
        continue;
      }
      for (const token of decoder.push(chunk)) {
        const action = messageForToken(state, token);
        if (action.kind === "quit") {
          quit = true;
          break;
        }
        if (action.kind === "none") {
          continue;
        }
        const next = update(state, action.message);
        if (next === state) {
          continue;
        }
        state = next;
        paint(state);
        if (
          action.message.type === "submit" &&
          state.activeRequestId !== undefined
        ) {
          const requestId = state.activeRequestId;
          let candidates: readonly Candidate[] = [];
          let ok = true;
          try {
            candidates = await deps.onSearch(state.query.text);
          } catch {
            candidates = [];
            ok = false;
          }
          const resolved = update(state, {
            type: "resultsReceived",
            requestId,
            candidates,
            ok,
          });
          if (resolved !== state) {
            state = resolved;
            paint(state);
          }
        }
      }
    }
  } finally {
    if (control) {
      output.write(leaveAlternateScreen());
    }
  }
}
