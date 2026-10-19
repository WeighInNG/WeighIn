// Analysis and verification for the controlled temporary-storage TTL expiry boundary experiment (#173).
// Uses the existing public simulation, measurement, diff, threshold, and report APIs without altering
// production semantics or manipulating claimed provenance.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Address, xdr } = require('@stellar/stellar-sdk');
const { validateLedgerKeyEntryCorrespondence } = require('../../dist/simulation');
const { diffBenchmarks } = require('../../dist/diff');
const { enforceThresholds } = require('../../dist/threshold');
const { renderComment } = require('../../dist/comment');
const { analyzeRepeatability } = require('./repeatability-analysis.cjs');

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

function decodeSymbolVec(retvalXdr) {
  const scVal = xdr.ScVal.fromXDR(retvalXdr, 'base64');
  assert.equal(scVal.switch().name, 'scvVec', 'Expected Vec<Symbol> return value');
  return scVal.vec().map((item) => {
    assert.equal(item.switch().name, 'scvSymbol', 'Expected Symbol element in return vector');
    return item.sym().toString('utf8');
  });
}

function decodeHeaderLedgerAndTimestamp(headerXdr) {
  const header = xdr.LedgerHeader.fromXDR(headerXdr, 'base64');
  return {
    protocol: header.ledgerVersion(),
    ledger: header.ledgerSeq(),
    timestamp: Number(header.scpValue().closeTime().toString()),
  };
}

function buildTemporaryStorageKey(contractId, symbolName = 'temp_ttl') {
  const contractScAddress = Address.fromString(contractId).toScAddress();
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractScAddress,
      key: xdr.ScVal.scvSymbol(symbolName),
      durability: xdr.ContractDataDurability.temporary(),
    }),
  ).toXDR('base64');
}

