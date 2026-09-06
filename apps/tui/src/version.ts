/**
 * Single application version stamp sourced from the npm package metadata.
 *
 * `--version` prints `${APP_NAME} ${VERSION}` (issue #12 section 3.1, X3).
 * esbuild includes the JSON value in the release bundle, so `--version`, the
 * package, and the release tag can be checked against one source of truth.
 */

import packageMetadata from "../../../package.json" with { type: "json" };

export const APP_NAME = "book-title";
export const VERSION = packageMetadata.version;

export function versionLine(): string {
  return `${APP_NAME} ${VERSION}`;
}
