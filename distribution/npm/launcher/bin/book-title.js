#!/usr/bin/env node
"use strict";

/**
 * book-title-lookup Node launcher (npm-release-topology.md section 6).
 *
 * This is the single documented entry point. It validates the Node floor,
 * resolves the OS/CPU platform optional dependency through npm's normal
 * dependency graph, validates the exported binary path, and spawns the
 * Deno-compiled binary with inherited stdio so it owns the terminal and the
 * JSON stream. It never writes to stdout on success paths, performs no
 * network I/O, and has no lifecycle-script or publish behavior.
 *
 * Reserved launcher-only exit code 70 signals a distribution failure
 * (unsupported platform, omitted optional dependency, or unreadable binary).
 * The application outcome codes (0, 2, 3, 4, 5, 10, 130) pass through
 * unchanged.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const DISTRIBUTION_ERROR = 70;
const NODE_FLOOR = 18;
const SUPPORTED_TEXT = "win32/x64, linux/x64, darwin/x64, darwin/arm64";

// Frozen platform table (npm-release-topology.md section 3.1). The keys and
// the optional dependency package names must match exactly.
const PLATFORM_PACKAGES = {
  win32: { x64: "book-title-lookup-win32-x64" },
  linux: { x64: "book-title-lookup-linux-x64" },
  darwin: {
    x64: "book-title-lookup-darwin-x64",
    arm64: "book-title-lookup-darwin-arm64",
  },
};

function nodeMajor(version) {
  const match = /^v?([0-9]+)/.exec(String(version));
  return match ? Number(match[1]) : Number.NaN;
}

/** Pure Node-floor check; returns { ok } or an actionable message. */
function checkNodeFloor(version) {
  const major = nodeMajor(version);
  if (Number.isNaN(major) || major < NODE_FLOOR) {
    return {
      ok: false,
      message: `requires Node.js >= ${NODE_FLOOR} (found ${version})`,
    };
  }
  return { ok: true };
}

/** Pure platform/arch -> platform package name (undefined when unsupported). */
function platformPackageFor(platform, arch) {
  const table = PLATFORM_PACKAGES[platform];
  return table ? table[arch] : undefined;
}

/**
 * Pure preflight. `deps` allows tests to inject nodeVersion, platform, arch,
 * and the module resolver. Returns { ok:true, binaryPath } or an actionable
 * distribution failure with the reserved code 70.
 */
function preflight(deps) {
  const floor = checkNodeFloor(deps.nodeVersion);
  if (!floor.ok) {
    return { ok: false, message: floor.message, code: DISTRIBUTION_ERROR };
  }

  const pkg = platformPackageFor(deps.platform, deps.arch);
  if (!pkg) {
    return {
      ok: false,
      message: `unsupported platform ${deps.platform}/${deps.arch}; ` +
        `supported: ${SUPPORTED_TEXT}`,
      code: DISTRIBUTION_ERROR,
    };
  }

  let binaryPathValue;
  try {
    binaryPathValue = deps.requireModule(pkg); // throws when optional dep absent
  } catch {
    return {
      ok: false,
      message: `missing platform package ${pkg}; reinstall book-title-lookup ` +
        "without --omit=optional",
      code: DISTRIBUTION_ERROR,
    };
  }

  try {
    const stat = fs.statSync(binaryPathValue);
    if (!stat.isFile()) {
      return {
        ok: false,
        message: `binary is not a regular file: ${binaryPathValue}`,
        code: DISTRIBUTION_ERROR,
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: `cannot read binary ${binaryPathValue}: ${error.message}`,
      code: DISTRIBUTION_ERROR,
    };
  }

  return { ok: true, binaryPath: binaryPathValue };
}

/** The actionable fallback block printed on every distribution failure. */
function distributionFailureMessage(failure) {
  return `book-title: ${failure.message}\n` +
    "Install the matching platform package by installing book-title-lookup\n" +
    "without --omit=optional. Supported platforms: win32/x64, linux/x64,\n" +
    "darwin/x64, darwin/arm64.";
}

/** Process defaults used by the real CLI entry point. */
function defaultDeps() {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    requireModule: require,
  };
}

/** Relay the child's lifecycle onto this process (frozen skeleton). */
function spawnAndRelay(binaryPathValue, argv) {
  const child = spawn(binaryPathValue, argv, { stdio: "inherit" });

  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGHUP", () => forward("SIGHUP"));

  child.on("error", (error) => {
    process.stderr.write(`book-title: cannot start binary: ${error.message}\n`);
    process.exitCode = DISTRIBUTION_ERROR;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code === null ? DISTRIBUTION_ERROR : code;
    }
  });
}

/**
 * Resolve the child to run. Pure and testable: returns either a distribution
 * failure or a spawn directive. The CLI entry point maps failures to the
 * reserved code 70 on stderr.
 */
function run(deps) {
  const pre = preflight(deps);
  if (!pre.ok) {
    return { ok: false, failure: pre };
  }
  return { ok: true, binaryPath: pre.binaryPath, argv: deps.argv };
}

if (require.main === module) {
  const outcome = run({ ...defaultDeps(), argv: process.argv.slice(2) });
  if (outcome.ok) {
    spawnAndRelay(outcome.binaryPath, outcome.argv);
  } else {
    process.stderr.write(distributionFailureMessage(outcome.failure) + "\n");
    process.exitCode = outcome.failure.code;
  }
}

module.exports = {
  DISTRIBUTION_ERROR,
  NODE_FLOOR,
  SUPPORTED_TEXT,
  PLATFORM_PACKAGES,
  nodeMajor,
  checkNodeFloor,
  platformPackageFor,
  preflight,
  distributionFailureMessage,
  defaultDeps,
  run,
  spawnAndRelay,
};
