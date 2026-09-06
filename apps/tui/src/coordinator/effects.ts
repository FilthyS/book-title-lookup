/**
 * Coordinator effects (issue #13 section 7).
 *
 * Effects are pure descriptors returned by the reducer. The runner performs
 * them; effects never carry a request id because id allocation is the
 * runner's job.
 */

import type {
  BookQuery,
  ExternalReference,
  ResolvedWorkRef,
  TitleQuery,
} from "../../../../packages/core/src/module.ts";

export type Effect =
  | { readonly kind: "search"; readonly query: BookQuery }
  | { readonly kind: "resolve"; readonly target: ResolveTargetEffect }
  | {
      readonly kind: "findTitles";
      readonly workRef: ResolvedWorkRef;
      readonly query: TitleQuery;
    }
  | { readonly kind: "abort"; readonly requestId: string }
  | { readonly kind: "exit"; readonly code: 0 | 130 };

export type ResolveTargetEffect =
  | { readonly kind: "candidate"; readonly ref: string }
  | {
      readonly kind: "externalReference";
      readonly reference: ExternalReference;
    };
