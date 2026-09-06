/**
 * THROWAWAY PROTOTYPE:
 * Three minimal, terminal-native layouts for the existing lookup flow.
 * Switch layouts with 1/2/3 or Left/Right; no web UI, persistence, or network.
 */

import {
  ANSI,
  enterAlternateScreen,
  leaveAlternateScreen,
} from "./tui/ansi.ts";
import {
  defaultTerminalInputEncoding,
  KeyDecoder,
  type Token,
} from "./tui/input-decoder.ts";
import { measureWidth, padTo, truncateTo } from "./tui/width.ts";

interface Candidate {
  readonly title: string;
  readonly author: string;
  readonly year: string;
  readonly form: string;
  readonly originalTitle: string;
}

interface AttestedTitle {
  readonly language: string;
  readonly title: string;
  readonly level: "VERIFIED" | "PROBABLE";
  readonly evidence: string;
}

interface PrototypeState {
  layout: number;
  screen: "candidates" | "titles";
  selected: number;
  query: string;
  editing: boolean;
}

type Emphasis = "normal" | "strong" | "muted" | "selected";

interface DisplayLine {
  readonly text: string;
  readonly emphasis?: Emphasis;
}

const MIN_COLUMNS = 60;
const MIN_ROWS = 24;
const LAYOUT_NAMES = ["Stacked choices", "Focused choice", "Compact list"];
const encoder = new TextEncoder();

const candidates: readonly Candidate[] = [
  {
    title: "One Hundred Years of Solitude",
    author: "Gabriel García Márquez",
    year: "1967",
    form: "novel",
    originalTitle: "Cien años de soledad",
  },
  {
    title: "Ascent to Glory",
    author: "Álvaro Santana-Acuña",
    year: "2020",
    form: "literary history",
    originalTitle: "Ascent to Glory",
  },
  {
    title: "Cien años de soledad: una interpretación",
    author: "Josefina Ludmer",
    year: "1972",
    form: "literary criticism",
    originalTitle: "Cien años de soledad: una interpretación",
  },
];

const attestedTitles: readonly AttestedTitle[] = [
  {
    language: "English",
    title: "One Hundred Years of Solitude",
    level: "VERIFIED",
    evidence: "Harper Perennial edition · ISBN 978-0-06-088328-7",
  },
  {
    language: "Spanish",
    title: "Cien años de soledad",
    level: "VERIFIED",
    evidence: "Editorial Sudamericana edition · 1967",
  },
  {
    language: "French",
    title: "Cent ans de solitude",
    level: "VERIFIED",
    evidence: "Éditions du Seuil edition · 1968",
  },
  {
    language: "Japanese",
    title: "百年の孤独",
    level: "PROBABLE",
    evidence: "Multiple catalog records; direct edition link absent",
  },
];

function line(text = "", emphasis: Emphasis = "normal"): DisplayLine {
  return { text, emphasis };
}

function horizontal(width: number, character = "─"): string {
  return character.repeat(Math.max(0, width));
}

function boxTop(label: string, width: number): string {
  const decorated = label === "" ? "" : ` ${label} `;
  return `┌${decorated}${horizontal(width - measureWidth(decorated) - 2)}┐`;
}

function boxRow(content: string, width: number): string {
  const innerWidth = width - 4;
  return `│ ${padTo(truncateTo(content, innerWidth), innerWidth)} │`;
}

function boxBottom(width: number): string {
  return `└${horizontal(width - 2)}┘`;
}

function smallQueryBox(state: PrototypeState, width: number): DisplayLine[] {
  const boxWidth = Math.min(42, width);
  const cursor = state.editing ? "▌" : "";
  return [
    line(boxTop("TITLE INPUT", boxWidth), "muted"),
    line(boxRow(`${state.query}${cursor}`, boxWidth)),
    line(boxBottom(boxWidth), "muted"),
  ];
}

function header(state: PrototypeState, width: number): DisplayLine[] {
  const layout = `${state.layout + 1}/3  ${LAYOUT_NAMES[state.layout]}`;
  return [
    line(
      padTo("B O O K   T I T L E   L O O K U P", width - measureWidth(layout)) +
        layout,
      "strong",
    ),
    line(horizontal(width, "═"), "muted"),
  ];
}

function footer(state: PrototypeState, width: number): DisplayLine[] {
  const help = state.editing
    ? "Type to edit · Backspace delete · Enter apply · Esc cancel"
    : state.screen === "candidates"
    ? "↑↓ select · Enter confirm · / edit query · 1/2/3 layout · Q quit"
    : "Esc return · / edit query · 1/2/3 layout · Q quit";
  return [
    line(horizontal(width), "muted"),
    line(help, "muted"),
  ];
}

