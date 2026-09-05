// Pure model and message vocabulary for the disposable TUI spike (issue #9).
//
// This mirrors the Model-Update-Effect boundary in docs/architecture.md, but
// only enough of it to prove the rendering decision: a search field and a
// candidate list. Terminal work stays in the driver; `update` never performs
// I/O.

export interface QueryField {
  /** Committed text in the search field. */
  readonly text: string;
  /** Cursor position expressed as a grapheme-cluster index into `text`. */
  readonly cursor: number;
}

export interface Candidate {
  readonly id: string;
  readonly title: string;
  readonly language: string;
}

export type Screen = "search" | "results";
export type SearchStatus = "idle" | "searching";

export interface AppState {
  readonly screen: Screen;
  readonly status: SearchStatus;
  /** Request id of the latest submitted search; guards stale responses. */
  readonly activeRequestId?: number;
  readonly requestCounter: number;
  readonly query: QueryField;
  readonly candidates: readonly Candidate[];
  readonly selected: number;
  readonly notice: string;
}

/** Minimum supported terminal size from docs/product-spec.md. */
export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;

export const emptyQuery: QueryField = Object.freeze({ text: "", cursor: 0 });

export function initialState(): AppState {
  return Object.freeze({
    screen: "search",
    status: "idle",
    activeRequestId: undefined,
    requestCounter: 0,
    query: emptyQuery,
    candidates: [],
    selected: 0,
    notice: "Type a Chinese title and press Enter to search.",
  });
}

export type Message =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "backspace" }
  | { readonly type: "delete" }
  | { readonly type: "move"; readonly step: -1 | 1 }
  | { readonly type: "home" }
  | { readonly type: "end" }
  | { readonly type: "clear" }
  | { readonly type: "submit" }
  | {
    readonly type: "resultsReceived";
    readonly requestId: number;
    readonly candidates: readonly Candidate[];
    readonly ok: boolean;
  }
  | { readonly type: "select"; readonly step: -1 | 1 }
  | { readonly type: "back" }
  | { readonly type: "cancel" };
