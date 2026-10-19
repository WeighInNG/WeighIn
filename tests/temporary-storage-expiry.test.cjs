const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { Transaction, xdr } = require('@stellar/stellar-sdk');

const { measureInvocation } = require('../dist/simulation');
const { metricsFromSimulation } = require('../dist/measurement');
const { diffBenchmarks } = require('../dist/diff');
const { enforceThresholds } = require('../dist/threshold');
const {
  verifyTemporaryStorageExpiry,
} = require('./experiments/temporary-storage-expiry-analysis.cjs');

const archiveDir = path.resolve(__dirname, '../docs/experiments/temporary-storage-expiry');
const fixtureDir = path.resolve(__dirname, 'fixtures/temporary-storage-expiry');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));

function loadBundle() {
  return {
    contractSource: fs.readFileSync(path.join(archiveDir, 'source/contract/src/lib.rs'), 'utf8'),
    environment: readJson('environment.json'),
    boundarySteps: readJson('expiry-boundary.json'),
    runs: readJson('runs.json'),
    rpcCalls: readJson('rpc.json'),
    nativeReplays: readJson('native.json'),
    rejectedPaths: readJson('rejected-paths.json'),
    analysis: readJson('analysis.json'),
    controlDiff: readJson('control-diff.json'),
    boundaryLiveDiff: readJson('boundary-live-diff.json'),
    expiryDiff: readJson('expiry-diff.json'),
    policy: readJson('policy.json'),
    violations: readJson('violations.json'),
    summary: fs.readFileSync(path.join(archiveDir, 'summary.md'), 'utf8'),
    verification: readJson('verification.json'),
  };
}

test('retained temporary-storage-expiry archive matches all SHA256 checksums and satisfies all acceptance criteria', () => {
  const checksums = readJson('sha256.json');
  for (const [file, expectedHash] of Object.entries(checksums)) {
    const actualHash = sha256(fs.readFileSync(path.join(archiveDir, file)));
    assert.equal(actualHash, expectedHash, `Checksum mismatch for ${file}`);
  }

  const bundle = loadBundle();
  for (const [rel, expectedHash] of Object.entries(bundle.environment.source_files_sha256)) {
    assert.equal(
      sha256(fs.readFileSync(path.join(fixtureDir, rel))),
      expectedHash,
      `Fixture file ${rel} must match archived source copy`,
    );
    assert.equal(
      sha256(fs.readFileSync(path.join(archiveDir, 'source', rel))),
      expectedHash,
      `Archived source file ${rel} must match recorded hash`,
    );
  }

  assert.ok(verifyTemporaryStorageExpiry(bundle));
});

test('all five controlled temporary-storage boundary samples replay through public measureInvocation and metricsFromSimulation with exact parity', async (t) => {
  const { runs, rpcCalls, nativeReplays } = loadBundle();
  const helperPath = path.join(archiveDir, 'contract.wasm');

  for (const run of runs) {
    const runRpc = rpcCalls.filter((c) => c.run === run.run);
    const runNative = nativeReplays.find((r) => r.run === run.run);
    assert.ok(runNative, `Missing native replay for run ${run.run}`);
    const simCall = runRpc.find((c) => c.request.method === 'simulateTransaction');
    assert.ok(simCall, `Missing simulateTransaction RPC record for run ${run.run}`);

    t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
      const req = JSON.parse(fetchOptions.body);
      const matched = runRpc.find((c) => c.request.method === req.method);
      assert.ok(matched, `Unexpected RPC method ${req.method} during run ${run.run} replay`);
      return new Response(JSON.stringify({ ...matched.raw, jsonrpc: '2.0', id: req.id }));
    });

    t.mock.method(cp, 'execFile', (file, _args, _options, callback) => {
      assert.equal(file, helperPath);
      const stdin = new EventEmitter();
      stdin.on = () => stdin;
      stdin.end = (data) => {
        assert.equal(
          sha256(data),
          run.reference_measurements[0].benchmarks[0].provenance.input_sha256,
        );
        setImmediate(() => callback(null, JSON.stringify(runNative.output), ''));
      };
      return { stdin };
    });

    const tx = new Transaction(
      simCall.request.params.transaction,
      runNative.input.network_passphrase,
    );
    const replayed = await measureInvocation('http://localhost:18000/rpc', tx, helperPath);
    const replayedMetrics = metricsFromSimulation(replayed.output, replayed.limits);
    const savedBenchmark = run.reference_measurements[0].benchmarks[0];

    assert.deepEqual(replayed.provenance, savedBenchmark.provenance);
    assert.deepEqual(replayedMetrics, savedBenchmark.metrics);
  }
});