function optionBox(
  candidate: Candidate,
  index: number,
  state: PrototypeState,
  width: number,
): DisplayLine[] {
  const selected = index === state.selected;
  const marker = selected ? "▶" : " ";
  return [
    line(
      boxTop(`${marker} ${index + 1}`, width),
      selected ? "strong" : "muted",
    ),
    line(boxRow(candidate.title, width), selected ? "selected" : "strong"),
    line(
      boxRow(
        `${candidate.author} · ${candidate.year} · ${candidate.form}`,
        width,
      ),
      "muted",
    ),
    line(boxBottom(width), selected ? "strong" : "muted"),
  ];
}

function renderStackedCandidates(
  state: PrototypeState,
  width: number,
): DisplayLine[] {
  return [
    ...header(state, width),
    line(),
    ...smallQueryBox(state, width),
    line(),
    line("CHOOSE THE WRITTEN WORK", "strong"),
    line(
      "Confirm identity before looking for titles in other languages.",
      "muted",
    ),
    ...candidates.flatMap((candidate, index) =>
      optionBox(candidate, index, state, width)
    ),
    ...footer(state, width),
  ];
}

function renderFocusedCandidates(
  state: PrototypeState,
  width: number,
): DisplayLine[] {
  const candidate = candidates[state.selected];
  const cardWidth = Math.min(width, 70);
  const otherChoices = candidates
    .map((item, index) => `${index + 1} ${item.title}`)
    .filter((_, index) => index !== state.selected)
    .join("  |  ");
  return [
    ...header(state, width),
    line(),
    line(`TITLE INPUT  [ ${state.query}${state.editing ? "▌" : ""} ]`, "muted"),
    line(),
    line("IS THIS THE WORK YOU MEAN?", "strong"),
    line("One decision at a time.", "muted"),
    line(),
    line(
      boxTop(
        `CANDIDATE ${state.selected + 1} OF ${candidates.length}`,
        cardWidth,
      ),
    ),
    line(boxRow(candidate.title, cardWidth), "selected"),
    line(boxRow(`by ${candidate.author}`, cardWidth), "strong"),
    line(boxRow("", cardWidth)),
    line(boxRow(`First published  ${candidate.year}`, cardWidth)),
    line(boxRow(`Original title   ${candidate.originalTitle}`, cardWidth)),
    line(boxRow(`Form             ${candidate.form}`, cardWidth)),
    line(boxBottom(cardWidth)),
    line(),
    line(`OTHER CHOICES  ${otherChoices}`, "muted"),
    ...footer(state, width),
  ];
}

function renderCompactCandidates(
  state: PrototypeState,
  width: number,
): DisplayLine[] {
  const tableWidth = width;
  const rows = candidates.flatMap((candidate, index) => {
    const selected = index === state.selected;
    const marker = selected ? "▶" : " ";
    return [
      line(
        boxRow(`${marker} ${index + 1}  ${candidate.title}`, tableWidth),
        selected ? "selected" : "strong",
      ),
      line(
        boxRow(
          `     ${candidate.author} · ${candidate.year} · ${candidate.form}`,
          tableWidth,
        ),
        "muted",
      ),
    ];
  });
  return [
    ...header(state, width),
    line(),
    ...smallQueryBox(state, width),
    line(),
    line("STEP 2 OF 3  ·  CONFIRM THE WRITTEN WORK", "strong"),
    line(),
    line(boxTop("CANDIDATES", tableWidth), "muted"),
    ...rows,
    line(boxBottom(tableWidth), "muted"),
    line(),
    line(
      "A title search never silently selects the first candidate.",
      "muted",
    ),
    ...footer(state, width),
  ];
}

function titleRows(width: number, boxed: boolean): DisplayLine[] {
  if (boxed) {
    return attestedTitles.flatMap((title) => [
      line(boxTop(`${title.language} · ${title.level}`, width), "muted"),
      line(boxRow(`${title.title} · ${title.evidence}`, width), "strong"),
      line(boxBottom(width), "muted"),
    ]);
  }
  return attestedTitles.flatMap((title, index) => [
    line(
      `${String(index + 1).padStart(2, "0")}  ${
        title.language.padEnd(10)
      }  ${title.title}`,
      "strong",
    ),
    line(`    ${title.level.padEnd(10)}  ${title.evidence}`, "muted"),
  ]);
}

function renderTitles(
  state: PrototypeState,
  width: number,
): DisplayLine[] {
  const work = candidates[state.selected];
  const boxed = state.layout === 0;
  const heading = state.layout === 1
    ? "TITLES WITH A PAPER TRAIL"
    : "ATTESTED TITLES";
  return [
    ...header(state, width),
    line(),
    line("WORK CONFIRMED", "strong"),
    line(`${work.title} · ${work.author} · ${work.year}`, "muted"),
    line(),
    line(heading, "strong"),
    line(
      state.layout === 2
        ? "LANGUAGE      PUBLISHED TITLE"
        : "Published title groups, with their evidence level.",
      "muted",
    ),
    line(),
    ...titleRows(width, boxed),
    ...footer(state, width),
  ];
}

