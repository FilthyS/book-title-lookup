/**
 * The module-level fake for this slice (issue #6 fake seam).
 *
 * `createFakeBookTitleCatalog` wires the real Core `CatalogService` to the
 * fixture-backed evidence sources over the acceptance corpus. CLI and
 * coordinator tests and the fixture-backed composition root run against it;
 * no live source is ever contacted.
 */

import { CatalogService } from "../../../../packages/core/src/catalog/service.ts";
import type { BookTitleCatalog } from "../../../../packages/core/src/module.ts";
import { createFixtureSources } from "./fixture-evidence.ts";

export function createFakeBookTitleCatalog(): BookTitleCatalog {
  return new CatalogService(createFixtureSources());
}