function verifyTemporaryStorageExpiry({
  contractSource,
  environment,
  boundarySteps,
  runs,
  rpcCalls,
  nativeReplays,
  rejectedPaths,
  analysis,
  controlDiff,
  boundaryLiveDiff,
  expiryDiff,
  policy,
  violations,
  summary,
  verification,
}) {
  assert.equal(verification.status, 'VERIFIED');
  assert.equal(verification.scenario, 'temporary_storage_expiry_boundary');
  assert.equal(verification.repeatability_status, 'REPEATABILITY_VARIATION_FOUND');
  assert.equal(verification.temporary_entry_live_until_ledger, 950);
  assert.equal(verification.unchanged_wasm_artifact, true);
  assert.equal(verification.unchanged_runtime_contract_id, true);
  assert.equal(verification.fixed_invocation_interface, true);
  assert.equal(verification.controlled_expiry_boundary_progression, true);
  assert.equal(verification.inclusive_boundary_live_verified, true);
  assert.equal(verification.post_expiry_eviction_verified, true);
  assert.equal(verification.rejected_paths_verified, true);
  assert.equal(verification.provenance_manipulated, false);
  assert.equal(verification.restore_or_archive_claimed_for_temporary_storage, false);
  assert.equal(verification.random_behavior_used, false);
  assert.equal(verification.policy_violation_suppressed_for_unchanged_artifact, false);
  assert.equal(verification.unavailable_metrics_explicit_null, true);

  // 1. Contract source uses temporary storage explicitly while keeping hello(Env, Symbol) -> Vec<Symbol> fixed
  assert.match(
    contractSource,
    /pub fn hello\(env:\s*Env,\s*to:\s*Symbol\)\s*->\s*Vec<Symbol>/,
    'Proof contract must keep the fixed hello(Env, Symbol) -> Vec<Symbol> invocation interface',
  );
  assert.ok(
    contractSource.includes('env.storage().temporary().get'),
    'Proof contract must read temporary storage via env.storage().temporary().get',
  );
  assert.ok(
    contractSource.includes('env.storage().temporary().set'),
    'Proof contract must re-initialize temporary storage via env.storage().temporary().set after expiry',
  );
  assert.ok(
    contractSource.includes('extend_ttl'),
    'Proof contract must explicitly manage temporary entry TTL via extend_ttl',
  );
  assert.ok(
    contractSource.includes('env.ledger().sequence()'),
    'Proof contract must inspect env.ledger().sequence()',
  );
  assert.ok(
    !contractSource.includes('prng'),
    'Proof contract must not use random/PRNG behavior',
  );

  // 2. Five controlled runs across the temporary-storage expiry boundary (940, 949, 950, 951, 960)
  assert.equal(runs.length, 5, 'Experiment must include 5 controlled runs across the TTL boundary');
  assert.equal(boundarySteps.length, 5, 'Expiry boundary progression must have 5 entries');

  const expectedTempKey = buildTemporaryStorageKey(environment.runtime_contract_id, 'temp_ttl');
  assert.equal(
    environment.temporary_storage_key_xdr,
    expectedTempKey,
    'Recorded temporary storage LedgerKey must match ContractDataDurability.temporary() key',
  );

  const wasmHashes = new Set();
  const contractIds = new Set();
  const computeConfigHashes = new Set();
  const resourceLimitHashes = new Set();

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const step = boundarySteps[i];
    assert.equal(run.run, i + 1);
    assert.equal(step.run, i + 1);
    assert.equal(run.source_snapshot_sha256, environment.source_snapshot_sha256);
    assert.equal(run.reference_build.wasm_sha256, environment.proof_wasm_sha256);

    const contract = run.reference_measurements[0];
    assert.equal(contract.schema_version, 4);
    assert.equal(contract.fixture_id, 'id:temporary-storage-expiry-suite');
    assert.equal(contract.logical_id, 'id:reference-contract');
    contractIds.add(contract.contract_id);

    assert.equal(contract.benchmarks.length, 1);
    const benchmark = contract.benchmarks[0];
    assert.equal(benchmark.function_name, 'hello');
    assert.equal(benchmark.case_id, 'id:world');
    assert.equal(benchmark.wasm_sha256, environment.proof_wasm_sha256);
    wasmHashes.add(benchmark.wasm_sha256);

    const prov = benchmark.provenance;
    assert.ok(prov, 'Schema 4 provenance is required');
    assert.equal(prov.protocol, 28);
    assert.equal(prov.auth_mode, 'recording(true,true)');
    assert.deepEqual(prov.host_features, ['recording_mode', 'testutils']);
    assert.deepEqual(prov.seed, Array(32).fill(0), 'Seed must remain fixed 32 zero bytes');
    assert.equal(prov.ledger, step.ledger, 'Provenance ledger must match controlled boundary step');
    computeConfigHashes.add(prov.compute_config_sha256);
    resourceLimitHashes.add(prov.resource_limits_sha256);

    if (i > 0) {
      assert.ok(
        step.ledger > boundarySteps[i - 1].ledger,
        'Controlled ledger sequence must strictly advance across boundary steps',
      );
      assert.ok(
        step.timestamp > boundarySteps[i - 1].timestamp,
        'Controlled ledger timestamp must strictly advance across boundary steps',
      );
    }

    // Link to native replay and raw RPC simulation without manipulating provenance
    const replay = nativeReplays.find(
      (row) => row.output && sha256(JSON.stringify(row.input)) === prov.input_sha256,
    );
    assert.ok(replay, `Run ${run.run} must link to its exact native simulation input/output`);
    assert.equal(sha256(replay.input.header_xdr), prov.header_sha256);
    assert.equal(sha256(JSON.stringify(replay.input.entries)), prov.snapshot_sha256);

    const headerInfo = decodeHeaderLedgerAndTimestamp(replay.input.header_xdr);
    assert.equal(headerInfo.protocol, 28);
    assert.equal(headerInfo.ledger, step.ledger);
    assert.equal(headerInfo.timestamp, step.timestamp);

    // Check temporary storage entry state in the captured snapshot
    const tempSnapshotRow = replay.input.entries.find((e) => e.key === expectedTempKey);
    assert.ok(tempSnapshotRow, `Run ${run.run} snapshot must include temporary storage footprint key`);

    if (step.ledger <= environment.temporary_entry_live_until_ledger) {
      assert.equal(step.entry_live, true, `Run ${run.run} at ledger ${step.ledger} must be live`);
      assert.ok(
        tempSnapshotRow.xdr,
        `Run ${run.run} live temporary entry must have non-null ContractData XDR`,
      );
      validateLedgerKeyEntryCorrespondence(tempSnapshotRow.key, tempSnapshotRow.xdr);
      const entryData = xdr.LedgerEntryData.fromXDR(tempSnapshotRow.xdr, 'base64');
      assert.equal(entryData.switch().name, 'contractData');
      assert.equal(entryData.contractData().durability().name, 'temporary');
      assert.equal(
        tempSnapshotRow.live_until,
        environment.temporary_entry_live_until_ledger,
        'Live temporary entry must preserve its live_until ledger sequence',
      );
      assert.ok(
        tempSnapshotRow.live_until >= step.ledger,
        'Accepted live temporary entry must satisfy live_until >= header.ledger_seq',
      );
      assert.ok(
        replay.output.read_only_keys.includes(expectedTempKey),
        'Live temporary entry read must remain in read_only_keys',
      );
      assert.ok(
        !replay.output.read_write_keys.includes(expectedTempKey),
        'Live temporary entry cache hit must not write temporary key',
      );
      assert.deepEqual(step.return_symbols, ['Hello', 'world', 'live']);
    } else {
      assert.equal(
        step.entry_live,
        false,
        `Run ${run.run} at ledger ${step.ledger} must be post-expiry`,
      );
      assert.equal(
        tempSnapshotRow.xdr,
        null,
        `Run ${run.run} expired temporary entry must be evicted (xdr: null) in snapshot`,
      );
      assert.ok(
        replay.output.read_write_keys.includes(expectedTempKey),
        'Post-expiry re-initialization must place temporary key in read_write_keys',
      );
      assert.equal(replay.output.modified_entries, 1);
      assert.deepEqual(step.return_symbols, ['Hello', 'world', 'expired', 'reinit']);
    }

    const rpcSim = rpcCalls.find(
      (call) =>
        call.run === run.run &&
        call.request.method === 'simulateTransaction' &&
        call.raw.result?.latestLedger === prov.ledger &&
        call.raw.result?.transactionData === replay.output.transaction_data_xdr &&
        call.raw.result?.results?.[0]?.xdr === replay.output.retval_xdr,
    );
    assert.ok(rpcSim, `Run ${run.run} must have a parity-matched raw RPC simulateTransaction record`);

    const decodedReturn = decodeSymbolVec(replay.output.retval_xdr);
    assert.equal(replay.output.retval_xdr, step.retval_xdr);
    assert.deepEqual(decodedReturn, step.return_symbols);

    // Check all 8 measured metrics and 3 unavailable metrics
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
      assert.equal(benchmark.metrics[key].consumed, expectedValue, `Run ${run.run} metric ${key}`);
    }
    for (const key of UNAVAILABLE_KEYS) {
      assert.equal(benchmark.metrics[key].availability, 'unavailable');
      assert.equal(
        benchmark.metrics[key].consumed,
        null,
        `Unavailable metric ${key} must remain null rather than measured zero`,
      );
      assert.equal(benchmark.metrics[key].limit, null);
      assert.ok(benchmark.metrics[key].reason, `Unavailable metric ${key} must retain its reason`);
    }
  }

  assert.equal(wasmHashes.size, 1, 'Proof WASM hash must remain fixed across all runs');
  assert.equal(contractIds.size, 1, 'Runtime contract ID must remain fixed across all runs');
  assert.equal(computeConfigHashes.size, 1, 'Compute calibration hash must remain constant');
  assert.equal(resourceLimitHashes.size, 1, 'Resource limits hash must remain constant');

  // Verify exact boundary ledger sequences: 940, 949, 950 (inclusive live), 951 (first expired), 960
  assert.deepEqual(
    boundarySteps.map((s) => s.ledger),
    [940, 949, 950, 951, 960],
    'Boundary steps must cover pre-expiry (940, 949), exact boundary (950), and post-expiry (951, 960)',
  );

  // 3. Repeatability analysis must detect actual TTL-expiry-driven variation while WASM is stable
  const computedAnalysis = analyzeRepeatability(runs);
  assert.deepEqual(
    computedAnalysis,
    analysis,
    'Saved analysis.json must match analyzeRepeatability(runs)',
  );
  assert.equal(analysis.status, 'REPEATABILITY_VARIATION_FOUND');
  assert.equal(analysis.reference.wasm_stable, true);
  assert.equal(analysis.reference.metrics_stable, false);

  const seriesMetrics = analysis.reference.series[0].metrics;
  assert.ok(
    seriesMetrics.cpu_instructions.range > 0,
    'CPU instructions must show actual expiry-boundary variation',
  );
  assert.ok(
    seriesMetrics.memory_bytes.range > 0,
    'Memory bytes must show actual expiry-boundary variation',
  );
  assert.ok(
    seriesMetrics.ledger_write_entries.range > 0,
    'Write entries must show actual expiry-boundary variation',
  );
  assert.ok(
    seriesMetrics.ledger_write_bytes.range > 0,
    'Write bytes must show actual expiry-boundary variation',
  );
  assert.ok(
    seriesMetrics.event_data_bytes.range > 0,
    'Event+return bytes must show actual expiry-boundary variation',
  );

  // 4. Pre-expiry control diff (Run 1 @ 940 vs Run 2 @ 949) and exact-boundary live diff (Run 1 @ 940 vs Run 3 @ 950)
  //    must both show 0 deltas and 0 threshold violations because live_until == 950 is inclusive.
  const recomputedControlDiff = diffBenchmarks(
    runs[0].reference_measurements,
    runs[1].reference_measurements,
  );
  assert.deepEqual(recomputedControlDiff, controlDiff);
  assert.equal(controlDiff.hasRegression, false);
  assert.deepEqual(enforceThresholds(controlDiff, policy), []);

  const recomputedBoundaryLiveDiff = diffBenchmarks(
    runs[0].reference_measurements,
    runs[2].reference_measurements,
  );
  assert.deepEqual(recomputedBoundaryLiveDiff, boundaryLiveDiff);
  assert.equal(
    boundaryLiveDiff.hasRegression,
    false,
    'Exact inclusive TTL boundary (ledger 950 == live_until 950) must remain live with zero resource delta',
  );
  for (const m of boundaryLiveDiff.contracts[0].functions[0].metrics) {
    if (m.availability === 'comparable') {
      assert.equal(m.delta, 0, `Exact boundary metric ${m.key} must have zero delta vs pre-expiry`);
      assert.equal(m.regression, false);
    }
  }
  assert.deepEqual(enforceThresholds(boundaryLiveDiff, policy), []);

  // 5. Expiry transition diff (Run 3 @ 950 live boundary vs Run 4 @ 951 first expired ledger)
  //    must flag regressions and enforce configured threshold violations on the unchanged WASM artifact.
  const recomputedExpiryDiff = diffBenchmarks(
    runs[2].reference_measurements,
    runs[3].reference_measurements,
  );
  assert.deepEqual(recomputedExpiryDiff, expiryDiff);
  assert.equal(
    expiryDiff.hasRegression,
    true,
    'Crossing temporary-storage TTL expiry boundary (950 -> 951) must flag resource increase as regression',
  );
  assert.equal(
    expiryDiff.contracts[0].base_contract_id,
    expiryDiff.contracts[0].head_contract_id,
    'BASE and HEAD share the unchanged deployed contract ID',
  );

  const recomputedViolations = enforceThresholds(expiryDiff, policy);
  assert.deepEqual(recomputedViolations, violations);
  assert.equal(violations.length, 5, 'Crossing expiry boundary must trigger 5 policy violations');
  assert.ok(
    violations.some(
      (v) => v.metric === 'cpu_instructions' && v.rule === 'strict_zero_tolerance' && v.delta > 0,
    ),
    'Strict CPU policy violation must be enforced when temporary storage expiry increases CPU',
  );

  const rendered = renderComment(expiryDiff, violations, 'live-950', 'expd-951');
  assert.equal(rendered, summary);
  assert.match(summary, /threshold violation/);
  assert.match(summary, /comparing `live-950` → `expd-951`/);
  assert.match(summary, /cpu_instructions increased by .*strict zero tolerance/);

  // 6. Verify rejected paths and cross-boundary drift recovery without manipulating claimed provenance
  assert.ok(Array.isArray(rejectedPaths), 'rejectedPaths must be an array');
  assert.equal(rejectedPaths.length, 5, 'Must archive 4 rejected boundary cases and 1 drift-recovery proof');

  const byId = new Map(rejectedPaths.map((item) => [item.case_id, item]));

  // Case A: Stale expired temporary entry supplied in snapshot at ledger 951 (live_until = 950 < 951)
  const staleCase = byId.get('stale_expired_temporary_entry_snapshot');
  assert.ok(staleCase, 'Missing stale_expired_temporary_entry_snapshot case');
  assert.equal(staleCase.outcome, 'REJECTED');
  assert.equal(staleCase.ledger, 951);
  assert.equal(staleCase.live_until, 950);
  assert.ok(staleCase.live_until < staleCase.ledger, 'Stale case must have live_until < ledger');
  assert.match(staleCase.error_message, /archived ledger state is unsupported/);
  assert.equal(staleCase.measurement_emitted, false);
  assert.equal(staleCase.provenance_emitted, false);
  const staleReplay = nativeReplays.find((r) => r.case_id === 'stale_expired_temporary_entry_snapshot');
  assert.ok(staleReplay, 'Native replay log must record the rejected stale-entry helper invocation');
  assert.equal(staleReplay.output, null);
  assert.match(staleReplay.error, /archived ledger state is unsupported/);
  assert.equal(sha256(JSON.stringify(staleReplay.input)), staleCase.input_sha256);

  // Case B: Required temporary entry expired at ledger 951 with no fallback (RPC simulation failure)
  const rpcMissingCase = byId.get('required_expired_temporary_entry_rpc_failure');
  assert.ok(rpcMissingCase, 'Missing required_expired_temporary_entry_rpc_failure case');
  assert.equal(rpcMissingCase.outcome, 'REJECTED');
  assert.equal(rpcMissingCase.ledger, 951);
  assert.match(rpcMissingCase.error_message, /RPC simulation failed:.*Storage, MissingValue/);
  assert.equal(rpcMissingCase.helper_invocations, 0);
  assert.equal(rpcMissingCase.measurement_emitted, false);
  assert.equal(rpcMissingCase.provenance_emitted, false);

  // Case C: Cross-boundary RPC/native parity disagreement at ledger 951
  const parityCase = byId.get('cross_boundary_rpc_native_parity_mismatch');
  assert.ok(parityCase, 'Missing cross_boundary_rpc_native_parity_mismatch case');
  assert.equal(parityCase.outcome, 'REJECTED');
  assert.equal(parityCase.ledger, 951);
  assert.match(
    parityCase.error_message,
    /Local simulation disagrees with RPC at captured ledger.*transaction-data disagreement.*return-value disagreement/,
  );
  assert.equal(parityCase.measurement_emitted, false);
  assert.equal(parityCase.provenance_emitted, false);

  // Case D: Persistent ledger drift across 950 -> 951 exhausting all 30 capture attempts
  const driftExhaustedCase = byId.get('persistent_cross_boundary_ledger_drift_exhaustion');
  assert.ok(driftExhaustedCase, 'Missing persistent_cross_boundary_ledger_drift_exhaustion case');
  assert.equal(driftExhaustedCase.outcome, 'REJECTED');
  assert.equal(driftExhaustedCase.simulated_ledger, 950);
  assert.equal(driftExhaustedCase.drifted_entries_ledger, 951);
  assert.equal(driftExhaustedCase.attempts, 30);
  assert.equal(driftExhaustedCase.last_cause, 'ledger_drift');
  assert.match(
    driftExhaustedCase.error_message,
    /Unable to capture a complete consistent snapshot after 30 attempts \(last cause: ledger_drift/,
  );
  assert.equal(driftExhaustedCase.measurement_emitted, false);
  assert.equal(driftExhaustedCase.provenance_emitted, false);

  // Case E: Single cross-boundary drift (950 -> 951) discards partial 950 read and recaptures cleanly at 951
  const driftRecoveredCase = byId.get('single_cross_boundary_drift_recapture_at_951');
  assert.ok(driftRecoveredCase, 'Missing single_cross_boundary_drift_recapture_at_951 case');
  assert.equal(driftRecoveredCase.outcome, 'ACCEPTED_AFTER_FULL_RECAPTURE');
  assert.equal(driftRecoveredCase.discarded_ledger, 950);
  assert.equal(driftRecoveredCase.emitted_provenance.ledger, 951);
  assert.deepEqual(
    driftRecoveredCase.emitted_provenance,
    runs[3].reference_measurements[0].benchmarks[0].provenance,
    'Recaptured post-expiry provenance at ledger 951 must match authentic Run 4 provenance without backdating to 950',
  );

  return true;
}

module.exports = {
  MEASURED_KEYS,
  UNAVAILABLE_KEYS,
  decodeSymbolVec,
  decodeHeaderLedgerAndTimestamp,
  buildTemporaryStorageKey,
  verifyTemporaryStorageExpiry,
};
