// Grapheme segmentation helpers shared by the pure layer and the thin
// renderer. Intl.Segmenter is available in the Deno runtime and in tests.

let segmenter: Intl.Segmenter | undefined;

export function splitGraphemes(text: string): readonly string[] {
  if (text === "") {
    return [];
  }
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].map((part) => part.segment);
}

export function graphemeCount(text: string): number {
  return splitGraphemes(text).length;
}
