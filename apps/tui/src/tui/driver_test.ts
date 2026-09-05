// Interactive driver tests. These drive the full update-render loop against
// memory streams and a scripted catalog (issue #6 fake seam) whose outcomes we
// resolve on demand, proving acquire/restore ordering, the reducer-driven
// screen transitions, requestStarted/outcome delivery, and cancellation.

import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  BookQuery,
  BookTitleCatalog,
  CandidateRef,
  RequestOptions,
  SearchOutcome,
} from "../../../../packages/core/src/module.ts";
import type { SessionState } from "../coordinator/state.ts";
import { initialSession, messageForToken, runTuiSession } from "./driver.ts";
import type { TerminalIo, TerminalSize } from "./terminal.ts";

const SIZE: TerminalSize = { columns: 60, rows: 16 };
const candidateRef = "c-1" as unknown as CandidateRef;

function foundOutcome(): SearchOutcome {
  return {
    status: "found",
    candidates: [{
      ref: candidateRef,
      title: "小王子",
      alternativeTitles: [],
      authors: ["Antoine de Saint-Exupéry"],
      contentLanguages: ["zh"],
      references: [{ namespace: "openlibrary:work", value: "OL1W" }],
    }],
    warnings: [],
  };
}

interface SearchCall {
  readonly query: BookQuery;
  readonly resolve: (outcome: SearchOutcome) => void;
  readonly signal: AbortSignal;
}

/** A catalog whose search outcome we resolve by hand (no network). */
class ScriptedCatalog implements BookTitleCatalog {
  readonly pendingSearches: SearchCall[] = [];

  search(query: BookQuery, options?: RequestOptions): Promise<SearchOutcome> {
    const signal = options?.signal ?? new AbortController().signal;
    return new Promise((resolve) => {
      this.pendingSearches.push({ query, resolve, signal });
    });
  }
  resolve(): Promise<never> {
    return Promise.reject(new Error("resolve not used"));
  }
  findTitles(): Promise<never> {
    return Promise.reject(new Error("findTitles not used"));
  }
}

function deferredIo() {
  let pending: ((value: Uint8Array | null) => void) | null = null;
  const writes: string[] = [];
  const raws: boolean[] = [];
  const io: TerminalIo = {
    read(): Promise<Uint8Array | null> {
      if (pending !== null) throw new Error("read overlap");
      return new Promise((resolve) => {
        pending = (value) => {
          pending = null;
          resolve(value);
        };
      });
    },
    write(text: string): Promise<void> {
      writes.push(text);
      return Promise.resolve();
    },
    setRawMode(raw: boolean): Promise<void> {
      raws.push(raw);
      return Promise.resolve();
    },
    size(): TerminalSize {
      return SIZE;
    },
  };
  return {
    io,
    writes,
    raws,
    deliver(bytes: number[]): void {
      if (pending === null) throw new Error("no pending read");
      pending(new Uint8Array(bytes));
    },
  };
}

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const encoder = new TextEncoder();

Deno.test("driver messageForToken maps keys to coordinator messages", () => {
  const query = initialSession();
  assertEquals(messageForToken(query, { kind: "text", value: "百年" }), {
    type: "text",
    value: "百年",
  });
  assertEquals(messageForToken(query, { kind: "escape" }), { type: "quit" });
  assertEquals(messageForToken(query, { kind: "cancel" }), {
    type: "interrupt",
  });

  const typed = query;
  const searching = {
    ...typed,
    screen: "searching" as const,
    query: { title: "百年孤独" },
    requestId: null,
  } as SessionState;
  assertEquals(messageForToken(searching, { kind: "cancel" }), {
    type: "interrupt",
  });
  assertEquals(messageForToken(searching, { kind: "escape" }), {
    type: "back",
  });

  const candidates = {
    ...typed,
    screen: "candidates" as const,
    pool: { origin: "search" as const, rows: [], warnings: [] },
    selected: 0,
    notice: null,
  } as SessionState;
  assertEquals(messageForToken(candidates, { kind: "down" }), {
    type: "moveSelection",
    step: 1,
  });
  assertEquals(messageForToken(candidates, { kind: "enter" }), {
    type: "confirmCandidate",
  });
});

function allWrites(writes: readonly string[]): string {
  return writes.join("");
}

