/**
 * Tests for the `npm pack --json` file-list parser used by verify.ts
 * (npm-release-topology.md section 11.1). Pure, no subprocess.
 */

import { assertEquals } from "@std/assert";
import { parsePackFileList } from "./verify.ts";

const SAMPLE = `[{"filename":"book-title-lookup-1.2.3.tgz",
  "files":[
    {"path":"package.json","size":420,"mode":420},
    {"path":"bin/book-title.js","size":5120,"mode":493}
  ]}]`;

Deno.test("verify/parse extracts ordered package file paths and sizes", () => {
  const files = parsePackFileList(SAMPLE);
  // Paths are returned alphabetically sorted.
  assertEquals(files, [
    { path: "bin/book-title.js", size: 5120 },
    { path: "package.json", size: 420 },
  ]);
});

Deno.test("verify/parse tolerates an npm legacy package/ prefix", () => {
  const legacy = `[{"files":[{"path":"package/package.json","size":1}]}]`;
  assertEquals(parsePackFileList(legacy), [{ path: "package.json", size: 1 }]);
});
