import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const biomeLauncher = join(
  projectRoot,
  "node_modules",
  "@biomejs",
  "biome",
  "bin",
  "biome",
);

test("Biome accepts this config when the checkout is nested under another root", async () => {
  const fixtureRoot = join(projectRoot, ".tmp", "nested-biome-config");
  const nestedProject = join(fixtureRoot, "worktree");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(nestedProject, { recursive: true });

  try {
    await writeFile(
      join(fixtureRoot, "biome.json"),
      JSON.stringify({ root: true }),
      "utf8",
    );
    await writeFile(
      join(nestedProject, "biome.json"),
      await readFile(join(projectRoot, "biome.json"), "utf8"),
      "utf8",
    );
    await writeFile(
      join(nestedProject, "sample.js"),
      "export const ok = true;\n",
    );

    const result = spawnSync(
      process.execPath,
      [biomeLauncher, "lint", "--diagnostic-level=error", "."],
      { cwd: nestedProject, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `Biome rejected a nested checkout:\n${result.stdout}${result.stderr}`,
    );
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /nested root configuration/i,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
