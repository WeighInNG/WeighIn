const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "provenance-manifest.json");
const tracked = [
  "package.json",
  "package-lock.json",
  "action.yml",
  "scripts/package-provenance.cjs",
  "src",
  "native/simulation/Cargo.toml",
  "native/simulation/Cargo.lock",
  "native/simulation/src",
  "bundled/index.js",
  "bundled/comment-action.js",
];
function files(value) {
  const absolute = path.join(root, value);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [value];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => files(path.posix.join(value, entry.name)));
}
function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, file)))
    .digest("hex");
}
function command(name, args) {
  try {
    return execFileSync(name, args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}
const entries = [...new Set(tracked.flatMap(files))]
  .sort()
  .map((file) => ({ path: file, sha256: sha256(file) }));
const purpose = "verifiable WeighIn package build provenance";
function matchesInputs(value) {
  return value?.schema_version === 1 &&
    value.purpose === purpose &&
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|unavailable)$/.test(value.source_revision) &&
    typeof value.tools?.node === "string" &&
    /^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(value.tools.node) &&
    typeof value.tools?.npm === "string" &&
    /^(?:\d+\.\d+\.\d+(?:[-+].+)?|unavailable)$/.test(value.tools.npm) &&
    JSON.stringify(value.inputs) === JSON.stringify(entries);
}
let actual;
try {
  actual = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  // Missing or malformed manifests fail verification and can be regenerated.
}
if (process.argv.includes("--verify")) {
  if (!matchesInputs(actual)) {
    throw new Error("package provenance manifest is missing, invalid or stale");
  }
  process.stderr.write("Package provenance verified\n");
} else if (matchesInputs(actual)) {
  // These fields describe the producer of the recorded bytes. A later checkout
  // or toolchain must not relabel an unchanged package as a new artifact.
  process.stderr.write("Package inputs unchanged; retained producer provenance\n");
} else {
  const manifest = {
    schema_version: 1,
    purpose,
    source_revision: command("git", ["rev-parse", "HEAD"]),
    tools: { node: process.version, npm: command("npm", ["--version"]) },
    inputs: entries,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`Wrote ${manifestPath}\n`);
}
