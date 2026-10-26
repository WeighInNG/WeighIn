const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { Transaction } = require('@stellar/stellar-sdk');

const { measureInvocation, simulateSnapshot } = require('../dist/simulation');
const { metricsFromSimulation } = require('../dist/measurement');
const { diffBenchmarks } = require('../dist/diff');
const { enforceThresholds } = require('../dist/threshold');
const { renderComment } = require('../dist/comment');
const {
  FIXED_NATIVE_PRNG_SEED,
  computeParityDetails,
  verifyPrngParity,
} = require('./experiments/prng-parity-analysis.cjs');

const archiveDir = path.resolve(__dirname, '../docs/experiments/prng-parity');
const fixtureDir = path.resolve(__dirname, 'fixtures/prng-parity');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));

function loadBundle() {
  return {
    contractSource: fs.readFileSync(path.join(archiveDir, 'source/contract/src/lib.rs'), 'utf8'),
    environment: readJson('environment.json'),
    measurements: readJson('measurements.json'),
    rejections: readJson('rejections.json'),
    rpcCalls: readJson('rpc.json'),
    nativeReplays: readJson('native.json'),
    controlDiff: readJson('control-diff.json'),
    policy: readJson('policy.json'),
    violations: readJson('violations.json'),
    summary: fs.readFileSync(path.join(archiveDir, 'summary.md'), 'utf8'),
    verification: readJson('verification.json'),
  };
}

test('retained prng-parity archive matches all SHA256 checksums and satisfies all acceptance criteria', () => {
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

  assert.equal(Object.isFrozen(FIXED_NATIVE_PRNG_SEED), true);
  assert.deepEqual(FIXED_NATIVE_PRNG_SEED, Array(32).fill(0));
  assert.ok(verifyPrngParity(bundle));
});

test('justified matching condition replays through measureInvocation and metricsFromSimulation with fixed [0; 32] seed and genuine nonzero metrics', async (t) => {
  const { measurements, rpcCalls, nativeReplays, policy } = loadBundle();
  const helperPath = path.join(archiveDir, 'contract.wasm');

  for (const [idx, caseLabel] of ['zero_seed_parity_1', 'zero_seed_parity_2'].entries()) {
    const caseRpc = rpcCalls.filter((c) => c.case === caseLabel);
    const caseNative = nativeReplays.find((r) => r.case === caseLabel);
    assert.ok(caseNative, `Missing native replay for ${caseLabel}`);
    const simCall = caseRpc.find((c) => c.request.method === 'simulateTransaction');
    assert.ok(simCall, `Missing simulateTransaction RPC record for ${caseLabel}`);

    t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
      const req = JSON.parse(fetchOptions.body);
      const matched = caseRpc.find((c) => c.request.method === req.method);
      assert.ok(matched, `Unexpected RPC method ${req.method} during ${caseLabel} replay`);
      return new Response(JSON.stringify({ ...matched.raw, jsonrpc: '2.0', id: req.id }));
    });

    t.mock.method(cp, 'execFile', (file, _args, _options, callback) => {
      assert.equal(file, helperPath);
      const stdin = new EventEmitter();
      stdin.on = () => stdin;
      stdin.end = (data) => {
        const parsed = JSON.parse(data);
        assert.deepEqual(parsed.seed, Array(32).fill(0));
        assert.equal(sha256(data), measurements[idx].benchmarks[0].provenance.input_sha256);
        setImmediate(() => callback(null, JSON.stringify(caseNative.output), ''));
      };
      return { stdin };
    });

    const tx = new Transaction(
      simCall.request.params.transaction,
      caseNative.input.network_passphrase,
    );
    const replayed = await measureInvocation('http://localhost:18000/rpc', tx, helperPath);
    const replayedMetrics = metricsFromSimulation(replayed.output, replayed.limits);
    const savedBenchmark = measurements[idx].benchmarks[0];

    assert.deepEqual(replayed.provenance, savedBenchmark.provenance);
    assert.deepEqual(replayedMetrics, savedBenchmark.metrics);
    assert.ok(replayedMetrics.cpu_instructions.consumed > 0);
    assert.ok(replayedMetrics.memory_bytes.consumed > 0);
    assert.equal(replayedMetrics.historical_data_read_bytes.consumed, null);
    assert.equal(replayedMetrics.contract_data_hard_limit.consumed, null);
    assert.equal(replayedMetrics.tx_size_bytes.consumed, null);
  }

  const diff = diffBenchmarks([measurements[0]], [measurements[1]]);
  assert.equal(diff.hasRegression, false);
  assert.deepEqual(enforceThresholds(diff, policy), []);
  const rendered = renderComment(diff, [], 'zero-seed-run-1', 'zero-seed-run-2');
  assert.match(rendered, /All thresholds passed/);
});

