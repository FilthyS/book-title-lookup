// Synthetic candidates used by both variants to simulate a resolved search.
// They reuse the acceptance corpus from docs/product-spec.md.

import type { Candidate } from "./model.ts";

export const DEMO_CANDIDATES: readonly Candidate[] = [
  { id: "c-100", title: "百年孤独", language: "zh" },
  { id: "c-100-en", title: "One Hundred Years of Solitude", language: "en" },
  { id: "c-100-ja", title: "百年の孤独", language: "ja" },
  { id: "c-2", title: "小王子", language: "zh" },
  { id: "c-2-en", title: "The Little Prince", language: "en" },
];

/** Simulated lookup effect; returns after one microtask so the "searching" frame renders. */
export async function simulateSearch(
  query: string,
): Promise<readonly Candidate[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") {
    return [];
  }
  const matches = DEMO_CANDIDATES.filter((candidate) => {
    return candidate.title.toLocaleLowerCase().includes(needle) ||
      candidate.language.toLocaleLowerCase().includes(needle);
  });
  return matches.length > 0 ? matches : DEMO_CANDIDATES;
}