test('inclusive TTL boundary (ledger 950 == live_until 950) stays live with zero delta while post-expiry (951, 960) enforces policy violations', () => {
  const { runs, policy } = loadBundle();

  // Pre-expiry control (940 -> 949): zero deltas and zero violations
  const preExpiryDiff = diffBenchmarks(
    runs[0].reference_measurements,
    runs[1].reference_measurements,
  );
  assert.equal(preExpiryDiff.hasRegression, false);
  assert.deepEqual(enforceThresholds(preExpiryDiff, policy), []);

  // Exact inclusive TTL boundary (940 -> 950 and 949 -> 950): zero deltas and zero violations
  for (const baseIdx of [0, 1]) {
    const boundaryDiff = diffBenchmarks(
      runs[baseIdx].reference_measurements,
      runs[2].reference_measurements,
    );
    assert.equal(
      boundaryDiff.hasRegression,
      false,
      `Exact boundary ledger 950 must not regress vs run ${baseIdx + 1}`,
    );
    assert.deepEqual(enforceThresholds(boundaryDiff, policy), []);
  }

  // Post-expiry snapshots (ledgers 951 and 960) compared against live boundary (ledger 950)
  // flag regressions and trigger all 5 policy violations despite identical WASM and contract_id
  for (const postIdx of [3, 4]) {
    const diff = diffBenchmarks(
      runs[2].reference_measurements,
      runs[postIdx].reference_measurements,
    );
    assert.equal(
      diff.hasRegression,
      true,
      `Post-expiry run ${postIdx + 1} must report a regression vs live boundary run 3`,
    );
    assert.equal(
      diff.contracts[0].base_contract_id,
      diff.contracts[0].head_contract_id,
      'Runtime contract ID remains unchanged across TTL expiry boundary',
    );
    const violations = enforceThresholds(diff, policy);
    assert.equal(violations.length, 5, `Post-expiry run ${postIdx + 1} must produce 5 violations`);
    assert.ok(
      violations.some((v) => v.metric === 'cpu_instructions' && v.rule === 'strict_zero_tolerance'),
    );
  }

  // Post-expiry stability (951 -> 960, both when temporary entry is absent): zero deltas
  const postExpiryStabilityDiff = diffBenchmarks(
    runs[3].reference_measurements,
    runs[4].reference_measurements,
  );
  assert.equal(postExpiryStabilityDiff.hasRegression, false);
  assert.deepEqual(enforceThresholds(postExpiryStabilityDiff, policy), []);
});

test('rejected expiry-boundary paths fail closed through measureInvocation without fabricating measurements or manipulating provenance', async (t) => {
  const { environment, rpcCalls, nativeReplays, rejectedPaths } = loadBundle();
  const helperPath = path.join(archiveDir, 'contract.wasm');
  const run3Rpc = rpcCalls.filter((c) => c.run === 3);
  const run4Rpc = rpcCalls.filter((c) => c.run === 4);
  const run4Native = nativeReplays.find((r) => r.run === 4);
  const staleNative = nativeReplays.find(
    (r) => r.case_id === 'stale_expired_temporary_entry_snapshot',
  );
  const simCall950 = run3Rpc.find((c) => c.request.method === 'simulateTransaction');
  const entriesCall950 = run3Rpc.find((c) => c.request.method === 'getLedgerEntries');
  const entriesCall951 = run4Rpc.find((c) => c.request.method === 'getLedgerEntries');
  const ledgersCall951 = run4Rpc.find((c) => c.request.method === 'getLedgers');

  const tx = new Transaction(
    simCall950.request.params.transaction,
    run4Native.input.network_passphrase,
  );

  // 1. Stale expired temporary entry in snapshot at ledger 951 (live_until = 950 < 951)
  t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
    const req = JSON.parse(fetchOptions.body);
    let result;
    if (req.method === 'getNetwork') {
      result = { passphrase: run4Native.input.network_passphrase, protocolVersion: 28 };
    } else if (req.method === 'simulateTransaction') {
      result = { ...simCall950.raw.result, latestLedger: 951 };
    } else if (req.method === 'getLedgerEntries') {
      result = {
        latestLedger: 951,
        entries: entriesCall950.raw.result.entries.map((e) => ({
          ...e,
          lastModifiedLedgerSeq:
            e.key === environment.temporary_storage_key_xdr ? 900 : 941,
        })),
      };
    } else if (req.method === 'getLedgers') {
      result = ledgersCall951.raw.result;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  });

  t.mock.method(cp, 'execFile', (file, _args, _options, callback) => {
    const stdin = new EventEmitter();
    stdin.on = () => stdin;
    stdin.end = (data) => {
      const parsed = JSON.parse(data);
      const header = xdr.LedgerHeader.fromXDR(parsed.header_xdr, 'base64');
      const expired = parsed.entries.find(
        (row) =>
          row.xdr !== null &&
          typeof row.live_until === 'number' &&
          row.live_until < header.ledgerSeq(),
      );
      assert.ok(expired);
      assert.equal(sha256(data), sha256(JSON.stringify(staleNative.input)));
      const err = new Error(`Command failed: ${file}\nError: archived ledger state is unsupported\n`);
      err.code = 1;
      err.stderr = 'Error: archived ledger state is unsupported\n';
      setImmediate(() => callback(err, '', err.stderr));
    };
    return { stdin };
  });

  await assert.rejects(
    measureInvocation('http://localhost:18000/rpc', tx, helperPath),
    /archived ledger state is unsupported/,
  );
  t.mock.restoreAll();

  // 2. Cross-boundary RPC/native parity disagreement at ledger 951
  t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
    const req = JSON.parse(fetchOptions.body);
    let result;
    if (req.method === 'getNetwork') {
      result = { passphrase: run4Native.input.network_passphrase, protocolVersion: 28 };
    } else if (req.method === 'simulateTransaction') {
      result = { ...simCall950.raw.result, latestLedger: 951 };
    } else if (req.method === 'getLedgerEntries') {
      result = entriesCall951.raw.result;
    } else if (req.method === 'getLedgers') {
      result = ledgersCall951.raw.result;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  });

  t.mock.method(cp, 'execFile', (_file, _args, _options, callback) => {
    const stdin = new EventEmitter();
    stdin.on = () => stdin;
    stdin.end = () => {
      setImmediate(() => callback(null, JSON.stringify(run4Native.output), ''));
    };
    return { stdin };
  });

  await assert.rejects(
    measureInvocation('http://localhost:18000/rpc', tx, helperPath),
    /Local simulation disagrees with RPC at captured ledger/,
  );
  t.mock.restoreAll();

  // 3. Single cross-boundary drift (950 -> 951) discards 950 and emits authentic ledger-951 provenance
  let simCount = 0;
  t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
    const req = JSON.parse(fetchOptions.body);
    let result;
    if (req.method === 'getNetwork') {
      result = { passphrase: run4Native.input.network_passphrase, protocolVersion: 28 };
    } else if (req.method === 'simulateTransaction') {
      simCount++;
      result =
        simCount === 1
          ? simCall950.raw.result
          : run4Rpc.find((c) => c.request.method === 'simulateTransaction').raw.result;
    } else if (req.method === 'getLedgerEntries') {
      result = entriesCall951.raw.result;
    } else if (req.method === 'getLedgers') {
      result = ledgersCall951.raw.result;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  });

  t.mock.method(cp, 'execFile', (_file, _args, _options, callback) => {
    const stdin = new EventEmitter();
    stdin.on = () => stdin;
    stdin.end = () => {
      setImmediate(() => callback(null, JSON.stringify(run4Native.output), ''));
    };
    return { stdin };
  });

  const recovered = await measureInvocation('http://localhost:18000/rpc', tx, helperPath);
  const savedRecovery = rejectedPaths.find(
    (p) => p.case_id === 'single_cross_boundary_drift_recapture_at_951',
  );
  assert.equal(recovered.provenance.ledger, 951);
  assert.deepEqual(recovered.provenance, savedRecovery.emitted_provenance);
});

