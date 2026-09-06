/**
 * Coordinator messages (issue #13 section 6).
 *
 * Editing messages arrive from the input adapter; workflow intents from the
 * user, the CLI driver, or the effect runner; result messages only from the
 * effect runner.
 */

import type {
  ExternalReference,
  LanguageTag,
  ResolveOutcome,
  SearchOutcome,
  TitleLookupOutcome,
} from "../../../../packages/core/src/module.ts";
import type { FieldName, RequestSlot } from "./state.ts";

export type Message =
  | { readonly type: "focusField"; readonly field: FieldName }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "backspace" }
  | { readonly type: "delete" }
  | { readonly type: "moveCursor"; readonly step: -1 | 1 }
  | { readonly type: "home" }
  | { readonly type: "end" }
  | { readonly type: "clearField" }
  | { readonly type: "newSearch" }
  | { readonly type: "submitSearch" }
  | { readonly type: "cancelRequest" }
  | { readonly type: "moveSelection"; readonly step: -1 | 1 }
  | { readonly type: "confirmCandidate" }
  | { readonly type: "resolveReference"; readonly reference: ExternalReference }
  | { readonly type: "viewTitles" }
  | {
    readonly type: "changeTargetLanguages";
    readonly tags: readonly LanguageTag[];
  }
  | { readonly type: "selectGroup"; readonly index: number }
  | { readonly type: "back" }
  | { readonly type: "quit" }
  | { readonly type: "interrupt" }
  | {
    readonly type: "requestStarted";
    readonly slot: RequestSlot;
    readonly requestId: string;
  }
  | {
    readonly type: "searchOutcome";
    readonly requestId: string;
    readonly outcome: SearchOutcome;
  }
  | {
    readonly type: "resolveOutcome";
    readonly requestId: string;
    readonly outcome: ResolveOutcome;
  }
  | {
    readonly type: "titlesOutcome";
    readonly requestId: string;
    readonly outcome: TitleLookupOutcome;
  };
