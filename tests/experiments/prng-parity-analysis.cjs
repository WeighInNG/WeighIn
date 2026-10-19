// Analysis and verification for the bounded PRNG-dependent contract parity boundary proof (#171 / U02).
// Verifies both justified matching conditions (shared 32-byte zero base seed) and fail-closed
// parity rejection when PRNG outputs diverge between RPC simulation and native replay.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { xdr } = require('@stellar/stellar-sdk');
const FIXED_NATIVE_PRNG_SEED = Object.freeze(Array(32).fill(0));
const { diffBenchmarks } = require('../../dist/diff');
const { enforceThresholds } = require('../../dist/threshold');
const { renderComment } = require('../../dist/comment');

const MEASURED_KEYS = [
  'cpu_instructions',
  'memory_bytes',
  'ledger_read_entries',
  'ledger_read_bytes',
  'ledger_write_entries',
  'ledger_write_bytes',
  'events_count',
  'event_data_bytes',
];

const UNAVAILABLE_KEYS = [
  'historical_data_read_bytes',
  'contract_data_hard_limit',
  'tx_size_bytes',
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function decodeU64Vec(retvalXdr) {
  const scVal = xdr.ScVal.fromXDR(retvalXdr, 'base64');
  assert.equal(scVal.switch().name, 'scvVec', 'Expected Vec<u64> return value');
  return scVal.vec().map((item) => {
    assert.equal(item.switch().name, 'scvU64', 'Expected u64 element in return vector');
    return Number(item.u64().toString());
  });
}

function decodePrngContractEvent(eventXdr) {
  const ev = xdr.ContractEvent.fromXDR(eventXdr, 'base64');
  assert.equal(ev.type().name, 'contract', 'Expected contract event type');
  const body = ev.body().v0();
  const topics = body.topics().map((t) => {
    assert.equal(t.switch().name, 'scvSymbol');
    return t.sym().toString('utf8');
  });
  const dataVal = body.data();
  assert.equal(dataVal.switch().name, 'scvU64');
  return {
    topics,
    draw: Number(dataVal.u64().toString()),
  };
}

function verifyPrngParity({
  contractSource,
  environment,
  measurements,
  rpcCalls,
  nativeReplays,
  rejections,
  controlDiff,
  policy,
  violations,
  summary,
  verification,
}) {
  assert.equal(verification.status, 'VERIFIED');
  assert.equal(verification.scenario, 'prng_parity_boundary');
  assert.equal(verification.explicit_prng_invocation, true);
  assert.equal(verification.ledger_branching_used, false);
  assert.equal(verification.fixed_zero_seed_enforced, true);
  assert.equal(verification.silent_seed_override_used, false);
  assert.equal(verification.genuine_nonzero_results_preserved, true);
  assert.equal(verification.justified_matching_condition_verified, true);
  assert.equal(verification.divergent_prng_parity_rejected, true);
  assert.equal(verification.unavailable_metrics_explicit_null, true);

  // 1. Contract source must explicitly use env.prng() and must NOT branch on ledger sequence/timestamp (H03)
  assert.match(
    contractSource,
    /pub fn sample_prng\(env:\s*Env,\s*label:\s*Symbol\)\s*->\s*Vec<u64>/,
    'Proof contract must expose sample_prng(env: Env, label: Symbol) -> Vec<u64>',
  );
  assert.ok(
    contractSource.includes('env.prng()') && contractSource.includes('gen_range'),
    'Proof contract must explicitly invoke env.prng().gen_range(...)',
  );
  assert.ok(
    !contractSource.includes('env.ledger()'),
    'PRNG parity proof contract must not branch on env.ledger() (covered separately by #77 / H03)',
  );

  // 2. Environment must record fixed 32-byte zero native seed and never force a custom seed
  assert.deepEqual(
    environment.native_seed,
    [...FIXED_NATIVE_PRNG_SEED],
    'Environment native seed must equal the fixed 32-byte zero seed',
  );
  assert.equal(environment.silent_seed_override_used, false);

  // 3. Two justified matching runs (shared 32-byte zero base seed in RPC and native helper)
  assert.equal(
    measurements.length,
    2,
    'Archive must retain two justified zero-seed parity measurement records for control comparison',
  );

  for (let i = 0; i < measurements.length; i++) {
    const record = measurements[i];
    assert.equal(record.schema_version, 4);
    assert.equal(record.fixture_id, 'id:prng-parity-suite');
    assert.equal(record.logical_id, 'id:prng-contract');
    assert.equal(record.contract_id, environment.runtime_contract_id);
    assert.equal(record.benchmarks.length, 1);

    const benchmark = record.benchmarks[0];
    assert.equal(benchmark.function_name, 'sample_prng');
    assert.equal(benchmark.case_id, 'id:draw');
    assert.equal(benchmark.wasm_sha256, environment.proof_wasm_sha256);

    const prov = benchmark.provenance;
    assert.ok(prov, 'Schema 4 provenance is required');
    assert.equal(prov.protocol, 28);
    assert.equal(prov.auth_mode, 'recording(true,true)');
    assert.deepEqual(prov.host_features, ['recording_mode', 'testutils']);
    assert.deepEqual(
      prov.seed,
      [...FIXED_NATIVE_PRNG_SEED],
      'Provenance seed must be the fixed 32-byte zero array and never silently overridden',
    );

    const replay = nativeReplays.find(
      (r) =>
        r.case === `zero_seed_parity_${i + 1}` &&
        r.output &&
        sha256(JSON.stringify(r.input)) === prov.input_sha256,
    );
    assert.ok(replay, `Measurement ${i + 1} must link to its exact native simulation replay`);
    assert.deepEqual(
      replay.input.seed,
      [...FIXED_NATIVE_PRNG_SEED],
      'Native helper input seed must be strictly 32 zero bytes',
    );

    const rpcSim = rpcCalls.find(
      (call) =>
        call.case === `zero_seed_parity_${i + 1}` &&
        call.request.method === 'simulateTransaction' &&
        call.raw.result?.latestLedger === prov.ledger &&
        call.raw.result?.transactionData === replay.output.transaction_data_xdr &&
        call.raw.result?.results?.[0]?.xdr === replay.output.retval_xdr,
    );
    assert.ok(rpcSim, `Measurement ${i + 1} must have a parity-matched raw RPC simulateTransaction capture`);

    // Genuine nonzero PRNG draw and return vector verification
    const decodedVec = decodeU64Vec(replay.output.retval_xdr);
    assert.ok(decodedVec.length >= 2, 'PRNG return vector must include the draw and its bounded sequence');
    const draw = decodedVec[0];
    assert.ok(draw >= 1 && draw <= 16, 'PRNG draw must be a genuine nonzero value in 1..=16');
    assert.equal(decodedVec.length, draw + 1);

    // Charged contract event verification
    assert.equal(replay.output.contract_events_xdr.length, 1);
    const decodedEvent = decodePrngContractEvent(replay.output.contract_events_xdr[0]);
    assert.deepEqual(decodedEvent.topics, ['prng', 'draw']);
    assert.equal(decodedEvent.draw, draw);

    // Verify all 8 measured metrics are genuinely nonzero and match raw XDR
    const txResources = xdr.SorobanTransactionData.fromXDR(
      replay.output.transaction_data_xdr,
      'base64',
    ).resources();
    const expectedMetrics = {
      cpu_instructions: replay.output.cpu_instructions_consumed,
      memory_bytes: replay.output.memory_bytes_consumed,
      ledger_read_entries:
        txResources.footprint().readOnly().length + txResources.footprint().readWrite().length,
      ledger_read_bytes: txResources.diskReadBytes(),
      ledger_write_entries: txResources.footprint().readWrite().length,
      ledger_write_bytes: txResources.writeBytes(),
      events_count: replay.output.contract_events_xdr.length,
      event_data_bytes: [
        ...replay.output.contract_events_xdr,
        replay.output.retval_xdr,
      ].reduce((sum, val) => sum + Buffer.from(val, 'base64').length, 0),
    };

    for (const [key, expectedValue] of Object.entries(expectedMetrics)) {
      assert.equal(benchmark.metrics[key].availability, 'measured');
      assert.equal(benchmark.metrics[key].consumed, expectedValue, `Metric ${key} mismatch`);
      assert.ok(
        benchmark.metrics[key].consumed > 0,
        `Measured metric ${key} must be genuinely nonzero (> 0)`,
      );
    }

    for (const key of UNAVAILABLE_KEYS) {
      assert.equal(benchmark.metrics[key].availability, 'unavailable');
      assert.equal(
        benchmark.metrics[key].consumed,
        null,
        `Unavailable metric ${key} must remain null rather than measured zero`,
      );
      assert.equal(benchmark.metrics[key].limit, null);
      assert.ok(benchmark.metrics[key].reason);
    }
  }

  // 4. Control diff between the two justified zero-seed runs must have zero deltas and zero violations
  const recomputedDiff = diffBenchmarks([measurements[0]], [measurements[1]]);
  assert.deepEqual(recomputedDiff, controlDiff);
  assert.equal(controlDiff.hasRegression, false);
  assert.deepEqual(enforceThresholds(controlDiff, policy), violations);
  assert.deepEqual(violations, []);
  assert.equal(
    renderComment(controlDiff, violations, 'zero-seed-run-1', 'zero-seed-run-2'),
    summary,
  );

  // 5. Parity rejection cases must fail closed without blending resources or overriding the native zero seed
  const expectedRejectionCases = [
    'divergent_seed_full_disagreement',
    'divergent_return_value_only',
    'divergent_transaction_data_only',
    'divergent_events_only',
    'malformed_native_seed_rejected',
  ];
  assert.deepEqual(
    rejections.map((r) => r.case),
    expectedRejectionCases,
    'Archive must contain all 5 required PRNG parity/seed rejection cases',
  );

  for (const rej of rejections) {
    assert.equal(rej.status, 'REJECTED_FAIL_CLOSED');
    assert.equal(rej.blended_resources_emitted, false);
    assert.equal(rej.silent_seed_override_used, false);
    if (rej.case !== 'malformed_native_seed_rejected') {
      assert.match(
        rej.error_message,
        /Local simulation disagrees with RPC at captured ledger[\s\S]*auth\/random\/state-dependent invocation is unsupported/,
      );
      assert.deepEqual(
        rej.parity_details.seed,
        [...FIXED_NATIVE_PRNG_SEED],
        `Rejection case ${rej.case} must preserve the fixed 32-byte zero native seed`,
      );
    } else {
      assert.match(rej.error_message, /32 bytes/);
    }
  }

  const fullDisagreement = rejections.find((r) => r.case === 'divergent_seed_full_disagreement');
  assert.equal(fullDisagreement.parity_details.transactionData, true);
  assert.equal(fullDisagreement.parity_details.returnValue, true);
  assert.equal(fullDisagreement.parity_details.contractEvents, true);
  assert.notEqual(fullDisagreement.rpc_prng_draw, fullDisagreement.native_prng_draw);

  const retvalOnly = rejections.find((r) => r.case === 'divergent_return_value_only');
  assert.equal(retvalOnly.parity_details.transactionData, false);
  assert.equal(retvalOnly.parity_details.returnValue, true);
  assert.equal(retvalOnly.parity_details.contractEvents, false);

  const txDataOnly = rejections.find((r) => r.case === 'divergent_transaction_data_only');
  assert.equal(txDataOnly.parity_details.transactionData, true);
  assert.equal(txDataOnly.parity_details.returnValue, false);
  assert.equal(txDataOnly.parity_details.contractEvents, false);

  const eventsOnly = rejections.find((r) => r.case === 'divergent_events_only');
  assert.equal(eventsOnly.parity_details.transactionData, false);
  assert.equal(eventsOnly.parity_details.returnValue, false);
  assert.equal(eventsOnly.parity_details.contractEvents, true);

  return true;
}

function computeParityDetails(nativeOutput, rpcResult, seed = [...FIXED_NATIVE_PRNG_SEED]) {
  const rpcEvents = (rpcResult.events || [])
    .map((event) => xdr.DiagnosticEvent.fromXDR(event, 'base64'))
    .filter(
      (event) => event.inSuccessfulContractCall() && event.event().type().name !== 'diagnostic',
    )
    .map((event) => event.event().toXDR('base64'));
  return {
    transactionData: nativeOutput.transaction_data_xdr !== rpcResult.transactionData,
    returnValue: nativeOutput.retval_xdr !== rpcResult.results[0].xdr,
    contractEvents: JSON.stringify(nativeOutput.contract_events_xdr) !== JSON.stringify(rpcEvents),
    nativeRetvalXdr: nativeOutput.retval_xdr,
    rpcRetvalXdr: rpcResult.results[0].xdr,
    nativeTransactionDataSha256: sha256(nativeOutput.transaction_data_xdr),
    rpcTransactionDataSha256: sha256(rpcResult.transactionData),
    nativeContractEventsSha256: sha256(JSON.stringify(nativeOutput.contract_events_xdr)),
    rpcContractEventsSha256: sha256(JSON.stringify(rpcEvents)),
    seed: [...seed],
  };
}

module.exports = {
  FIXED_NATIVE_PRNG_SEED,
  MEASURED_KEYS,
  UNAVAILABLE_KEYS,
  decodeU64Vec,
  decodePrngContractEvent,
  computeParityDetails,
  verifyPrngParity,
};
