// Analysis and verification for the discarded simulation writes proof (#172).
// Uses the existing public fixture parser, measurement, simulation, diff, threshold, and report APIs
// without implementing committed setup (#58) or altering production semantics.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Address, xdr } = require('@stellar/stellar-sdk');
const { parseFixtures } = require('../../dist/identity');
const { validateLedgerKeyEntryCorrespondence } = require('../../dist/simulation');
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

function decodeSymbolVec(retvalXdr) {
  const scVal = xdr.ScVal.fromXDR(retvalXdr, 'base64');
  assert.equal(scVal.switch().name, 'scvVec', 'Expected Vec<Symbol> return value');
  return scVal.vec().map((item) => {
    assert.equal(item.switch().name, 'scvSymbol', 'Expected Symbol element in return vector');
    return item.sym().toString('utf8');
  });
}

function decodeHeaderLedgerAndTimestamp(headerXdr) {
  let header;
  try {
    header = xdr.LedgerHeaderHistoryEntry.fromXDR(headerXdr, 'base64').header();
  } catch {
    header = xdr.LedgerHeader.fromXDR(headerXdr, 'base64');
  }
  return {
    protocol: header.ledgerVersion(),
    ledger: header.ledgerSeq(),
    timestamp: Number(header.scpValue().closeTime().toString()),
  };
}

