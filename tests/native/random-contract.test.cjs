const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { xdr } = require("@stellar/stellar-sdk");
const { simulateSnapshot } = require("../../dist/simulation");

const archive = path.resolve(
  __dirname,
  "../../docs/experiments/random-contract",
);
const helper = path.resolve(
  __dirname,
  "../../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const replays = require(`${archive}/native-replays.json`);
const verification = require(`${archive}/verification.json`);
const draws = replays.find(
  (row) =>
    row.output &&
    xdr.HostFunction.fromXDR(row.input.host_function_xdr, "base64")
      .invokeContract()
      .functionName()
      .toString() === "draws",
);
const decode = (value) =>
  xdr.ScVal.fromXDR(value, "base64")
    .vec()
    .map((item) => item.u64().toString());

test("archived zero-seed replay reproduces genuine nonzero PRNG output with the real helper", async () => {
  assert.ok(draws, "Native replay for draws is required");
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await simulateSnapshot(draws.input, helper), draws.output);
  }
  const values = decode(draws.output.retval_xdr);
  assert.equal(values.length, 4);
  assert.ok(values.some((value) => value !== "0"));
  assert.deepEqual(values, verification.native_zero_seed_prng_values);
  assert.notDeepEqual(values, verification.rpc_prng_values);
});

test("invalid inputs fail explicitly instead of yielding a substituted PRNG result", async () => {
  assert.ok(draws);
  const malformed = xdr.HostFunction.fromXDR(
    draws.input.host_function_xdr,
    "base64",
  );
  malformed.invokeContract().functionName("missing");
  const cases = [
    [{ ...draws.input, seed: [0] }, /32 bytes/],
    [{ ...draws.input, seed: [] }, /32 bytes/],
    [{ ...draws.input, entries: [] }, /network configuration/],
    [
      { ...draws.input, host_function_xdr: malformed.toXDR("base64") },
      /host invocation failed/,
    ],
  ];
  for (const [input, message] of cases) {
    await assert.rejects(simulateSnapshot(input, helper), message);
  }
});

test("a distinct genuine seed changes the return; the fixed zero seed is a product default, not a proof hack", async () => {
  assert.ok(draws);
  const seed = Array(32).fill(0);
  seed[31] = 1;
  const altered = await simulateSnapshot({ ...draws.input, seed }, helper);
  assert.notEqual(altered.retval_xdr, draws.output.retval_xdr);
  assert.notDeepEqual(
    decode(altered.retval_xdr),
    verification.native_zero_seed_prng_values,
  );
  assert.equal(
    altered.cpu_instructions_consumed,
    draws.output.cpu_instructions_consumed,
  );
  assert.equal(
    altered.memory_bytes_consumed,
    draws.output.memory_bytes_consumed,
  );
});
