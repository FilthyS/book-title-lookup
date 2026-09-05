"use strict";
/**
 * Trivial CommonJS path export (npm-release-topology.md section 5.2).
 *
 * __BINARY_FILE__ is a template token replaced by the pack script with the
 * target's binary file name (book-title or book-title.exe). The platform
 * package has no bin entry; the launcher owns process semantics.
 */
const path = require("node:path");
module.exports = path.join(__dirname, "bin", "__BINARY_FILE__");
