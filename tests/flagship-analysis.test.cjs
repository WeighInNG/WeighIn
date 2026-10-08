const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { verifyScenario } = require('./experiments/flagship-analysis.cjs');
const { enforceThresholds } = require('../dist/threshold');
const { renderComment } = require('../dist/comment');
// Real saved schema-4 results. Mutations exercise the verifier only, never live evidence.
function evidence(scenario) {
  const label = scenario === 'control' ? 'control' : 'regression';
  const dir = path.join(__dirname, '../docs/experiments/metric-provenance/action');
  const diff = JSON.parse(fs.readFileSync(path.join(dir, `${label}-diff.json`)));
  const c = diff.contracts[0];
  const policy = scenario === 'regression' ? {} : { thresholds: { functions: { hello: { cpu_instructions: 'strict_zero_tolerance' } } } };
  const summary = renderComment(diff, enforceThresholds(diff, policy), 'main', c.head_commit);
  return { scenario, diff, summary, status: scenario === 'threshold' ? 1 : 0, result: scenario === 'threshold' ? 'fail' : 'pass',
    baseSha: c.base_commit, headSha: c.head_commit, expectedIdentities: diff.contracts.map(c => [c.fixture_id, c.logical_id]),
    buildHashes: Array.from({ length: diff.contracts.length * 2 }, (_, i) => scenario === 'control' || i < diff.contracts.length ? 'base-wasm-hash' : 'changed-wasm-hash') };
}
for (const scenario of ['control', 'regression', 'threshold']) test(`saved live ${scenario} evidence satisfies the scenario contract`, () => {
  const result = verifyScenario(evidence(scenario)); assert.equal(result.status, 'VERIFIED');
  assert.equal(result.action_exit, scenario === 'threshold' ? 1 : 0);
});
test('an infrastructure exit 1 with no comparison cannot prove policy failure', () => {
  const e = evidence('threshold'); e.diff = {}; e.summary = 'Required BASE comparison failed';
  assert.throws(() => verifyScenario(e));
});
test('wrong exit code or output result cannot prove threshold failure', () => {
  for (const change of [e => e.status = 0, e => e.result = 'pass']) {
    const e = evidence('threshold'); change(e); assert.throws(() => verifyScenario(e));
  }
});
test('unmatched, renamed or missing configured benchmarks cannot be silently accepted', () => {
  for (const change of [e => e.diff.contracts = [], e => e.diff.contracts[0].logical_id = 'unrelated',
    e => e.diff.contracts[0].functions[0].case_id = 'different-case', e => e.diff.newContracts.push('unmatched')]) {
    const e = evidence('threshold'); change(e); assert.throws(() => verifyScenario(e));
  }
});
test('unchanged WASM or runtime identity cannot prove a changed-WASM regression', () => {
  for (const change of [e => e.buildHashes.fill('same'), e => e.diff.contracts[0].head_contract_id = e.diff.contracts[0].base_contract_id]) {
    const e = evidence('threshold'); change(e); assert.throws(() => verifyScenario(e));
  }
});
test('a control resource change or unavailable CPU is rejected', () => {
  const control = evidence('control'); control.diff.contracts[0].functions[0].metrics[0].delta = 1;
  assert.throws(() => verifyScenario(control));
  const missing = evidence('threshold'); missing.diff.contracts[0].functions[0].metrics[0].availability = 'unavailable';
  assert.throws(() => verifyScenario(missing));
});
test('a threshold report must actually describe the CPU policy violation', () => {
  const e = evidence('threshold'); e.summary = 'Infrastructure failure';
  assert.throws(() => verifyScenario(e));
});