function buildPersistentStateKey(contractId, symbolName = 'state') {
  const contractScAddress = Address.fromString(contractId).toScAddress();
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractScAddress,
      key: xdr.ScVal.scvSymbol(symbolName),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

function verifyDiscardedWritesProof({
  contractSource,
  fixtureJson,
  environment,
  deployment,
  measurementResults,
  caseSequence,
  returnValuesArchive,
  rpcCalls,
  nativeReplays,
  seededStateControl,
  rejectedPaths,
  analysis,
  controlDiff,
  seededVsDiscardedDiff,
  policy,
  violations,
  summary,
  verification,
}) {
  assert.equal(verification.status, 'VERIFIED');
  assert.equal(verification.scenario, 'discarded_simulation_writes_proof');
  assert.equal(verification.fresh_deployment_verified, true);
  assert.equal(verification.write_then_read_sequence_verified, true);
  assert.equal(verification.write_case_simulated_only, true);
  assert.equal(verification.read_case_observes_committed_state, true);
  assert.equal(verification.return_values_archived, true);
  assert.equal(verification.setup_requirement_explained, true);
  assert.equal(verification.rejected_paths_verified, true);
  assert.equal(verification.committed_setup_implemented_in_this_pr, false);
  assert.equal(verification.unavailable_metrics_explicit_null, true);

  // 1. Contract source implements write, read, and require modes on persistent storage
  assert.match(
    contractSource,
    /pub fn hello\(env:\s*Env,\s*mode:\s*Symbol\)\s*->\s*Vec<Symbol>/,
    'Proof contract must expose hello(env: Env, mode: Symbol) -> Vec<Symbol>',
  );
  assert.ok(
    contractSource.includes('persistent.set(&STATE_KEY, &SEEDED_VALUE)'),
    'Proof contract write mode must set STATE_KEY in persistent storage',
  );
  assert.ok(
    contractSource.includes('persistent.get::<Symbol, Symbol>(&STATE_KEY)'),
    'Proof contract read mode must read STATE_KEY from persistent storage',
  );
  assert.ok(
    contractSource.includes('setup required: state key not initialized in committed storage'),
    'Proof contract require mode must fail closed when STATE_KEY is absent from committed storage',
  );

  // 2. Fixture JSON parses cleanly with distinct case identities on a single contract
  const parsedFixture = parseFixtures(
    typeof fixtureJson === 'string' ? fixtureJson : JSON.stringify(fixtureJson),
    'tests/fixtures/discarded-writes/weighin-fixtures.json',
  );
  assert.equal(parsedFixture.fixture_id, 'id:discarded-writes-fixture');
  assert.equal(parsedFixture.contracts.length, 1);
  assert.equal(parsedFixture.contracts[0].logical_id, 'id:reference-contract');
  assert.deepEqual(
    parsedFixture.contracts[0].invocations.map((inv) => ({
      case_id: inv.case_id,
      function_name: inv.function_name,
      mode: inv.args[0].value,
    })),
    [
      { case_id: 'id:write-seed', function_name: 'hello', mode: 'write' },
      { case_id: 'id:read-after-write', function_name: 'hello', mode: 'read' },
    ],
  );

  // 3. Fresh deployment evidence confirms only upload + create transactions were submitted
  assert.equal(deployment.was_already_deployed_before_run, false);
  assert.equal(deployment.contract_id, environment.contract_id);
  assert.equal(deployment.wasm_sha256, environment.wasm_sha256);
  assert.equal(deployment.submitted_transactions.length, 2);
  assert.deepEqual(
    deployment.submitted_transactions.map((tx) => tx.phase),
    ['wasm_upload', 'contract_creation'],
  );
  assert.equal(deployment.submitted_invocation_transactions, 0);
  assert.equal(deployment.pre_invocation_state_key_present, false);
  assert.equal(deployment.post_write_simulation_state_key_present, false);
  assert.equal(deployment.post_suite_state_key_present, false);

  const expectedStateKey = buildPersistentStateKey(environment.contract_id, 'state');
  assert.equal(environment.persistent_state_key_xdr, expectedStateKey);

  // 4. Measurement record contains both sequential cases on the same fresh deployment
  assert.equal(measurementResults.length, 1);
  const contractRecord = measurementResults[0];
  assert.equal(contractRecord.schema_version, 4);
  assert.equal(contractRecord.fixture_id, 'id:discarded-writes-fixture');
  assert.equal(contractRecord.logical_id, 'id:reference-contract');
  assert.equal(contractRecord.contract_id, environment.contract_id);
  assert.equal(contractRecord.benchmarks.length, 2);

  const [writeBench, readBench] = contractRecord.benchmarks;
  assert.equal(writeBench.case_id, 'id:write-seed');
  assert.equal(readBench.case_id, 'id:read-after-write');
  assert.equal(writeBench.wasm_sha256, environment.wasm_sha256);
  assert.equal(readBench.wasm_sha256, environment.wasm_sha256);

  for (const bench of [writeBench, readBench]) {
    for (const key of MEASURED_KEYS) {
      assert.equal(bench.metrics[key].availability, 'measured');
      assert.equal(typeof bench.metrics[key].consumed, 'number');
    }
    for (const key of UNAVAILABLE_KEYS) {
      assert.equal(bench.metrics[key].availability, 'unavailable');
      assert.equal(bench.metrics[key].consumed, null);
      assert.equal(bench.metrics[key].limit, null);
      assert.equal(typeof bench.metrics[key].reason, 'string');
    }
  }

  // Write case simulates a persistent write (1 RW entry, 88 write bytes)
  assert.equal(writeBench.metrics.ledger_write_entries.consumed, 1);
  assert.ok(writeBench.metrics.ledger_write_bytes.consumed > 0);
  assert.equal(writeBench.metrics.ledger_read_entries.consumed, 3);

  // Subsequent read case on the same deployment writes 0 entries/bytes and reads uncommitted (null) state
  assert.equal(readBench.metrics.ledger_write_entries.consumed, 0);
  assert.equal(readBench.metrics.ledger_write_bytes.consumed, 0);
  assert.equal(readBench.metrics.ledger_read_entries.consumed, 3);

  // 5. Case sequence and return values archive prove state loss across simulated invocations
  assert.equal(caseSequence.length, 2);
  const [writeStep, readStep] = caseSequence;
  assert.equal(writeStep.order, 1);
  assert.equal(writeStep.case_id, 'id:write-seed');
  assert.equal(writeStep.mode_arg, 'write');
  assert.equal(writeStep.transaction_submitted, false);
  assert.equal(writeStep.committed_state_before_xdr, null);
  assert.equal(writeStep.committed_state_after_xdr, null);
  assert.deepEqual(writeStep.decoded_return, ['Hello', 'write', 'wrote', 'seeded']);

  assert.equal(readStep.order, 2);
  assert.equal(readStep.case_id, 'id:read-after-write');
  assert.equal(readStep.mode_arg, 'read');
  assert.equal(readStep.transaction_submitted, false);
  assert.equal(readStep.committed_state_before_xdr, null);
  assert.equal(readStep.committed_state_after_xdr, null);
  assert.equal(readStep.observed_prior_simulated_write, false);
  assert.deepEqual(readStep.decoded_return, ['Hello', 'read', 'absent', 'uninit']);

  // Verify raw RPC and native replay records match the archived return values and footprints
  assert.equal(rpcCalls.length, 2);
  assert.equal(nativeReplays.length, 2);

  for (let i = 0; i < 2; i += 1) {
    const step = caseSequence[i];
    const rpcCapture = rpcCalls[i];
    const nativeReplay = nativeReplays[i];

    assert.equal(rpcCapture.case_id, step.case_id);
    assert.equal(nativeReplay.case_id, step.case_id);

    const headerInfo = decodeHeaderLedgerAndTimestamp(
      rpcCapture.get_ledgers.result.ledgers[0].headerXdr,
    );
    assert.equal(headerInfo.protocol, 28);
    assert.equal(headerInfo.ledger, step.snapshot_ledger);

    const rpcDecodedReturn = decodeSymbolVec(
      rpcCapture.simulate_transaction.result.results[0].xdr,
    );
    const nativeDecodedReturn = decodeSymbolVec(nativeReplay.output.retval_xdr);
    assert.deepEqual(rpcDecodedReturn, step.decoded_return);
    assert.deepEqual(nativeDecodedReturn, step.decoded_return);

    const returnedEntries = rpcCapture.get_ledger_entries.result.entries;
    for (const row of returnedEntries) {
      assert.ok(
        rpcCapture.queried_keys.includes(row.key),
        `Unexpected unqueried key in get_ledger_entries for ${step.case_id}`,
      );
      validateLedgerKeyEntryCorrespondence(row.key, row.xdr);
    }
    const entryMap = new Map(returnedEntries.map((row) => [row.key, row]));
    assert.equal(entryMap.has(expectedStateKey), false);

    const stateSnapshotEntry = nativeReplay.snapshot.entries.find(
      (entry) => entry.key_xdr === expectedStateKey,
    );
    assert.ok(stateSnapshotEntry, `Missing state key in snapshot for ${step.case_id}`);
    assert.equal(
      stateSnapshotEntry.entry_xdr,
      null,
      `Expected state key to be absent (null) in committed snapshot for ${step.case_id}`,
    );
  }

  assert.deepEqual(nativeReplays[0].output.read_write_keys, [expectedStateKey]);
  assert.equal(nativeReplays[0].output.modified_entries, 1);
  assert.deepEqual(nativeReplays[1].output.read_write_keys, []);
  assert.ok(nativeReplays[1].output.read_only_keys.includes(expectedStateKey));
  assert.equal(nativeReplays[1].output.modified_entries, 0);

  // 6. Verify returnValuesArchive and setup explanation
  assert.deepEqual(returnValuesArchive.write_case.decoded_symbols, [
    'Hello',
    'write',
    'wrote',
    'seeded',
  ]);
  assert.deepEqual(returnValuesArchive.read_after_write_case.decoded_symbols, [
    'Hello',
    'read',
    'absent',
    'uninit',
  ]);
  assert.deepEqual(returnValuesArchive.seeded_state_control_read.decoded_symbols, [
    'Hello',
    'read',
    'present',
    'seeded',
  ]);
  assert.notDeepEqual(
    returnValuesArchive.read_after_write_case.decoded_symbols,
    returnValuesArchive.seeded_state_control_read.decoded_symbols,
  );
  assert.equal(typeof returnValuesArchive.why_setup_is_required, 'string');
  assert.ok(returnValuesArchive.why_setup_is_required.includes('#58'));
  assert.ok(returnValuesArchive.why_setup_is_required.includes('simulateTransaction'));

  // 7. Verify control comparison (what read observes when state IS committed vs discarded)
  assert.deepEqual(
    decodeSymbolVec(seededStateControl.retval_xdr),
    ['Hello', 'read', 'present', 'seeded'],
  );
  assert.equal(seededStateControl.committed_state_entry_present, true);
  assert.ok(
    seededStateControl.benchmark.metrics.ledger_read_bytes.consumed >
      readBench.metrics.ledger_read_bytes.consumed,
    'Reading committed state entry consumes more ledger_read_bytes than reading an absent entry',
  );
  assert.equal(controlDiff.contracts.length, 1);
  assert.equal(
    controlDiff.contracts[0].functions[0].metrics
      .filter((m) => m.availability === 'comparable')
      .every((m) => m.delta === 0),
    true,
  );
  assert.equal(seededVsDiscardedDiff.contracts.length, 1);
  const readBytesDiff = seededVsDiscardedDiff.contracts[0].functions[0].metrics.find(
    (m) => m.key === 'ledger_read_bytes',
  );
  assert.ok(readBytesDiff && readBytesDiff.delta > 0);
  assert.ok(violations.length > 0);
  const renderedReport = renderComment(
    seededVsDiscardedDiff,
    violations,
    environment.git_commit,
    environment.git_commit,
  );
  assert.ok(summary.includes(renderedReport.trim()));

  // 8. Verify failure / invalid cases
  assert.equal(rejectedPaths.length, 4);
  const byId = Object.fromEntries(rejectedPaths.map((item) => [item.id, item]));
  assert.match(
    byId.uninitialized_require_after_simulated_write.error,
    /Simulation failed for hello/,
  );
  assert.match(
    byId.duplicate_case_identity_collision.error,
    /Duplicate benchmark identity/,
  );
  assert.match(
    byId.native_parity_return_mismatch.error,
    /Native simulation return value does not match RPC simulation/,
  );
  assert.match(
    byId.unverified_state_key_injection.error,
    /Ledger entry\/key mismatch: contract-data identity/,
  );

  // 9. Summary checks
  assert.ok(summary.includes('["Hello","write","wrote","seeded"]'));
  assert.ok(summary.includes('["Hello","read","absent","uninit"]'));
  assert.ok(summary.includes('["Hello","read","present","seeded"]'));
  assert.ok(summary.includes('fixture-setup-design.md'));
  assert.ok(summary.includes('#58'));

  return {
    expectedStateKey,
    writeReturn: writeStep.decoded_return,
    readReturn: readStep.decoded_return,
  };
}

module.exports = {
  MEASURED_KEYS,
  UNAVAILABLE_KEYS,
  sha256,
  decodeSymbolVec,
  decodeHeaderLedgerAndTimestamp,
  buildPersistentStateKey,
  verifyDiscardedWritesProof,
};
