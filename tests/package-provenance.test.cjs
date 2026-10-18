const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/package-provenance.cjs");

// A throwaway package root, so the real manifest is never touched.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-provenance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(script, path.join(root, "scripts/package-provenance.cjs"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "fixture" }\n');
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const value = 1;\n");
  return root;
}
const run = (root, ...args) =>
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/package-provenance.cjs"), ...args],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );
const manifestFile = (root) => path.join(root, "provenance-manifest.json");
const readManifest = (root) =>
  JSON.parse(fs.readFileSync(manifestFile(root), "utf8"));
const writeManifest = (root, manifest) =>
  fs.writeFileSync(manifestFile(root), `${JSON.stringify(manifest, null, 2)}\n`);

test("bundle keeps an up-to-date manifest byte-identical in another checkout and toolchain", (t) => {
  const root = fixture(t);
  run(root);
  // Same inputs, recorded by another revision and Node/npm (as on a CI merge checkout).
  writeManifest(root, {
    ...readManifest(root),
    source_revision: "0123456789abcdef0123456789abcdef01234567",
    tools: { node: "v0.0.0-elsewhere", npm: "0.0.0-elsewhere" },
  });
  const committed = fs.readFileSync(manifestFile(root));
  run(root);
  assert.deepEqual(fs.readFileSync(manifestFile(root)), committed);
  assert.doesNotThrow(() => run(root, "--verify"));
});

test("changed inputs regenerate the manifest and stale manifests fail verification", (t) => {
  const root = fixture(t);
  run(root);
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const value = 2;\n");
  assert.throws(() => run(root, "--verify"), /stale or does not match/);
  run(root);
  const manifest = readManifest(root);
  assert.deepEqual(manifest.inputs, [
    {
      path: "package.json",
      sha256: crypto
        .createHash("sha256")
        .update('{ "name": "fixture" }\n')
        .digest("hex"),
    },
    {
      path: "src/index.ts",
      sha256: crypto
        .createHash("sha256")
        .update("export const value = 2;\n")
        .digest("hex"),
    },
  ]);
  assert.equal(manifest.tools.node, process.version);
  assert.equal(typeof manifest.source_revision, "string");
  assert.doesNotThrow(() => run(root, "--verify"));
});

test("verification rejects a missing manifest or one without generator identity", (t) => {
  const root = fixture(t);
  assert.throws(() => run(root, "--verify"), /provenance-manifest.json is missing/);
  run(root);
  const { tools, ...withoutTools } = readManifest(root);
  assert.equal(typeof tools.node, "string");
  writeManifest(root, withoutTools);
  assert.throws(() => run(root, "--verify"), /source revision and Node\/npm/);
  run(root);
  assert.equal(readManifest(root).tools.node, process.version);
});