test('all four divergent PRNG replay modes fail closed with parity mismatch and structured SimulationParityDetails', async (t) => {
  const { rejections, rpcCalls, nativeReplays } = loadBundle();
  const helperPath = path.join(archiveDir, 'contract.wasm');

  const parityCases = rejections.filter((r) => r.case !== 'malformed_native_seed_rejected');
  assert.equal(parityCases.length, 4);

  for (const rejected of parityCases) {
    const caseRpc = rpcCalls.filter((c) => c.case === rejected.case);
    const caseNative = nativeReplays.find((r) => r.case === rejected.case);
    assert.ok(caseNative, `Missing native replay for ${rejected.case}`);
    const simCall = caseRpc.find((c) => c.request.method === 'simulateTransaction');
    assert.ok(simCall, `Missing simulateTransaction RPC record for ${rejected.case}`);

    t.mock.method(globalThis, 'fetch', async (_url, fetchOptions) => {
      const req = JSON.parse(fetchOptions.body);
      const matched = caseRpc.find((c) => c.request.method === req.method);
      assert.ok(matched, `Unexpected RPC method ${req.method} during ${rejected.case} replay`);
      return new Response(JSON.stringify({ ...matched.raw, jsonrpc: '2.0', id: req.id }));
    });

    t.mock.method(cp, 'execFile', (file, _args, _options, callback) => {
      assert.equal(file, helperPath);
      const stdin = new EventEmitter();
      stdin.on = () => stdin;
      stdin.end = (data) => {
        const parsed = JSON.parse(data);
        assert.deepEqual(parsed.seed, Array(32).fill(0));
        setImmediate(() => callback(null, JSON.stringify(caseNative.output), ''));
      };
      return { stdin };
    });

    const tx = new Transaction(
      simCall.request.params.transaction,
      caseNative.input.network_passphrase,
    );
    await assert.rejects(
      async () => measureInvocation('http://localhost:18000/rpc', tx, helperPath),
      (err) => {
        assert.match(
          err.message,
          /Local simulation disagrees with RPC at captured ledger[\s\S]*auth\/random\/state-dependent invocation is unsupported/,
        );
        const computed = computeParityDetails(
          caseNative.output,
          simCall.raw.result,
          caseNative.input.seed,
        );
        assert.deepEqual(computed, rejected.parity_details);
        assert.deepEqual(computed.seed, Array(32).fill(0));
        return true;
      },
    );
  }

  // Also verify malformed seed rejection in simulateSnapshot
  const malformedCase = rejections.find((r) => r.case === 'malformed_native_seed_rejected');
  assert.ok(malformedCase);
  const malformedNative = nativeReplays.find((r) => r.case === 'malformed_native_seed_rejected');
  assert.ok(malformedNative);

  t.mock.method(cp, 'execFile', (file, _args, _options, callback) => {
    assert.equal(file, helperPath);
    const stdin = new EventEmitter();
    stdin.on = () => stdin;
    stdin.end = (data) => {
      const parsed = JSON.parse(data);
      assert.deepEqual(parsed.seed, [0]);
      const err = new Error('PRNG seed must be exactly 32 bytes');
      setImmediate(() => callback(err, '', err.message));
    };
    return { stdin };
  });

  await assert.rejects(
    async () => simulateSnapshot(malformedNative.input, helperPath),
    (err) => {
      assert.match(err.message, /PRNG seed must be exactly 32 bytes/);
      return true;
    },
  );
});

test('verifyPrngParity rejects missing env.prng(), accidental env.ledger() coupling, forced seeds, zeroed metrics, or suppressed parity rejections', () => {
  const baseBundle = loadBundle();

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.contractSource = mutated.contractSource.replace('env.prng()', '0u64');
    verifyPrngParity(mutated);
  }, /Proof contract must explicitly invoke env\.prng\(\)\.gen_range/);

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.contractSource += '\n// env.ledger().sequence()\n';
    verifyPrngParity(mutated);
  }, /PRNG parity proof contract must not branch on env\.ledger\(\)/);

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.measurements[0].benchmarks[0].provenance.seed[0] = 7;
    verifyPrngParity(mutated);
  }, /Provenance seed must be the fixed 32-byte zero array and never silently overridden/);

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.measurements[0].benchmarks[0].metrics.cpu_instructions.consumed = 0;
    verifyPrngParity(mutated);
  }, /Metric cpu_instructions mismatch/);

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.measurements[0].benchmarks[0].metrics.historical_data_read_bytes.consumed = 0;
    verifyPrngParity(mutated);
  }, /Unavailable metric historical_data_read_bytes must remain null/);

  assert.throws(() => {
    const mutated = structuredClone(baseBundle);
    mutated.rejections = mutated.rejections.filter((r) => r.case !== 'divergent_return_value_only');
    verifyPrngParity(mutated);
  }, /Archive must contain all 5 required PRNG parity\/seed rejection cases/);
});
