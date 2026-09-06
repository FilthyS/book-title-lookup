import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function testFiles(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await testFiles(path)));
    } else if (entry.name.endsWith("_test.ts")) {
      found.push(path);
    }
  }
  return found;
}

const files = [
  ...(await testFiles("apps")),
  ...(await testFiles("packages")),
  ...(await testFiles("testing")),
].sort();

const result = spawnSync(
  process.execPath,
  [
    "--import=tsx",
    "--import=./testing/test-compat.ts",
    "--test",
    "--test-concurrency=1",
    ...files,
  ],
  { stdio: "inherit" },
);

process.exitCode = result.status ?? 1;