function renderFrame(
  state: PrototypeState,
  columns: number,
  rows: number,
): DisplayLine[] {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return [
      line("BOOK TITLE LOOKUP", "strong"),
      line(),
      line(`Terminal too small: need at least ${MIN_COLUMNS}x${MIN_ROWS}.`),
      line(`Current size: ${columns}x${rows}.`, "muted"),
    ];
  }
  const width = Math.min(columns, 88);
  if (state.screen === "titles") return renderTitles(state, width);
  if (state.layout === 0) return renderStackedCandidates(state, width);
  if (state.layout === 1) return renderFocusedCandidates(state, width);
  return renderCompactCandidates(state, width);
}

function style(displayLine: DisplayLine, columns: number): string {
  const text = truncateTo(displayLine.text, columns);
  switch (displayLine.emphasis) {
    case "strong":
      return `\x1b[1m${text}${ANSI.reset}`;
    case "muted":
      return `\x1b[2m${text}${ANSI.reset}`;
    case "selected":
      return `\x1b[1;7m${text}${ANSI.reset}`;
    default:
      return text;
  }
}

function repaint(state: PrototypeState): void {
  const size = Deno.consoleSize();
  const frame = renderFrame(state, size.columns, size.rows)
    .slice(0, size.rows)
    .map((displayLine) => style(displayLine, size.columns))
    .join("\r\n");
  Deno.stdout.writeSync(
    encoder.encode(`${ANSI.cursorHide}${ANSI.clearScreen}${frame}`),
  );
}

function removeLastCharacter(value: string): string {
  return Array.from(value).slice(0, -1).join("");
}

function handleText(state: PrototypeState, value: string): boolean {
  if (state.editing) {
    state.query += value;
    return true;
  }
  if (value === "q" || value === "Q") return false;
  if (value === "/") {
    state.editing = true;
    return true;
  }
  if (/^[123]$/.test(value)) {
    state.layout = Number(value) - 1;
  }
  return true;
}

function handleToken(state: PrototypeState, token: Token): boolean {
  if (token.kind === "cancel") return false;
  if (token.kind === "text") return handleText(state, token.value);
  if (token.kind === "backspace" && state.editing) {
    state.query = removeLastCharacter(state.query);
  } else if (token.kind === "enter" && state.editing) {
    state.editing = false;
    state.screen = "candidates";
  } else if (token.kind === "enter" && state.screen === "candidates") {
    state.screen = "titles";
  } else if (token.kind === "escape" && state.editing) {
    state.editing = false;
  } else if (token.kind === "escape" && state.screen === "titles") {
    state.screen = "candidates";
  } else if (token.kind === "up" && state.screen === "candidates") {
    state.selected = Math.max(0, state.selected - 1);
  } else if (token.kind === "down" && state.screen === "candidates") {
    state.selected = Math.min(candidates.length - 1, state.selected + 1);
  } else if (token.kind === "left") {
    state.layout = (state.layout - 1 + LAYOUT_NAMES.length) %
      LAYOUT_NAMES.length;
  } else if (token.kind === "right" || token.kind === "tab") {
    state.layout = (state.layout + 1) % LAYOUT_NAMES.length;
  }
  return true;
}

function initialState(layout = 0): PrototypeState {
  return {
    layout,
    screen: "candidates",
    selected: 0,
    query: "百年孤独",
    editing: false,
  };
}

function printLayouts(): void {
  for (let layout = 0; layout < LAYOUT_NAMES.length; layout += 1) {
    const output = renderFrame(initialState(layout), 80, 30)
      .map((displayLine) => displayLine.text)
      .join("\n");
    console.log(output);
    if (layout < LAYOUT_NAMES.length - 1) console.log("\n\n");
  }
}

async function runInteractive(): Promise<void> {
  if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
    throw new Error("interactive prototype requires a terminal; use --print");
  }

  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const decoder = new KeyDecoder(
    defaultTerminalInputEncoding(Deno.build.os, locale),
  );
  const state = initialState();
  const buffer = new Uint8Array(256);
  let running = true;

  Deno.stdin.setRaw(true);
  Deno.stdout.writeSync(encoder.encode(enterAlternateScreen()));
  try {
    repaint(state);
    while (running) {
      const read = await Deno.stdin.read(buffer);
      if (read === null) break;
      for (const token of decoder.push(buffer.slice(0, read))) {
        running = handleToken(state, token);
        if (!running) break;
      }
      if (running) repaint(state);
    }
  } finally {
    Deno.stdout.writeSync(encoder.encode(leaveAlternateScreen()));
    Deno.stdin.setRaw(false);
  }
}

if (import.meta.main) {
  if (Deno.args.includes("--print")) {
    printLayouts();
  } else {
    await runInteractive();
  }
}