Deno.test("driver runs a search to candidates and restores on interrupt", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([...encoder.encode("百年孤独"), 0x0d]);
  await sleep();
  // The submitSearch effect should have reached the catalog.
  assertEquals(catalog.pendingSearches.length, 1);
  // Resolve the search; the outcome arrives through the event queue.
  catalog.pendingSearches[0].resolve(foundOutcome());
  await sleep();

  term.deliver([0x03]); // Ctrl+C => interrupt
  const code = await run;

  assertEquals(code, 130);
  const output = allWrites(term.writes);
  assertStringIncludes(output, "Search: 百年孤独");
  assertStringIncludes(output, "Work candidates:");
  assertStringIncludes(output, "小王子");
  // Acquire then restore raw mode.
  assertEquals(term.raws, [true, false]);
  // Terminal was restored after the session ran.
  assertEquals(output.endsWith("\x1b[?25h\x1b[?1049l\x1b[0m"), true);
});

Deno.test("driver dispatches interrupt from an injected OS signal abort", async () => {
  const controller = new AbortController();
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({
    io: term.io,
    catalog,
    signal: controller.signal,
  });

  await sleep();
  // Start a search that stays pending.
  term.deliver([...encoder.encode("围城"), 0x0d]);
  await sleep();
  assertEquals(catalog.pendingSearches.length, 1);
  const call = catalog.pendingSearches[0];

  // The injected signal fires (OS SIGINT/SIGTERM), not a Ctrl+C byte.
  controller.abort();
  const code = await run;

  assertEquals(code, 130);
  assertEquals(call.signal.aborted, true, "in-flight request was aborted");
  // Terminal was acquired then restored, so an external interrupt also
  // restores the terminal before the process exits 130.
  assertEquals(term.raws, [true, false]);
  assertEquals(
    allWrites(term.writes).endsWith("\x1b[?25h\x1b[?1049l\x1b[0m"),
    true,
  );
});

Deno.test("driver releases a partial acquire when terminal acquire fails", async () => {
  const raws: boolean[] = [];
  // Raw mode succeeds but the alternate-screen write fails mid-acquire.
  const io: TerminalIo = {
    read(): Promise<Uint8Array | null> {
      return Promise.resolve(null);
    },
    write(): Promise<void> {
      return Promise.reject(new Error("write failed"));
    },
    setRawMode(raw: boolean): Promise<void> {
      raws.push(raw);
      return Promise.resolve();
    },
    size(): TerminalSize {
      return SIZE;
    },
  };
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io, catalog });
  await run.then(
    () => {
      throw new Error("run should have rejected on acquire failure");
    },
    () => {},
  );
  // Raw mode was turned on, then restored despite the failed acquire.
  assertEquals(raws, [true, false]);
});

Deno.test("driver quits normally from the query screen with exit 0", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  // ESC then a harmless byte; the decoder emits escape (then text) and the
  // escape quits the session before the text token is handled.
  term.deliver([0x1b, 0x61]);
  const code = await run;
  assertEquals(code, 0);
  assertEquals(term.raws, [true, false]);
  assertEquals(allWrites(term.writes).endsWith("\x1b[0m"), true);
});

Deno.test("driver aborts an in-flight search on back and drops the late outcome", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  // Type a title and submit; the search starts and stays pending.
  term.deliver([...encoder.encode("活着"), 0x0d]);
  await sleep();
  assertEquals(catalog.pendingSearches.length, 1);
  const call = catalog.pendingSearches[0];

  // ESC then a harmless byte -> escape (back) at the searching screen, which
  // aborts the in-flight request and returns to the query screen.
  term.deliver([0x1b, 0x62]);
  await sleep();
  assertEquals(call.signal.aborted, true, "in-flight request was aborted");
  assertStringIncludes(allWrites(term.writes), "Search: 活着");
  assertStringIncludes(allWrites(term.writes), "Enter=search  Esc=quit");

  // Deliver the late cancelled outcome; the reducer drops it (state unchanged).
  catalog.pendingSearches[0].resolve({ status: "cancelled" });
  await sleep();

  // Quit cleanly.
  term.deliver([0x1b, 0x63]);
  const code = await run;
  assertEquals(code, 0);
  assertEquals(term.raws, [true, false]);
});
