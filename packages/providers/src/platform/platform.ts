/**
 * Platform identification for the locator. Directory discovery never imports
 * Core or terminal code; it is a pure function of an injected environment
 * reader plus this platform kind.
 */

export type PlatformKind = "windows" | "darwin" | "linux";

export function detectPlatformKind(os: string): PlatformKind {
  switch (os) {
    case "win32":
    case "windows":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      throw new RangeError(`unsupported platform: ${os}`);
  }
}

export const APP_DIRECTORY_NAME = "book-title-lookup";
