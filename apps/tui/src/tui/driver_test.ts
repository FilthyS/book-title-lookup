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
  ResolvedWorkRef,
  SearchOutcome,
} from "../../../../packages/core/src/module.ts";
import {
  draftWithTitle,
  type SessionState,
  type TitlesState,
} from "../coordinator/state.ts";
import { initialSession, messageForToken, runTuiSession } from "./driver.ts";
import type { TerminalIo, TerminalSize } from "./terminal.ts";

const SIZE: TerminalSize = { columns: 60, rows: 16 };
const candidateRef = "c-1" as unknown as CandidateRef;
const workRef = "w-1" as unknown as ResolvedWorkRef;

function foundOutcome(): SearchOutcome {
  return {
    status: "found",
    candidates: [
      {
        ref: candidateRef,
        title: "小王子",
        alternativeTitles: [],
        authors: ["Antoine de Saint-Exupéry"],
        contentLanguages: ["zh"],
        references: [{ namespace: "openlibrary:work", value: "OL1W" }],
      },
    ],
    warnings: [],
  };
}

function manyTitlesState(count: number): TitlesState {
  const work = {
    ref: workRef,
    title: "One Hundred Years of Solitude",
    authors: ["Gabriel García Márquez"],
    contentLanguages: ["en"],
    references: [],
  };
  return {
    screen: "titles",
    goal: { kind: "lookup" },
    draft: draftWithTitle("Cien años de soledad"),
    targetLanguages: [],
    snapshot: {
      work,
      origin: { station: "query" },
    },
    payload: {
      work,
      targetLanguages: [],
      status: "found",
      groups: Array.from({ length: count }, (_, index) => ({
        language: "en",
        title: `Title ${index + 1}`,
        subtitle: null,
        level: "verified",
        recommended: index === 0,
        satisfiesRequest: false,
        originalTitle: false,
        attestations: [],
      })),
      warnings: [],
    },
    notice: null,
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

function deferredIo(inputEncoding?: string) {
  let pending: ((value: Uint8Array | null) => void) | null = null;
  const writes: string[] = [];
  const raws: boolean[] = [];
  const io: TerminalIo = {
    inputEncoding,
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

function resizableIo(initialSize: TerminalSize) {
  let size = initialSize;
  let pending: ((value: Uint8Array | null) => void) | null = null;
  let resizeListener: (() => void) | null = null;
  const writes: string[] = [];
  const io: TerminalIo & {
    watchSize(listener: () => void): () => void;
  } = {
    read(): Promise<Uint8Array | null> {
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
    write(text: string): Promise<void> {
      writes.push(text);
      return Promise.resolve();
    },
    setRawMode(): Promise<void> {
      return Promise.resolve();
    },
    size(): TerminalSize {
      return size;
    },
    watchSize(listener: () => void): () => void {
      resizeListener = listener;
      return () => {
        resizeListener = null;
      };
    },
  };
  return {
    io,
    writes,
    resize(next: TerminalSize): void {
      size = next;
      resizeListener?.();
    },
    deliver(bytes: number[]): void {
      if (pending === null) throw new Error("no pending read");
      const resolve = pending;
      pending = null;
      resolve(new Uint8Array(bytes));
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
  assertEquals(messageForToken(candidates, { kind: "text", value: "n" }), {
    type: "newSearch",
  });
});

function allWrites(writes: readonly string[]): string {
  return writes.join("");
}

Deno.test("driver places the native cursor on the query input row", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([...encoder.encode("1984")]);
  await sleep();

  const repaint = term.writes.at(-1) ?? "";
  assertStringIncludes(repaint, "│ 1984");
  assertEquals(repaint.endsWith("\x1b[3;7H\x1b[?25h"), true);

  term.deliver([0x1b, 0x61]);
  assertEquals(await run, 0);
});

Deno.test("driver accepts CP936 Chinese input on Windows terminals", async () => {
  const term = deferredIo("gb18030");
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([0xd6, 0xd0]); // 中 in CP936
  await sleep();

  const repaint = term.writes.at(-1) ?? "";
  assertStringIncludes(repaint, "│ 中");
  assertEquals(repaint.endsWith("\x1b[3;5H\x1b[?25h"), true);

  term.deliver([0x1b, 0x61]);
  assertEquals(await run, 0);
});

Deno.test("driver starts a fresh query from search results with N", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([...encoder.encode("old query"), 0x0d]);
  await sleep();
  catalog.pendingSearches[0].resolve(foundOutcome());
  await sleep();

  term.deliver([0x6e]); // N=new search
  await sleep();
  const repaint = term.writes.at(-1) ?? "";
  assertStringIncludes(repaint, "┌ TITLE INPUT ");
  assertEquals(repaint.includes("old query"), false);
  assertEquals(repaint.endsWith("\x1b[3;3H\x1b[?25h"), true);

  term.deliver([0x1b, 0x61]);
  assertEquals(await run, 0);
});

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
  assertStringIncludes(output, "│ 百年孤独");
  assertStringIncludes(output, "Work candidates — stacked layout");
  assertStringIncludes(output, "小王子");
  // Acquire then restore raw mode.
  assertEquals(term.raws, [true, false]);
  // Terminal was restored after the session ran.
  assertEquals(output.endsWith("\x1b[?25h\x1b[?1049l\x1b[0m"), true);
});

Deno.test("driver switches the production candidate layout with Tab", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([...encoder.encode("百年孤独"), 0x0d]);
  await sleep();
  catalog.pendingSearches[0].resolve(foundOutcome());
  await sleep();

  assertStringIncludes(term.writes.at(-1) ?? "", "stacked layout");
  term.deliver([0x09]); // Tab => compact layout
  await sleep();
  assertStringIncludes(term.writes.at(-1) ?? "", "compact layout");

  term.deliver([0x03]);
  assertEquals(await run, 130);
});

Deno.test("driver repaints a stacked title list when the terminal shrinks", async () => {
  const term = resizableIo({ columns: 78, rows: 40 });
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({
    io: term.io,
    catalog,
    seed: manyTitlesState(12),
  });

  await sleep();
  const writesBeforeResize = term.writes.length;
  term.resize({ columns: 78, rows: 29 });
  await sleep();
  const repaint = term.writes.at(-1) ?? "";
  const repainted = term.writes.length > writesBeforeResize;

  term.deliver([0x03]);
  assertEquals(await run, 130);
  assertEquals(repainted, true);
  assertStringIncludes(repaint, "more title group");
  assertEquals(repaint.includes("Title 9"), false);
});

Deno.test("driver does not scroll a full-height stacked title frame", async () => {
  const term = resizableIo({ columns: 60, rows: 18 });
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({
    io: term.io,
    catalog,
    seed: manyTitlesState(12),
  });

  await sleep();
  term.deliver(Array.from({ length: 6 }, () => [0x1b, 0x5b, 0x42]).flat());
  await sleep();
  const repaint = term.writes.at(-1) ?? "";

  term.deliver([0x03]);
  assertEquals(await run, 130);
  assertStringIncludes(repaint, "earlier title group");
  assertStringIncludes(repaint, "more title group");
  assertEquals(repaint.endsWith("\r\n"), false);
});

Deno.test("driver handles a standalone Esc without waiting for another key", async () => {
  const term = deferredIo();
  const catalog = new ScriptedCatalog();
  const run = runTuiSession({ io: term.io, catalog });

  await sleep();
  term.deliver([...encoder.encode("百年孤独"), 0x0d]);
  await sleep();
  catalog.pendingSearches[0].resolve(foundOutcome());
  await sleep();

  term.deliver([0x1b]);
  await sleep(50);
  const repaintAfterEsc = term.writes.at(-1) ?? "";

  term.deliver([0x03]);
  assertEquals(await run, 130);
  assertStringIncludes(repaintAfterEsc, "│ 百年孤独");
  assertEquals(repaintAfterEsc.includes("Work candidates"), false);
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
  assertStringIncludes(allWrites(term.writes), "│ 活着");
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
