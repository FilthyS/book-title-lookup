// Terminal ownership for the interactive driver.
//
// The TUI driver is the only component that acquires a terminal (issue #13
// section 13). This module holds the acquire/restore sequence and the
// idempotent release guarantee. Terminal work is performed through an
// injected `TerminalIo` seam so tests assert ordering and restoration with
// doubles and never need a physical terminal.

import { enterAlternateScreen, leaveAlternateScreen } from "./ansi.ts";

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/** Streams and control the interactive driver needs. Production wiring lives
 *  in apps/tui/src/main.ts; tests inject memory-backed doubles. */
export interface TerminalIo {
  /** Read the next raw input chunk. Resolves null at EOF. */
  readonly read: () => Promise<Uint8Array | null>;
  /** Write a frame or control sequence to the terminal stdout. */
  readonly write: (text: string) => Promise<void>;
  /** Toggle raw input mode (raw disables echo; false restores line mode). */
  readonly setRawMode: (raw: boolean) => Promise<void>;
  /** Current terminal size, read on every repaint so resize is observed. */
  readonly size: () => TerminalSize;
}

/**
 * Owns terminal acquire/restore ordering (issue #13 sections 13.2-13.3).
 *
 * Acquire order: raw input + disabled echo, then the alternate screen buffer
 * with the cursor hidden. Restore order: show the cursor and leave the
 * alternate screen, then echo/line mode. `release` is idempotent and restores
 * only the steps that actually ran, so a partial acquire or a throw during
 * the session never leaves the terminal raw with a hidden cursor.
 */
export class TerminalController {
  #released = false;
  #rawOn = false;
  #screenEntered = false;

  constructor(private readonly io: TerminalIo) {}

  async acquire(): Promise<void> {
    await this.io.setRawMode(true);
    this.#rawOn = true;
    await this.io.write(enterAlternateScreen());
    this.#screenEntered = true;
  }

  async release(): Promise<void> {
    if (this.#released) {
      return;
    }
    this.#released = true;
    if (this.#screenEntered) {
      await this.io.write(leaveAlternateScreen());
    }
    if (this.#rawOn) {
      await this.io.setRawMode(false);
    }
  }
}
