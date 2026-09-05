// Variant B entry point: Ink 7.1.1 + React 19.2 running under Deno.
//
// Run from an interactive Windows Terminal session with the narrowest grants
// the Ink/React tree needs (they read several npm/CI environment variables and
// os.release at import time):
//   deno run --no-prompt \
//     --allow-env=NODE_ENV,TERM_PROGRAM,TERM,TMUX,CI,CONTINUOUS_INTEGRATION,TF_BUILD,DEV,INK_SCREEN_READER,COLUMNS \
//     --allow-sys=osRelease \
//     variant-b/main_b.ts
//
// The same reducer from ../shared/update.ts drives both variants; only the
// rendering/input layers differ.

import React from "npm:react@19.2.0";
import type {
  Dispatch,
  ReactElement,
  SetStateAction,
} from "npm:@types/react@19";
import { Box, render, Text, useInput, useWindowSize } from "npm:ink@7.1.1";
import { simulateSearch } from "../shared/demo.ts";
import {
  type AppState,
  initialState,
  type Message,
  MIN_COLUMNS,
  MIN_ROWS,
} from "../shared/model.ts";
import { update } from "../shared/update.ts";

function isInteractive(): boolean {
  try {
    return Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

type SetState = Dispatch<SetStateAction<AppState>>;

function dispatch(setState: SetState, action: Message): void {
  setState((state) => update(state, action));
}

function App(): ReactElement {
  const [state, setState] = React.useState(initialState) as unknown as [
    AppState,
    SetState,
  ];
  const windowSize = useWindowSize();

  const submit = async (): Promise<void> => {
    if (state.query.text === "" || state.status === "searching") {
      return;
    }
    const searching = update(state, { type: "submit" });
    const requestId = searching.activeRequestId;
    setState(searching);
    if (requestId === undefined) {
      return;
    }
    try {
      const candidates = await simulateSearch(state.query.text);
      setState((current) =>
        update(current, {
          type: "resultsReceived",
          requestId,
          candidates,
          ok: true,
        })
      );
    } catch {
      setState((current) =>
        update(current, {
          type: "resultsReceived",
          requestId,
          candidates: [],
          ok: false,
        })
      );
    }
  };

  useInput((input, key) => {
    if (key.return) {
      void submit();
      return;
    }
    if (key.escape) {
      if (state.screen === "results") {
        dispatch(setState, { type: "back" });
      }
      return;
    }
    if (key.backspace) {
      dispatch(setState, { type: "backspace" });
      return;
    }
    if (key.delete) {
      dispatch(setState, { type: "delete" });
      return;
    }
    if (key.leftArrow) {
      dispatch(setState, { type: "move", step: -1 });
      return;
    }
    if (key.rightArrow) {
      dispatch(setState, { type: "move", step: 1 });
      return;
    }
    if (key.upArrow) {
      dispatch(setState, { type: "select", step: -1 });
      return;
    }
    if (key.downArrow) {
      dispatch(setState, { type: "select", step: 1 });
      return;
    }
    if (key.home) {
      dispatch(setState, { type: "home" });
      return;
    }
    if (key.end) {
      dispatch(setState, { type: "end" });
      return;
    }
    if (input) {
      dispatch(setState, { type: "text", value: input });
    }
  });

  if (
    windowSize.columns < MIN_COLUMNS || windowSize.rows < MIN_ROWS
  ) {
    return React.createElement(
      Text,
      { color: "yellow" },
      `Terminal too small: need at least ${MIN_COLUMNS}x${MIN_ROWS}. ` +
        `Current ${windowSize.columns}x${windowSize.rows}.`,
    );
  }

  const title = React.createElement(
    Text,
    { bold: true },
    "Book Title Lookup - Ink under Deno spike",
  );

  if (state.screen === "results") {
    const rows = state.candidates.map((candidate, index) => {
      const marker = index === state.selected ? "> " : "  ";
      return React.createElement(
        Text,
        { key: candidate.id, inverse: index === state.selected },
        `${marker}${index + 1}. ${candidate.title} (${candidate.language})`,
      );
    });
    return React.createElement(
      Box,
      { flexDirection: "column" },
      title,
      React.createElement(Text, {}, `Candidates for '${state.query.text}':`),
      ...rows,
      React.createElement(
        Text,
        { dimColor: true },
        "Up/Down=select  Backspace=back  Ctrl+C=quit",
      ),
      React.createElement(Text, { color: "green" }, state.notice),
    );
  }

  const value = state.status === "searching"
    ? `${state.query.text}…`
    : state.query.text;
  return React.createElement(
    Box,
    { flexDirection: "column" },
    title,
    React.createElement(Text, {}, `Search: ${value}`),
    React.createElement(
      Text,
      { dimColor: true },
      "Enter=search  Backspace=delete  Ctrl+C=quit",
    ),
    React.createElement(Text, { color: "green" }, state.notice),
    React.createElement(Text, { dimColor: true }, "minimum terminal 60x16"),
  );
}

async function main(): Promise<void> {
  if (!isInteractive()) {
    console.error(
      "[spike variant-b] non-interactive stdin/stdout detected; " +
        "the TUI does not start. Run this from Windows Terminal.",
    );
    return;
  }
  const app = render(React.createElement(App), {
    alternateScreen: true,
    exitOnCtrlC: true,
  });
  await app.waitUntilExit();
}

if (import.meta.main) {
  await main();
}
