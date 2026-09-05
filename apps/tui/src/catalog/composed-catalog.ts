/**
 * apps/tui composition-root wiring for the real catalog (ticket #34 OL,
 * ticket #35 two-source). The application seam is Core's CatalogService
 * composed over the Open Library and Wikidata evidence sources and their
 * deep ProviderRuntimes; cache and settings come from the issue #10/#32
 * seams. Tests keep the explicit fixture catalog and never take this default
 * path.
 */

import { FileEntryStore } from "../../../../packages/providers/src/cache/file-entry-store.ts";
import { ProviderRuntime } from "../../../../packages/providers/src/runtime/runtime.ts";
import { systemEffects } from "../../../../packages/providers/src/runtime/effects.ts";
import {
  createOpenLibraryCatalog,
  createTwoSourceCatalog,
  createWikidataCatalog,
} from "../../../../packages/providers/src/federated/composition.ts";
import {
  openLibraryRuntimeConfig,
  PROVIDER_DECODER_SCHEMA_VERSIONS,
} from "../../../../packages/providers/src/openlibrary/config.ts";
import { wikidataRuntimeConfig } from "../../../../packages/providers/src/wikidata/config.ts";
import type { BookTitleCatalog } from "../../../../packages/core/src/module.ts";
import type { Clock } from "../../../../packages/providers/src/cache/clock.ts";
import type { FileSystemSeam } from "../../../../packages/providers/src/cache/fs-seam.ts";
import type { RandomSource } from "../../../../packages/providers/src/cache/random.ts";
import type { PlatformKind } from "../../../../packages/providers/src/platform/platform.ts";
import type { ResolvedSettings } from "../settings/resolver.ts";
import { VERSION } from "../version.ts";

export interface ComposedCatalogDeps {
  readonly settings: ResolvedSettings;
  readonly clock: Clock;
  readonly fs: FileSystemSeam;
  readonly random: RandomSource;
  readonly platform: PlatformKind;
}

export interface ComposedCatalogOptions {
  /** Which sources to compose. Defaults to both Open Library and Wikidata. */
  readonly sources?: readonly ("openlibrary" | "wikidata")[];
  /** Edition-expansion page cap for the Open Library source. */
  readonly pageSize?: number;
  readonly maxPages?: number;
}

/**
 * Construct a FileEntryStore shared by every provider runtime for resolved
 * settings. Cache keys are provider-scoped so one store serves both sources.
 */
function makeStore(deps: ComposedCatalogDeps): FileEntryStore {
  return new FileEntryStore({
    cacheRoot: deps.settings.cacheRoot,
    clock: deps.clock,
    fs: deps.fs,
    random: deps.random,
    decoderSchemaVersions: PROVIDER_DECODER_SCHEMA_VERSIONS,
    platform: deps.platform,
  });
}

/** Construct the real two-source (Open Library + Wikidata) composed catalog. */
export function buildComposedCatalog(
  deps: ComposedCatalogDeps,
  options: ComposedCatalogOptions = {},
): BookTitleCatalog {
  const store = makeStore(deps);
  const offline = deps.settings.offline === true;
  const requested = options.sources ?? ["openlibrary", "wikidata"];
  if (requested.length === 1 && requested[0] === "openlibrary") {
    const runtime = new ProviderRuntime(
      systemEffects,
      store,
      openLibraryRuntimeConfig({
        version: VERSION,
        contact: deps.settings.contact,
      }),
    );
    return createOpenLibraryCatalog({
      runtime,
      offline,
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    });
  }
  if (requested.length === 1 && requested[0] === "wikidata") {
    const runtime = new ProviderRuntime(
      systemEffects,
      store,
      wikidataRuntimeConfig({
        version: VERSION,
        contact: deps.settings.contact,
      }),
    );
    return createWikidataCatalog({ runtime, offline });
  }
  const openLibraryRuntime = new ProviderRuntime(
    systemEffects,
    store,
    openLibraryRuntimeConfig({
      version: VERSION,
      contact: deps.settings.contact,
    }),
  );
  const wikidataRuntime = new ProviderRuntime(
    systemEffects,
    store,
    wikidataRuntimeConfig({
      version: VERSION,
      contact: deps.settings.contact,
    }),
  );
  return createTwoSourceCatalog({
    openLibrary: {
      runtime: openLibraryRuntime,
      offline,
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    },
    wikidata: { runtime: wikidataRuntime, offline },
  });
}

/**
 * Single-Open-Library composed catalog (kept for the OL-only fixture rows
 * that drive one source; ticket #35 defaults the production CLI to the
 * two-source composition above).
 */
export function buildComposedOpenLibraryCatalog(
  deps: ComposedCatalogDeps,
  options: Omit<ComposedCatalogOptions, "sources"> = {},
): BookTitleCatalog {
  return buildComposedCatalog(deps, {
    sources: ["openlibrary"],
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
  });
}
