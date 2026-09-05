/**
 * Federated composition for the Open Library vertical slice (issue #6 seam,
 * issue #8 package shape).
 *
 * The real catalog service is Core's CatalogService composed over the
 * OpenLibrary evidence source. This is the production composition the
 * application uses by default; tests keep the explicit module-level fake.
 */

import { CatalogService } from "../../../core/src/catalog/service.ts";
import type { BookTitleCatalog } from "../../../core/src/module.ts";
import type { ProviderRuntime } from "../runtime/runtime.ts";
import { OpenLibrarySource } from "../openlibrary/source.ts";

export interface OpenLibraryCompositionOptions {
  readonly runtime: ProviderRuntime;
  readonly offline?: boolean;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

/** Build the real Open Library-composed catalog service. */
export function createOpenLibraryCatalog(
  options: OpenLibraryCompositionOptions,
): BookTitleCatalog {
  const source = new OpenLibrarySource(options.runtime, {
    offline: options.offline === true,
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
  });
  return new CatalogService([source]);
}
