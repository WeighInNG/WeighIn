const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { xdr } = require("@stellar/stellar-sdk");

const archive = path.resolve(__dirname, "../docs/experiments/random-contract");
const fixture = path.resolve(__dirname, "../tests/fixtures/random-contract");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(archive, name), "utf8"));
const decodeU64Vec = (value) =>
  xdr.ScVal.fromXDR(value, "base64")
    .vec()
    .map((item) => item.u64().toString());

const verification = read("verification.json");
const environment = read("environment.json");
const errors = read("errors.json");
const cases = read("cases.json");
const replays = read("native-replays.json");
const captures = read("rpc-captures.json");

test("random-contract archive checksums cover every retained file", () => {
  const manifest = read("sha256.json");
  const walk = (directory, prefix = "") => {
    const found = {};
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory())
        Object.assign(found, walk(path.join(directory, entry.name), relative));
      else if (relative !== "sha256.json") {
        found[relative] = sha256(
          fs.readFileSync(path.join(directory, entry.name)),
        );
      }
    }
    return found;
  };
  assert.deepEqual(manifest.files, walk(archive));
  assert.ok(manifest.files["contract/src/lib.rs"]);
  assert.ok(manifest.files["rpc-captures.json"]);
  assert.ok(manifest.files["native-replays.json"]);
});

test("proof fixture is a bounded PRNG-dependent contract with a deterministic control", () => {
  const source = fs.readFileSync(
    path.join(fixture, "contract/src/lib.rs"),
    "utf8",
  );
  const archived = fs.readFileSync(
    path.join(archive, "contract/src/lib.rs"),
    "utf8",
  );
  assert.equal(source, archived);
  assert.match(source, /env\.prng\(\)/);
  assert.match(source, /prng\.gen::<u64>\(\)/);
  assert.match(source, /if count > 4 \{ 4 \} else \{ count \}/);
  assert.match(source, /pub fn constant\(_env: Env\)/);
  assert.doesNotMatch(source, /env\.prng\(\)\.seed/);
  const fixtureSpec = JSON.parse(
    fs.readFileSync(path.join(fixture, "weighin-fixtures.json"), "utf8"),
  );
  assert.deepEqual(
    fixtureSpec.contracts[0].invocations.map(
      (invocation) => invocation.function_name,
    ),
    ["draws", "constant"],
  );
});

test("genuine PRNG results are nonzero, distinct, and linked to the archived raw IO", () => {
  assert.equal(verification.status, "VERIFIED");
  assert.equal(verification.scenario, "bounded_prng_contract_parity");
  assert.equal(verification.harness_exit, 0);
  assert.equal(verification.real_build_deployment_rpc_and_native, true);
  assert.equal(verification.raw_io_observed_not_substituted, true);
  assert.equal(verification.product_seed_forced, false);
  assert.equal(verification.parity_failure_became_success, false);
  assert.equal(environment.protocol, 28);
  assert.deepEqual(environment.native_seed, Array(32).fill(0));
  assert.equal(
    environment.wasm_bytes,
    fs.statSync(path.join(archive, "contract.wasm")).size,
  );
  assert.equal(
    sha256(fs.readFileSync(path.join(archive, "contract.wasm"))),
    environment.wasm_sha256,
  );
  assert.equal(verification.wasm_sha256, environment.wasm_sha256);

  const rpcValues = verification.rpc_prng_values;
  const nativeValues = verification.native_zero_seed_prng_values;
  assert.equal(rpcValues.length, 4);
  assert.equal(nativeValues.length, 4);
  assert.ok(rpcValues.some((value) => value !== "0"));
  assert.ok(nativeValues.some((value) => value !== "0"));
  assert.notDeepEqual(rpcValues, nativeValues);

  const drawsReplay = replays.find(
    (row) =>
      row.output &&
      xdr.HostFunction.fromXDR(row.input.host_function_xdr, "base64")
        .invokeContract()
        .functionName()
        .toString() === "draws",
  );
  assert.ok(drawsReplay, "Native replay for the draws case must be retained");
  assert.deepEqual(drawsReplay.input.seed, Array(32).fill(0));
  assert.deepEqual(decodeU64Vec(drawsReplay.output.retval_xdr), nativeValues);

  const drawsCapture = captures.find(
    (call) =>
      call.request.method === "simulateTransaction" &&
      call.raw.result?.results?.[0]?.xdr &&
      xdr.TransactionEnvelope.fromXDR(call.request.params.transaction, "base64")
        .v1()
        .tx()
        .operations()[0]
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract()
        .functionName()
        .toString() === "draws",
  );
  assert.ok(
    drawsCapture,
    "Raw RPC simulateTransaction capture for draws must be retained",
  );
  assert.deepEqual(
    decodeU64Vec(drawsCapture.raw.result.results[0].xdr),
    rpcValues,
  );
  assert.equal(
    drawsCapture.raw.result.transactionData,
    drawsReplay.output.transaction_data_xdr,
    "Footprint and resources must agree; the mismatch must be return-value only",
  );
});

test("successful proof: fixed zero-seed replay is rejected and the deterministic control matches", () => {
  assert.equal(errors.draws.rejected, true);
  assert.deepEqual(errors.draws.parityDetails, {
    transactionData: false,
    returnValue: true,
    contractEvents: false,
  });
  assert.match(errors.draws.message, /return-value disagreement/);
  assert.match(
    errors.draws.message,
    /auth\/random\/state-dependent invocation is unsupported/,
  );
  assert.deepEqual(verification.parity_rejection, errors.draws);

  assert.equal(cases.constant.accepted, true);
  assert.deepEqual(cases.constant.seed, Array(32).fill(0));
  assert.equal(
    xdr.ScVal.fromXDR(cases.constant.retval_xdr, "base64").sym().toString(),
    "fixed",
  );
  assert.deepEqual(verification.justified_matching_control, cases.constant);
  assert.equal(verification.justified_matching_control.accepted, true);

  const constantReplay = replays.find(
    (row) =>
      row.output &&
      xdr.HostFunction.fromXDR(row.input.host_function_xdr, "base64")
        .invokeContract()
        .functionName()
        .toString() === "constant",
  );
  assert.ok(
    constantReplay,
    "Native replay for the deterministic control must be retained",
  );
  assert.deepEqual(constantReplay.input.seed, Array(32).fill(0));
  assert.equal(constantReplay.output.retval_xdr, cases.constant.retval_xdr);
});

test("invalid and failure cases stay explicit: no archived seed override or hidden retry", () => {
  for (const row of replays) {
    assert.deepEqual(
      row.input.seed,
      Array(32).fill(0),
      "No archived replay changed the product seed",
    );
    assert.equal(
      row.error,
      null,
      "A failed native replay must not be recorded as a success",
    );
  }
  for (const call of captures) {
    assert.equal(call.raw.jsonrpc, "2.0");
    assert.ok(
      call.raw.result,
      `Raw RPC response retained for ${call.request.method}`,
    );
    assert.doesNotMatch(
      JSON.stringify(call),
      /private_key|secret_key|seed_bytes/i,
    );
  }
  const messages = captures
    .filter((call) => call.request.method === "simulateTransaction")
    .map((call) => call.raw.result.results[0].xdr);
  assert.equal(
    new Set(messages).size,
    2,
    "The two cases retained distinct genuine returns",
  );
  assert.equal(read("errors.json").draws.parityDetails.transactionData, false);
});
