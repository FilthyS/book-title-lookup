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
      JSON.stringify({
        root: true,
        formatter: { indentStyle: "tab" },
      }),
      "utf8",
    );
    await writeFile(
      join(nestedProject, "biome.json"),
      await readFile(join(projectRoot, "biome.json"), "utf8"),
      "utf8",
    );
    await writeFile(
      join(nestedProject, "sample.js"),
      "export const value = {\n  nested: true,\n};\n",
    );

    const discovery = spawnSync(
      process.execPath,
      [biomeLauncher, "lint", "--diagnostic-level=error", "."],
      { cwd: nestedProject, encoding: "utf8" },
    );
    assert.equal(
      discovery.status,
      0,
      `Biome rejected a nested checkout:\n${discovery.stdout}${discovery.stderr}`,
    );
    assert.doesNotMatch(
      `${discovery.stdout}${discovery.stderr}`,
      /nested root configuration/i,
    );

    const explicitConfig = spawnSync(
      process.execPath,
      [biomeLauncher, "format", "--config-path=biome.json", "sample.js"],
      { cwd: nestedProject, encoding: "utf8" },
    );
    assert.equal(
      explicitConfig.status,
      0,
      `Biome inherited formatting from outside the checkout:\n${explicitConfig.stdout}${explicitConfig.stderr}`,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
