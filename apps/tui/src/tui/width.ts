// Display-width measurement for the thin renderer (promoted from the issue #9
// spike evidence; docs/research/deno-tui-candidates.md section 5).
//
// A code-point East Asian width table (what `@std/cli/unicode-width` and
// Cliffy share) over-counts ZWJ emoji (8 columns for a family that renders in
// 2). Text is therefore segmented into graphemes first and ZWJ emoji clusters
// are special-cased to one wide glyph. Combining marks measure 0 and a
// regional-indicator pair measures 2 in the std table, so they are handled by
// measuring each cluster with that table.

import { unicodeWidth } from "@std/cli/unicode-width";

export interface Cluster {
  readonly text: string;
  readonly width: number;
}

const ZWJ = 0x200d;

let segmenter: Intl.Segmenter | undefined;

/** Split text into grapheme clusters (never empty for non-empty input). */
export function splitGraphemes(text: string): readonly string[] {
  if (text === "") {
    return [];
  }
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].map((part) => part.segment);
}

/** Column width of one grapheme cluster as a modern terminal renders it. */
export function clusterWidth(cluster: string): number {
  if (cluster.includes(String.fromCodePoint(ZWJ))) {
    return 2;
  }
  return unicodeWidth(cluster);
}

/** Split text into graphemes with their display widths. */
export function clustersOf(text: string): readonly Cluster[] {
  return splitGraphemes(text).map((grapheme) => ({
    text: grapheme,
    width: clusterWidth(grapheme),
  }));
}

/** Display width of text in terminal columns. */
export function measureWidth(text: string): number {
  if (text === "") {
    return 0;
  }
  return clustersOf(text).reduce((sum, cluster) => sum + cluster.width, 0);
}

/** Visible prefix of `text` that fits in `columns`; never splits a grapheme. */
export function truncateTo(text: string, columns: number): string {
  let remaining = columns;
  const parts: string[] = [];
  for (const cluster of clustersOf(text)) {
    if (cluster.width > remaining) {
      break;
    }
    parts.push(cluster.text);
    remaining -= cluster.width;
  }
  return parts.join("");
}

/** Right-pad or truncate `text` so the result is exactly `columns` wide. */
export function padTo(text: string, columns: number): string {
  const width = measureWidth(text);
  if (width === columns) {
    return text;
  }
  if (width > columns) {
    return truncateTo(text, columns);
  }
  return text + " ".repeat(columns - width);
}