test('verifier rejects manipulated provenance, missing temporary storage usage, expired-entry acceptance, or coerced unavailable metrics', () => {
  // 1. Missing env.storage().temporary()
  {
    const b = loadBundle();
    b.contractSource = b.contractSource.replaceAll(
      'env.storage().temporary()',
      'env.storage().persistent()',
    );
    assert.throws(
      () => verifyTemporaryStorageExpiry(b),
      /env\.storage\(\)\.temporary\(\)\.get/,
    );
  }

  // 2. Using PRNG randomness
  {
    const b = loadBundle();
    b.contractSource += '\n// env.prng()';
    assert.throws(() => verifyTemporaryStorageExpiry(b), /must not use random\/PRNG behavior/);
  }

  // 3. Manipulating claimed provenance ledger on post-expiry run
  {
    const b = loadBundle();
    b.runs[3].reference_measurements[0].benchmarks[0].provenance.ledger = 950;
    assert.throws(
      () => verifyTemporaryStorageExpiry(b),
      /Provenance ledger must match controlled boundary step/,
    );
  }

  // 4. Manipulating claimed snapshot_sha256 provenance
  {
    const b = loadBundle();
    b.runs[2].reference_measurements[0].benchmarks[0].provenance.snapshot_sha256 = '0'.repeat(64);
    assert.throws(() => verifyTemporaryStorageExpiry(b));
  }

  // 5. Falsely marking stale expired temporary entry snapshot as accepted
  {
    const b = loadBundle();
    const stale = b.rejectedPaths.find(
      (p) => p.case_id === 'stale_expired_temporary_entry_snapshot',
    );
    stale.outcome = 'ACCEPTED';
    assert.throws(() => verifyTemporaryStorageExpiry(b));
  }

  // 6. Suppressing policy violations across the expiry boundary on an unchanged WASM artifact
  {
    const b = loadBundle();
    b.violations = [];
    assert.throws(() => verifyTemporaryStorageExpiry(b));
  }

  // 7. Coercing unavailable metric to measured zero
  {
    const b = loadBundle();
    b.runs[0].reference_measurements[0].benchmarks[0].metrics.historical_data_read_bytes.consumed = 0;
    assert.throws(
      () => verifyTemporaryStorageExpiry(b),
      /Unavailable metric historical_data_read_bytes must remain null/,
    );
  }
});
