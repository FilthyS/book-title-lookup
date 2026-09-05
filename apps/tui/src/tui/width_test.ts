// Width corpus tests promoted from the issue #9 spike evidence
// (docs/research/deno-tui-candidates.md section 5). Final visual confirmation
// on Windows Terminal is a manual checklist item.

import { assertEquals } from "@std/assert";
import { clustersOf, measureWidth, padTo, truncateTo } from "./width.ts";

interface CorpusRow {
  readonly label: string;
  readonly sample: string;
  readonly expected: number;
}

const CORPUS: readonly CorpusRow[] = [
  { label: "CJK title", sample: "百年孤独", expected: 8 },
  { label: "CJK title", sample: "小王子", expected: 6 },
  { label: "ascii digits", sample: "1984", expected: 4 },
  { label: "mixed CJK ascii", sample: "中文abc", expected: 7 },
  { label: "combining", sample: "a\u0300b", expected: 2 },
  { label: "combining", sample: "e\u0301x", expected: 2 },
  { label: "emoji", sample: "😀", expected: 2 },
  { label: "flag pair", sample: "🇯🇵", expected: 2 },
  { label: "ZWJ family", sample: "👨‍👩‍👧‍👦", expected: 2 },
  { label: "latin accent", sample: "café", expected: 4 },
];

Deno.test("width corpus matches modern terminal expectations", () => {
  for (const row of CORPUS) {
    assertEquals(measureWidth(row.sample), row.expected, row.label);
  }
});

Deno.test("clusters split a ZWJ family into one cluster", () => {
  const clusters = clustersOf("👨‍👩‍👧‍👦x");
  assertEquals(clusters.length, 2);
  assertEquals(clusters[0].text, "👨‍👩‍👧‍👦");
  assertEquals(clusters[0].width, 2);
  assertEquals(clusters[1].text, "x");
  assertEquals(clusters[1].width, 1);
});

Deno.test("truncateTo never splits a grapheme or exceeds the budget", () => {
  assertEquals(truncateTo("百年孤独", 4), "百年");
  assertEquals(truncateTo("小王子", 6), "小王子");
  assertEquals(truncateTo("👨‍👩‍👧‍👦ab", 3), "👨‍👩‍👧‍👦a");
  assertEquals(truncateTo("abc", 10), "abc");
});

Deno.test("padTo returns lines with the exact requested display width", () => {
  for (const row of CORPUS) {
    const padded = padTo(row.sample, 60);
    assertEquals(measureWidth(padded), 60, `${row.label} padded to 60`);
    assertEquals(padded.slice(0, row.sample.length), row.sample);
  }
  const truncated = padTo("小王子x".repeat(20), 20);
  assertEquals(measureWidth(truncated), 20);
});
