/**
 * Node test-harness bridge for the behavioral suite's legacy registration and
 * fixture I/O calls. It delegates entirely to `node:test` and `node:fs`, and is
 * never included in the production bundle.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";

function denoOs(): "windows" | "darwin" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

const testRuntime = {
  build: { os: denoOs() },
  cwd: () => process.cwd(),
  mkdir,
  readTextFile: (path: string | URL) => readFile(path, "utf8"),
  writeTextFile: (path: string | URL, data: string) =>
    writeFile(path, data, "utf8"),
  remove: (
    path: string | URL,
    options: { readonly recursive?: boolean } = {},
  ) =>
    rm(path, {
      ...(options.recursive === undefined
        ? {}
        : { recursive: options.recursive }),
      force: false,
    }),
  readDir(path: string | URL) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          yield {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            isSymlink: entry.isSymbolicLink(),
          };
        }
      },
    };
  },
  test,
};

declare global {
  var Deno: typeof testRuntime;
}

globalThis.Deno = testRuntime;
