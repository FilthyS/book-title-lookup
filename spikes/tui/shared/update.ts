// Pure reducer for the spike: `update(state, message) => state`.
// No terminal, network, or clock access happens here.

import {
  type AppState,
  initialState,
  type Message,
  type QueryField,
} from "./model.ts";
import { graphemeCount, splitGraphemes } from "./segments.ts";

function clamp(value: number, max: number): number {
  if (value < 0) {
    return 0;
  }
  return value > max ? max : value;
}

function insertText(query: QueryField, value: string): QueryField {
  if (value === "") {
    return query;
  }
  const parts = splitGraphemes(query.text);
  const inserted = splitGraphemes(value);
  const cursor = query.cursor;
  const text = parts.slice(0, cursor).concat(inserted, parts.slice(cursor))
    .join("");
  return { text, cursor: cursor + inserted.length };
}

function backspaceAt(query: QueryField): QueryField {
  const parts = splitGraphemes(query.text);
  const cursor = query.cursor;
  if (cursor === 0) {
    return query;
  }
  return {
    text: parts.slice(0, cursor - 1).concat(parts.slice(cursor)).join(""),
    cursor: cursor - 1,
  };
}

function deleteAt(query: QueryField): QueryField {
  const parts = splitGraphemes(query.text);
  const cursor = query.cursor;
  if (cursor >= parts.length) {
    return query;
  }
  return {
    text: parts.slice(0, cursor).concat(parts.slice(cursor + 1)).join(""),
    cursor,
  };
}

function moveCursor(query: QueryField, step: -1 | 1): QueryField {
  const max = graphemeCount(query.text);
  return { text: query.text, cursor: clamp(query.cursor + step, max) };
}

export function update(state: AppState, message: Message): AppState {
  switch (message.type) {
    case "text": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      const query = insertText(state.query, message.value);
      if (query === state.query) {
        return state;
      }
      return { ...state, query, notice: "" };
    }
    case "backspace": {
      if (state.status === "searching") {
        return state;
      }
      if (state.screen === "results") {
        // Back on the results screen means "return to the editable query".
        return {
          ...state,
          screen: "search",
          status: "idle",
          activeRequestId: undefined,
          notice: "",
        };
      }
      const query = backspaceAt(state.query);
      return query === state.query ? state : { ...state, query };
    }
    case "delete": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      const query = deleteAt(state.query);
      return query === state.query ? state : { ...state, query };
    }
    case "move": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      const query = moveCursor(state.query, message.step);
      return query === state.query ? state : { ...state, query };
    }
    case "home": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      if (state.query.cursor === 0) {
        return state;
      }
      return { ...state, query: { ...state.query, cursor: 0 } };
    }
    case "end": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      const max = graphemeCount(state.query.text);
      if (state.query.cursor === max) {
        return state;
      }
      return { ...state, query: { ...state.query, cursor: max } };
    }
    case "clear": {
      if (state.screen !== "search" || state.status === "searching") {
        return state;
      }
      if (state.query.text === "" && state.query.cursor === 0) {
        return state;
      }
      return { ...state, query: { text: "", cursor: 0 } };
    }
    case "submit": {
      if (
        state.screen !== "search" || state.status === "searching" ||
        state.query.text === ""
      ) {
        return state;
      }
      const requestId = state.requestCounter + 1;
      return {
        ...state,
        status: "searching",
        activeRequestId: requestId,
        requestCounter: requestId,
        notice: `Searching for “${state.query.text}” …`,
      };
    }
    case "resultsReceived": {
      // Stale responses are ignored; only the active request may change state.
      if (
        state.status !== "searching" ||
        state.activeRequestId !== message.requestId
      ) {
        return state;
      }
      if (!message.ok || message.candidates.length === 0) {
        return {
          ...state,
          status: "idle",
          activeRequestId: undefined,
          notice: "No candidates found.",
        };
      }
      return {
        ...state,
        status: "idle",
        activeRequestId: undefined,
        screen: "results",
        candidates: message.candidates,
        selected: 0,
        notice: "Use Up/Down to select, Backspace to return to the query.",
      };
    }
    case "select": {
      if (state.screen !== "results") {
        return state;
      }
      const max = state.candidates.length - 1;
      const selected = clamp(state.selected + message.step, max);
      return selected === state.selected ? state : { ...state, selected };
    }
    case "back": {
      if (state.screen !== "results") {
        return state;
      }
      return {
        ...state,
        screen: "search",
        status: "idle",
        activeRequestId: undefined,
        notice: "",
      };
    }
    case "cancel": {
      // Pure acknowledgement; the driver performs the exit effect.
      return state;
    }
    default:
      return state;
  }
}
