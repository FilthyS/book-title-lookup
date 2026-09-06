import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const forbiddenScripts = ["preinstall", "install", "postinstall", "prepare"];
for (const name of forbiddenScripts) {
  if (packageJson.scripts?.[name] !== undefined) {
    throw new Error(`forbidden npm lifecycle script: ${name}`);
  }
}
for (const field of ["dependencies", "optionalDependencies"]) {
  if (packageJson[field] !== undefined) {
    throw new Error(`published package must have zero ${field}`);
  }
}

const bundle = await readFile("dist/book-title.js", "utf8");
if (!bundle.startsWith("#!/usr/bin/env node\n")) {
  throw new Error("dist/book-title.js is missing the Node shebang");
}

const npmCli = process.env.npm_execpath;
if (npmCli === undefined) {
  throw new Error("verify-package must run through npm");
}
const packed = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json"],
  { encoding: "utf8" },
);
if (packed.status !== 0) {
  throw new Error(
    `npm pack --dry-run failed:\n${packed.error?.message ?? packed.stderr}`,
  );
}
const report = JSON.parse(packed.stdout)[0];
const actual = report.files.map((file) => file.path).sort();
const expected = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES",
  "dist/book-title.js",
  "dist/book-title.js.map",
  "package.json",
].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `unexpected package contents:\n${actual.map((path) => `- ${path}`).join("\n")}`,
  );
}

console.log(
  `verified ${report.filename}: ${report.entryCount} files, ${report.size} bytes`,
);
