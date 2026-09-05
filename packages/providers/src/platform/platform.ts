/**
 * Platform identification for the locator. Directory discovery never imports
 * Core or terminal code; it is a pure function of an injected environment
 * reader plus this platform kind.
 */

export type PlatformKind = "windows" | "darwin" | "linux";

export function detectPlatformKind(os: typeof Deno.build.os): PlatformKind {
  switch (os) {
    case "windows":
      return "windows";
    case "darwin":
      return "darwin";
    default:
      return "linux";
  }
}

export const APP_DIRECTORY_NAME = "book-title-lookup";
