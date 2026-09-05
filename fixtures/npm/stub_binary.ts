#!/usr/bin/env node
/**
 * Source for a real, runnable platform binary used only by the launcher
 * contract tests. Compiled on the current host with `deno compile` (no
 * committed binaries) into a temp file, then exported through a fabricated
 * platform package so the launcher can spawn it like a real distribution
 * binary.
 *
 * Behavior (documented in the launcher contract test):
 *   - echoes `stub-ok <args...>` to stdout;
 *   - echoes `stub-err <args...>` to stderr when `--stderr` is present;
 *   - exits with the integer value of the first argument when that argument is
 *     a plain integer (a synthetic application exit code), otherwise 0. Only
 *     the first argument is interpreted, so an option value such as
 *     `--limit 5` in the argv-passthrough case never short-circuits the relay.
 */

const args = Deno.args;
const stdout = args.includes("--stderr") ? [] : args;
const stderr = args.includes("--stderr") ? args : [];

if (stdout.length > 0) {
  Deno.stdout.write(new TextEncoder().encode(`stub-ok ${stdout.join(" ")}\n`));
}
if (stderr.length > 0) {
  Deno.stderr.write(new TextEncoder().encode(`stub-err ${stderr.join(" ")}\n`));
}

let exitCode = 0;
if (args.length > 0 && /^-?[0-9]+$/.test(args[0])) {
  exitCode = Number(args[0]);
}
Deno.exit(exitCode);
