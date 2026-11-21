const assert = require("node:assert/strict");
const { Address, xdr } = require("@stellar/stellar-sdk");
const { createHash } = require("node:crypto");

const conditions = {
  cold: [false, false],
  uploaded: [true, false],
  reused: [true, true],
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const jsonHash = (value) => sha256(JSON.stringify(value));

function analyze(evidence, wasm, fixture) {
  assert.equal(evidence.wasm_sha256, sha256(wasm), "WASM identity");
  assert.equal(evidence.fixture_sha256, sha256(fixture), "fixture identity");
  assert.deepEqual(
    evidence.samples.map(({ condition }) => condition),
    [...Object.keys(conditions), ...Object.keys(conditions)],
    "missing or misordered samples",
  );
  const first = evidence.samples[0];
  const limits = [
    "compute_config_sha256",
    "resource_limits_sha256",
    "helper_sha256",
    "network_id",
    "protocol",
  ];
  for (const [index, sample] of evidence.samples.entries()) {
    const peers = evidence.samples.slice(
      index - (index % 3),
      index - (index % 3) + 3,
    );
    const benchmark = sample.record.benchmarks[0];
    const baseline = first.record.benchmarks[0];
    assert.equal(sample.repetition, 1 + Math.floor(index / 3));
    assert.deepEqual(
      sample.before.map(({ response }) =>
        Boolean(response.result.entries?.length),
      ),
      conditions[sample.condition],
      "deployment condition",
    );
    assert.ok(
      sample.after.every(
        ({ response }) => response.result.entries?.length === 1,
      ),
      "code and instance must exist",
    );
    const [code, instance] = sample.before.map(({ params }) =>
      xdr.LedgerKey.fromXDR(params.keys[0], "base64"),
    );
    assert.equal(
      code.contractCode().hash().toString("hex"),
      evidence.wasm_sha256,
    );
    assert.equal(
      Address.fromScAddress(instance.contractData().contract()).toString(),
      sample.contract_id,
    );
    assert.deepEqual(
      sample.after.map(({ params }) => params),
      sample.before.map(({ params }) => params),
    );
    assert.equal(
      sample.rpc.filter(({ method }) => method === "sendTransaction").length,
      sample.condition === "reused" ? 0 : 2,
    );
    assert.equal(sample.record.contract_id, sample.contract_id);
    assert.equal(
      sample.contract_id,
      sample.condition === "cold" ? peers[0].contract_id : peers[1].contract_id,
    );
    assert.notEqual(peers[0].contract_id, peers[1].contract_id);
    assert.equal(benchmark.wasm_sha256, evidence.wasm_sha256);
    assert.equal(sample.record.logical_id, first.record.logical_id);
    assert.equal(benchmark.case_id, baseline.case_id);
    assert.equal(
      jsonHash(sample.native.input),
      benchmark.provenance.input_sha256,
      "native input hash",
    );
    for (const key of limits)
      assert.equal(
        benchmark.provenance[key],
        baseline.provenance[key],
        "calibration " + key,
      );
    assert.equal(
      benchmark.provenance.config_sha256,
      peers[0].record.benchmarks[0].provenance.config_sha256,
      "full config within each ledger",
    );
    const output = sample.native.output;
    assert.equal(
      output.retval_xdr,
      first.native.output.retval_xdr,
      "return parity across samples",
    );
    assert.ok(
      sample.rpc.some(
        ({ method, response }) =>
          method === "simulateTransaction" &&
          response.result?.results?.[0]?.xdr === output.retval_xdr &&
          response.result.transactionData === output.transaction_data_xdr,
      ),
      "raw RPC/native parity",
    );
    for (const [key, metric] of Object.entries(benchmark.metrics)) {
      assert.equal(metric.limit, baseline.metrics[key].limit, "cap " + key);
      assert.equal(
        metric.availability,
        baseline.metrics[key].availability,
        "availability " + key,
      );
      if (metric.availability === "unavailable")
        assert.equal(metric.consumed, null);
    }
  }
  return Object.fromEntries(
    Object.keys(conditions).map((condition) => [
      condition,
      Object.fromEntries(
        Object.entries(first.record.benchmarks[0].metrics).map(
          ([key, metric]) => {
            const samples = evidence.samples
              .filter((sample) => sample.condition === condition)
              .map((sample) => sample.record.benchmarks[0].metrics[key]);
            const values = samples.map((value) => value.consumed);
            return [
              key,
              {
                availability: metric.availability,
                limit: metric.limit,
                range: values.every((value) => typeof value === "number")
                  ? [Math.min(...values), Math.max(...values)]
                  : null,
                samples: values,
              },
            ];
          },
        ),
      ),
    ]),
  );
}

module.exports = { analyze, sha256 };
