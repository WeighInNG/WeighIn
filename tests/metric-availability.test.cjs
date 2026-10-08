const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffBenchmarks, METRIC_KEYS } = require('../dist/diff');
const { enforceThresholds } = require('../dist/threshold');
const { renderComment } = require('../dist/comment');
const captured = require('../docs/experiments/compute-source-spike/base-output.json');
const saved = require('../docs/experiments/compute-source-spike/provenance.json');

function result(label = 'base', consumed = captured.cpu_instructions_consumed) {
  const p = saved[label];
  const metrics = Object.fromEntries(METRIC_KEYS.map(key => [key, { availability: 'unavailable', consumed: null, limit: null, reason: 'No verified consumption source' }]));
  metrics.cpu_instructions = { availability: 'measured', consumed, limit: captured.cpu_limit, source: 'soroban-simulation.simulated_instructions' };
  metrics.memory_bytes = { availability: 'measured', consumed: captured.memory_bytes_consumed, limit: captured.memory_limit, source: 'soroban-simulation.simulated_memory' };
  return [{ schema_version: 3, fixture_id: p.fixture_id, logical_id: p.logical_id, contract_id: p.contract_id,
    git_commit: label, soroban_sdk_version: '25.3.1', timestamp: 0,
    benchmarks: [{ function_name: 'hello', case_id: p.case_id, wasm_sha256: p.wasm_sha256, metrics,
      provenance: { source: 'soroban-simulation', source_version: '28.0.1', protocol: 28,
        helper_sha256: p.helper_sha256, network_id: 'captured-local-network', ledger: 229,
        header_sha256: 'captured-header', snapshot_sha256: p.snapshot_sha256, config_sha256: 'captured-config', compute_config_sha256: 'captured-compute-config',
        input_sha256: p.input_sha256, seed: p.seed, auth_mode: 'recording(true,true)', host_features: p.host_features } }] }];
}

const cpuPolicy = { thresholds: { functions: { hello: { cpu_instructions: 'strict_zero_tolerance' } } } };
test('schema 3 pairs changed WASM/address and compares genuine measured CPU while retaining unavailable metrics', () => {
  const head = require('../docs/experiments/compute-source-spike/head-output.json');
  const diff = diffBenchmarks(result(), result('head', head.cpu_instructions_consumed));
  assert.equal(diff.contracts.length, 1);
  const metrics = diff.contracts[0].functions[0].metrics;
  assert.equal(metrics[0].delta, 43827);
  assert.equal(metrics[0].availability, 'comparable');
  assert.equal(metrics[2].delta, null);
  assert.equal(metrics[2].availability, 'unavailable');
  assert.equal(metrics[2].regression, false);
  assert.equal(enforceThresholds(diff, cpuPolicy).length, 1);
});
test('unchanged measured CPU passes its policy despite unrelated unavailable metrics', () => {
  const diff = diffBenchmarks(result(), result('head'));
  assert.deepEqual(enforceThresholds(diff, cpuPolicy), []);
  assert.equal(diff.hasRegression, false);
});
test('unavailable consumption is not confused with measured zero or improvement', () => {
  const base = result();
  const head = result('head');
  head[0].benchmarks[0].metrics.cpu_instructions = { availability: 'unavailable', consumed: null, limit: null, reason: 'Unsupported source' };
  const diff = diffBenchmarks(base, head);
  assert.equal(diff.contracts[0].functions[0].metrics[0].delta, null);
  const violations = enforceThresholds(diff, cpuPolicy);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].delta, null);
  assert.match(violations[0].message, /unavailable; cannot evaluate configured policy/);
});
test('per-function, global caps and all-metric policies require availability; ignore explicitly opts out', () => {
  const diff = diffBenchmarks(result(), result('head'));
  const per = enforceThresholds(diff, { thresholds: { functions: { hello: { ledger_read_bytes: 10 } } } });
  assert.equal(per.length, 1);
  const all = enforceThresholds(diff, { thresholds: { global: { fail_on_any_regression: true } } });
  assert.equal(all.length, 9);
  assert.ok(all.every(v => v.delta === null));
  assert.deepEqual(enforceThresholds(diff, { thresholds: { functions: { hello: { ledger_read_bytes: 'ignore' } } } }), []);
  const missingCpu = result('head');
  missingCpu[0].benchmarks[0].metrics.cpu_instructions = { availability: 'unavailable', consumed: null, limit: null, reason: 'Missing source' };
  assert.equal(enforceThresholds(diffBenchmarks(result(), missingCpu), { thresholds: { global: { max_allowed_cpu_increase_pct: 50 } } }).length, 1);
});
test('zero measured consumption is comparable and available', () => {
  const diff = diffBenchmarks(result('base', 0), result('head', 1));
  assert.equal(diff.contracts[0].functions[0].metrics[0].delta, 1);
  assert.equal(diff.contracts[0].functions[0].metrics[0].pct, null);
});
test('negative/nonfinite/missing consumption and false unavailable zero records are rejected', () => {
  for (const value of [NaN, Infinity, -1, undefined]) {
    const head = result('head'); head[0].benchmarks[0].metrics.cpu_instructions.consumed = value;
    assert.throws(() => diffBenchmarks(result(), head), /Invalid measured metric/);
  }
  const missing = result('head'); delete missing[0].benchmarks[0].metrics.cpu_instructions;
  assert.throws(() => diffBenchmarks(result(), missing), /Missing metric/);
  const falseZero = result('head'); falseZero[0].benchmarks[0].metrics.ledger_read_entries.consumed = 0;
  assert.throws(() => diffBenchmarks(result(), falseZero), /Invalid unavailable metric/);
});
test('reports retain human identity, measured values, unavailable reasons and snapshot provenance', () => {
  const diff = diffBenchmarks(result(), result('head', 314046));
  const report = renderComment(diff, enforceThresholds(diff, cpuPolicy), 'base', 'head');
  for (const value of ['+43,827', 'Unavailable', 'No verified consumption source', 'protocol 28', 'Snapshot ledgers', saved.base.contract_id, saved.head.contract_id, saved.base.logical_id]) assert.ok(report.includes(value), value);
  assert.ok(!report.includes('tracked as 0'));
});
test('different protocol/config/helper/network/auth/seed provenance refuses comparison', () => {
  for (const field of ['source_version', 'protocol', 'helper_sha256', 'network_id', 'compute_config_sha256', 'seed', 'auth_mode', 'host_features']) {
    const head = result('head'); head[0].benchmarks[0].provenance[field] = field === 'protocol' ? 29
      : field === 'seed' ? Array(32).fill(1) : field === 'host_features' ? ['different'] : 'different';
    assert.throws(() => diffBenchmarks(result(), head), new RegExp(`Incompatible measurement environment: ${field}`));
  }
});
test('schema 3 requires provenance and never silently compares legacy source semantics', () => {
  const head = result('head'); delete head[0].benchmarks[0].provenance;
  assert.throws(() => diffBenchmarks(result(), head), /require compute provenance/);
  const previous = result(); previous[0].schema_version = 2;
  assert.throws(() => diffBenchmarks(previous, result('head')), /different schema versions/);
});

test('fee-only configuration/metadata changes remain visible without invalidating unchanged compute calibration', () => {
  const head = result('head'); head[0].benchmarks[0].provenance.config_sha256 = 'updated-live-state-size-window';
  const diff = diffBenchmarks(result(), head);
  assert.equal(diff.hasRegression, false);
  assert.notEqual(diff.contracts[0].functions[0].base_provenance.config_sha256, diff.contracts[0].functions[0].head_provenance.config_sha256);
});
