const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "provenance-manifest.json");
const schemaVersion = 1;
const purpose = "verifiable WeighIn package build provenance";
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
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return undefined;
  }
}
const inputs = [...new Set(tracked.flatMap(files))]
  .sort()
  .map((file) => ({ path: file, sha256: sha256(file) }));

// The input digests are the verifiable part of the manifest. The source
// revision and tool versions only describe where the manifest was last
// regenerated: a commit cannot contain its own hash, and CI checks out a merge
// revision with other Node/npm versions. They are therefore informational and
// kept as they are while the inputs are unchanged, so that `npm run bundle` on
// a clean checkout reproduces the committed file byte for byte.
function hasCurrentInputs(manifest) {
  return (
    manifest?.schema_version === schemaVersion &&
    manifest.purpose === purpose &&
    JSON.stringify(manifest.inputs) === JSON.stringify(inputs)
  );
}
function hasGeneratorIdentity(manifest) {
  return (
    typeof manifest?.source_revision === "string" &&
    typeof manifest.tools?.node === "string" &&
    typeof manifest.tools?.npm === "string"
  );
}

const existing = readManifest();
if (process.argv.includes("--verify")) {
  if (!fs.existsSync(manifestPath))
    throw new Error("provenance-manifest.json is missing");
  if (!hasCurrentInputs(existing))
    throw new Error(
      "package provenance manifest is stale or does not match source and bundles",
    );
  if (!hasGeneratorIdentity(existing))
    throw new Error(
      "package provenance manifest does not record its source revision and Node/npm identities",
    );
  process.stderr.write(
    `Package provenance verified (generated at ${existing.source_revision} with Node ${existing.tools.node}, npm ${existing.tools.npm})\n`,
  );
} else if (hasCurrentInputs(existing) && hasGeneratorIdentity(existing)) {
  process.stderr.write(`${manifestPath} is up to date\n`);
} else {
  const manifest = {
    schema_version: schemaVersion,
    purpose,
    source_revision: command("git", ["rev-parse", "HEAD"]),
    tools: { node: process.version, npm: command("npm", ["--version"]) },
    inputs,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`Wrote ${manifestPath}\n`);
}
