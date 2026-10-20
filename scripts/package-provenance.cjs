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
  "src",
  "native/simulation/Cargo.toml",
  "native/simulation/Cargo.lock",
  "native/simulation/src",
  "bundled/index.js",
  "bundled/comment-action.js",
];
function files(value) {
  const normalized = value.split(path.sep).join("/");
  const absolute = path.join(root, ...normalized.split("/"));
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [normalized];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => files(path.posix.join(normalized, entry.name)));
}
function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, ...file.split("/"))))
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
const existing = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : null;
const inputsUnchanged =
  existing && JSON.stringify(existing.inputs) === JSON.stringify(entries);
const manifest = {
  schema_version: 1,
  purpose: "verifiable WeighIn package build provenance",
  source_revision: inputsUnchanged
    ? existing.source_revision
    : command("git", ["rev-parse", "HEAD"]),
  tools: inputsUnchanged
    ? existing.tools
    : { node: process.version, npm: command("npm", ["--version"]) },
  inputs: entries,
};
if (process.argv.includes("--verify")) {
  if (!fs.existsSync(manifestPath))
    throw new Error("provenance-manifest.json is missing");
  const actual = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    actual.schema_version !== manifest.schema_version ||
    actual.purpose !== manifest.purpose ||
    JSON.stringify(actual.inputs) !== JSON.stringify(manifest.inputs)
  )
    throw new Error(
      "package provenance manifest is stale or does not match source and bundles",
    );
  process.stderr.write("Package provenance verified\n");
} else {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`Wrote ${manifestPath}\n`);
}
