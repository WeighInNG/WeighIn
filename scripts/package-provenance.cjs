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
  "scripts/package-provenance.cjs",
];
function files(value) {
  const absolute = path.join(root, value);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [value];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => files(path.join(value, entry.name)));
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
const sourceTreeSha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(entries))
  .digest("hex");
const manifest = {
  schema_version: 2,
  purpose: "verifiable WeighIn package build provenance",
  source_tree_sha256: sourceTreeSha256,
  tools: { node: process.version, npm: command("npm", ["--version"]) },
  inputs: entries,
};
if (process.argv.includes("--verify")) {
  if (!fs.existsSync(manifestPath))
    throw new Error("provenance-manifest.json is missing");
  const actual = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest))
    throw new Error(
      "package provenance manifest is stale or does not match source and bundles",
    );
  process.stderr.write("Package provenance verified\n");
} else {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`Wrote ${manifestPath}\n`);
}
