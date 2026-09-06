import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist", "book-title.js");

await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ["apps/tui/src/bin.ts"],
  format: "esm",
  legalComments: "external",
  minify: false,
  outfile: output,
  platform: "node",
  sourcemap: "external",
  sourcesContent: true,
  target: "node22",
});

await chmod(output, 0o755);
console.log(`built ${output}`);
