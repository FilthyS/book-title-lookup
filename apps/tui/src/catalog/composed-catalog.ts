/**
 * apps/tui composition-root wiring for the real Open Library catalog (ticket
 * #34). The application seam is Core's CatalogService composed over the OL
 * evidence source and the deep ProviderRuntime; cache and settings come from
 * the issue #10/#32 seams. Tests keep the explicit fixture catalog and never
 * take this default path.
 */

import { FileEntryStore } from "../../../../packages/providers/src/cache/file-entry-store.ts";
import { ProviderRuntime } from "../../../../packages/providers/src/runtime/runtime.ts";
import { systemEffects } from "../../../../packages/providers/src/runtime/effects.ts";
import { createOpenLibraryCatalog } from "../../../../packages/providers/src/federated/composition.ts";
import {
  openLibraryRuntimeConfig,
  PROVIDER_DECODER_SCHEMA_VERSIONS,
} from "../../../../packages/providers/src/openlibrary/config.ts";
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

/** Construct the real Open Library-composed catalog for resolved settings. */
export function buildComposedOpenLibraryCatalog(
  deps: ComposedCatalogDeps,
): BookTitleCatalog {
  const store = new FileEntryStore({
    cacheRoot: deps.settings.cacheRoot,
    clock: deps.clock,
    fs: deps.fs,
    random: deps.random,
    decoderSchemaVersions: PROVIDER_DECODER_SCHEMA_VERSIONS,
    platform: deps.platform,
  });
  const runtime = new ProviderRuntime(
    systemEffects,
    store,
    openLibraryRuntimeConfig({
      version: VERSION,
      contact: deps.settings.contact,
    }),
  );
  return createOpenLibraryCatalog({ runtime, offline: deps.settings.offline });
}
