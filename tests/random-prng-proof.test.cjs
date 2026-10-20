const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const archiveDir = path.resolve(
  __dirname,
  "../docs/experiments/random-prng-proof",
);
const proofPath = path.join(archiveDir, "verification.json");

function loadProof() {
  const source = fs.readFileSync(
    path.join(archiveDir, "contract/src/lib.rs"),
    "utf8",
  );
  const verification = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  return { source, verification };
}

test("random PRNG proof archives zero-seed parity rejection without forcing green results", () => {
  const { source, verification } = loadProof();

  assert.equal(verification.status, "VERIFIED");
  assert.equal(verification.scenario, "random_prng_parity");
  assert.equal(verification.result, "pass");
  assert.equal(verification.protocol, 28);
  assert.equal(verification.auth_mode, "recording(true,true)");
  assert.deepEqual(verification.seed, Array(32).fill(0));
  assert.equal(verification.zero_seed_preserved, true);
  assert.equal(verification.random_behavior_detected, true);
  assert.equal(verification.parity_rejected, true);
  assert.equal(verification.seed_not_forced, true);
  assert.ok(source.includes("env.prng()") || source.includes("prng"));
  assert.match(
    verification.rpc_native_parity.failure,
    /auth\/random|disagrees with RPC|unsupported/i,
  );
  assert.equal(verification.rpc_native_parity.return_value_match, false);
  assert.equal(verification.rpc_native_parity.transaction_data_match, false);
  assert.equal(verification.rpc_native_parity.events_match, false);
});

test("random PRNG proof rejects nonzero seed or parity normalization attempts", () => {
  const { verification } = loadProof();
  assert.equal(verification.synthetic_seed_override_attempted, false);
  assert.equal(verification.genuine_nonzero_results_retained, true);
  assert.equal(verification.seed_not_forced, true);
  assert.equal(verification.parity_gate, "reject_and_fail_closed");
});
