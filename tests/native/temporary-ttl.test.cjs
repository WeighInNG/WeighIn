const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { simulateSnapshot } = require("../../dist/simulation");

const helper = path.resolve(
  __dirname,
  "../../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const replays = require("../../docs/experiments/temporary-ttl/native-replays.json");
const composition = require("../../docs/experiments/temporary-ttl/composition.json");
const verification = require("../../docs/experiments/temporary-ttl/verification.json");
const sha256 = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const byCase = (caseId) => replays.find((row) => row.case_id === caseId);

test("genuine live temporary-entry snapshot replays to the archived accepted result", async () => {
  const live = byCase("live");
  assert.ok(live?.output, "Live replay output must be archived");
  assert.equal(sha256(live.input), composition.live_input_sha256);
  const output = await simulateSnapshot(live.input, helper);
  assert.deepEqual(output, live.output);
  assert.equal(output.retval_xdr, verification.live_case.retval_xdr);
});

test("expired composed snapshot is rejected without changing any entry or TTL field", () => {
  const live = byCase("live");
  const expired = byCase("expired-composed");
  assert.ok(expired?.input, "Expired replay input must be archived");
  assert.deepEqual(expired.input.entries, live.input.entries);
  assert.notEqual(expired.input.header_xdr, live.input.header_xdr);
  assert.equal(sha256(expired.input), composition.expired_input_sha256);

  const run = spawnSync(helper, [], {
    input: JSON.stringify(expired.input),
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /archived ledger state is unsupported/);
  assert.equal(run.stderr.trim(), expired.error.trim());
  assert.equal(run.stderr.trim(), verification.archived_control.message);
});

test("malformed archived input is rejected explicitly", () => {
  const invalid = byCase("invalid-header");
  assert.ok(invalid?.input, "Invalid-input replay must be archived");
  assert.equal(
    sha256(invalid.input),
    verification.invalid_input_control.input_sha256,
  );
  const run = spawnSync(helper, [], {
    input: JSON.stringify(invalid.input),
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.trim().length > 0);
  assert.equal(run.stderr.trim(), invalid.error.trim());
  assert.equal(run.stderr.trim(), verification.invalid_input_control.message);
});
