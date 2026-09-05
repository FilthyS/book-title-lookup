/**
 * Book Title Lookup Core
 *
 * The domain layer owns the catalog module seam (`BookTitleCatalog`), the
 * deterministic reconciliation pipeline of issue #7, and the internal
 * evidence port that Providers implements later. Core never imports
 * terminal, fetch, environment, or Providers code.
 */

export * from "./domain.ts";
export * from "./module.ts";
export * from "./normalize.ts";
export * from "./evidence.ts";
export * from "./internal-port.ts";
export * from "./reconcile.ts";
export * from "./group.ts";
export * from "./recommend.ts";
export { CatalogService } from "./catalog/service.ts";
