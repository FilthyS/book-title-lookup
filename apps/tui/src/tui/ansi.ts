// ANSI terminal lifecycle for the thin renderer (promoted from the issue #9
// spike evidence; docs/design/tui-rendering-strategy.md).
//
// The escape strings are the surface the deterministic tests assert against;
// a real Windows Terminal session exercises their actual effect (manual
// checklist). The driver owns when these sequences are written.

export const ANSI = Object.freeze({
  alternateScreenOn: "\x1b[?1049h",
  alternateScreenOff: "\x1b[?1049l",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  clearScreen: "\x1b[H\x1b[2J",
  reset: "\x1b[0m",
} as const);

/** Sequence written once when the TUI acquires the terminal. */
export function enterAlternateScreen(): string {
  return ANSI.alternateScreenOn + ANSI.cursorHide;
}

/** Move the native cursor to a one-based terminal row and column. */
export function moveCursorTo(row: number, column: number): string {
  return `\x1b[${row};${column}H`;
}

/** Sequence written on every exit path to restore the terminal. */
export function leaveAlternateScreen(): string {
  return ANSI.cursorShow + ANSI.alternateScreenOff + ANSI.reset;
}
