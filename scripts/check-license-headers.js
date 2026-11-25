#!/usr/bin/env node

/**
 * Check that every file under the `src` directory carries a recognized
 * license header (Apache-2.0 or MIT).  Exits with status 1 when any file
 * is missing a header.
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "..", "src");
const LICENSES = [
  // SPDX identifiers are the preferred short-form header.
  /SPDX-License-Identifier:\s*Apache-2\.0/,
  // Apache-2.0 (project's LICENSE)
  /Copyright \(c\) \d{4} .*[\r\n]+[\s\S]*?Apache License[^\n]*Version 2\.0/,
  // MIT
  /Copyright \(c\) \d{4}[^\n]*MIT License|Copyright \(c\) \d{4}[^\n]*Permission is hereby granted, be described as follows/,
];

function checkFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`ERROR: cannot read ${filePath}: ${err.message}`);
    return false;
  }

  const hasLicense = LICENSES.some((re) => re.test(content));
  if (!hasLicense) {
    console.error(`MISSING HEADER: ${filePath}`);
  }
  return hasLicense;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`ERROR: source directory not found: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  walk(SRC_DIR);

  if (files.length === 0) {
    console.error(`ERROR: no files found under ${SRC_DIR}`);
    process.exit(1);
  }

  const ok = files.every(checkFile);
  if (!ok) {
    console.error(
      `\n${files.filter((f) => !checkFile(f)).length} file(s) missing a license header`,
    );
    process.exit(1);
  }

  console.log(
    `OK: all ${files.length} file(s) under ${SRC_DIR} have a recognized license header`,
  );
}

main();
