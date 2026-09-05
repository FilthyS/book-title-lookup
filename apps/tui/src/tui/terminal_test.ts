// Terminal acquire/restore tests (issue #13 sections 13.2-13.3).
//
// These assert the ordering of raw-mode, alternate-screen, and cursor
// operations against an injected stream double, and that release is
// idempotent and restores a partially-completed acquire.

import { assertEquals } from "@std/assert";
import { ANSI, enterAlternateScreen, leaveAlternateScreen } from "./ansi.ts";
import type { TerminalIo, TerminalSize } from "./terminal.ts";
import { TerminalController } from "./terminal.ts";

const SIZE: TerminalSize = { columns: 60, rows: 16 };

interface Step {
  readonly op: "raw" | "write";
  readonly value: boolean | string;
}

class RecordingIo implements TerminalIo {
  readonly steps: Step[] = [];
  readonly writes: string[] = [];

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }
  write(text: string): Promise<void> {
    this.steps.push({ op: "write", value: text });
    this.writes.push(text);
    return Promise.resolve();
  }
  setRawMode(raw: boolean): Promise<void> {
    this.steps.push({ op: "raw", value: raw });
    return Promise.resolve();
  }
  size(): TerminalSize {
    return SIZE;
  }
}

Deno.test("acquire sets raw first, then the alternate screen with cursor hidden", async () => {
  const io = new RecordingIo();
  const terminal = new TerminalController(io);
  await terminal.acquire();
  assertEquals(io.steps, [
    { op: "raw", value: true },
    { op: "write", value: enterAlternateScreen() },
  ]);
});

Deno.test("release restores cursor/alternate screen before echo and raw mode", async () => {
  const io = new RecordingIo();
  const terminal = new TerminalController(io);
  await terminal.acquire();
  await terminal.release();
  assertEquals(io.steps.slice(2), [
    { op: "write", value: leaveAlternateScreen() },
    { op: "raw", value: false },
  ]);
});

Deno.test("release is idempotent and emits the restore sequence once", async () => {
  const io = new RecordingIo();
  const terminal = new TerminalController(io);
  await terminal.acquire();
  await terminal.release();
  await terminal.release();
  const writes = io.writes.filter((text) => text.includes("1049"));
  assertEquals(writes.length, 2); // one enter + one leave
  assertEquals(io.writes.join("").includes(ANSI.alternateScreenOn), true);
  assertEquals(io.writes.join("").includes(ANSI.alternateScreenOff), true);
  const rawToggles = io.steps.filter((step) => step.op === "raw");
  assertEquals(rawToggles, [
    { op: "raw", value: true },
    { op: "raw", value: false },
  ]);
});

Deno.test("a partial acquire is still restored on release", async () => {
  const io = new RecordingIo();
  // Make the alternate-screen write fail after raw mode succeeded.
  const failing: TerminalIo = {
    read: () => io.read(),
    setRawMode: (raw: boolean) => io.setRawMode(raw),
    size: () => io.size(),
    write(text: string): Promise<void> {
      io.write(text);
      return Promise.reject(new Error("write failed"));
    },
  };
  const terminal = new TerminalController(failing);
  await terminal.acquire().then(
    () => {
      throw new Error("acquire should have thrown");
    },
    () => {},
  );
  // Raw mode was turned on but the screen write failed; restore raw mode only.
  await terminal.release();
  const rawToggles = io.steps.filter((step) => step.op === "raw");
  assertEquals(rawToggles, [
    { op: "raw", value: true },
    { op: "raw", value: false },
  ]);
});
