/**
 * Single version stamp for the issue #32 build.
 *
 * `--version` prints `${APP_NAME} ${VERSION}` (issue #12 section 3.1, X3).
 * The distribution slice replaces the value here with release-stamp tooling;
 * until then it matches the workspace package versions (0.1.0).
 */

export const APP_NAME = "book-title";
export const VERSION = "0.1.0";

export function versionLine(): string {
  return `${APP_NAME} ${VERSION}`;
}
