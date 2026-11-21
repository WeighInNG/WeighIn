const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  analyze,
  sha256,
} = require("./experiments/deployment-reuse-evidence.cjs");

const directory = path.join(__dirname, "../docs/experiments/deployment-reuse");
const read = (name) => fs.readFileSync(path.join(directory, name));
const evidence = () => JSON.parse(read("samples.json"));
const verify = (input) =>
  analyze(input, read("hello.wasm"), read("fixtures.json"));

test("deployment reuse evidence verifies the raw captures, hashes and observed ranges", () => {
  const manifest = JSON.parse(read("checksums.json"));
  for (const [name, digest] of Object.entries(manifest))
    assert.equal(sha256(read(name)), digest, name);
  assert.deepEqual(verify(evidence()), JSON.parse(read("ranges.json")));
});

test("deployment verifier rejects mislabeled conditions, changed WASM or calibration and missing samples", () => {
  const mislabeled = evidence();
  mislabeled.samples[1].before = mislabeled.samples[0].before;
  assert.throws(() => verify(mislabeled), /deployment condition/);

  assert.throws(
    () =>
      analyze(evidence(), Buffer.from("another WASM"), read("fixtures.json")),
    /WASM identity/,
  );
  const changed = evidence();
  changed.samples[2].record.benchmarks[0].provenance.compute_config_sha256 =
    "changed";
  assert.throws(() => verify(changed), /calibration/);

  const missing = evidence();
  missing.samples.pop();
  assert.throws(() => verify(missing), /missing or misordered samples/);
});
