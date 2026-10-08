// Acceptance checks for real process/report evidence, also exercised with saved live diffs.
const assert = require('node:assert/strict');
const { enforceThresholds } = require('../../dist/threshold');

function verifyScenario({ scenario, diff, status, result, summary, buildHashes, baseSha, headSha, expectedIdentities }) {
  assert.ok(['control', 'regression', 'threshold'].includes(scenario), 'Unknown scenario');
  const strict = scenario !== 'regression';
  assert.equal(status, scenario === 'threshold' ? 1 : 0, 'Unexpected Action exit');
  assert.equal(result, scenario === 'threshold' ? 'fail' : 'pass', 'Unexpected Action result');
  assert.deepEqual(diff.newContracts, []);
  assert.deepEqual(diff.removedContracts, []);
  assert.deepEqual(diff.contracts.map(c => [c.fixture_id, c.logical_id]).sort(), expectedIdentities.slice().sort(), 'All configured contracts must match');
  assert.equal(buildHashes.length, expectedIdentities.length * 2, 'Both revisions must build all artifacts');
  assert.equal(new Set(buildHashes).size, scenario === 'control' ? 1 : 2, 'Unexpected WASM identity');
  const cpu = [];
  for (const contract of diff.contracts) {
    assert.equal(contract.base_commit, baseSha);
    assert.equal(contract.head_commit, headSha);
    assert.equal(contract.functions.length, 1);
    assert.deepEqual(contract.newBenchmarks, []);
    assert.deepEqual(contract.removedBenchmarks, []);
    assert.equal(contract.functions[0].function_name, 'hello');
    assert.equal(contract.functions[0].case_id, 'args:[{"type":"symbol","value":"world"}]');
    assert.ok(summary.includes(contract.logical_id), 'Report must name the logical contract');
    assert.ok(summary.includes(contract.base_contract_id) && summary.includes(contract.head_contract_id), 'Report must include runtime diagnostics');
    assert.equal(contract.base_contract_id === contract.head_contract_id, scenario === 'control');
    const metrics = contract.functions[0].metrics;
    const measured = metrics.filter(m => m.availability === 'comparable');
    assert.equal(measured.length, 8, 'Eight measured resources required');
    for (const m of measured) {
      assert.equal(m.base.availability, 'measured');
      assert.equal(m.head.availability, 'measured');
      assert.ok(Number.isSafeInteger(m.base.consumed) && Number.isSafeInteger(m.head.consumed));
      assert.equal(m.delta, m.head.consumed - m.base.consumed);
      if (scenario === 'control') assert.equal(m.delta, 0, `Unexplained control change: ${m.key}`);
    }
    const c = measured.find(m => m.key === 'cpu_instructions');
    const w = measured.find(m => m.key === 'ledger_write_bytes');
    assert.ok(c && w, 'CPU and write resources required');
    if (scenario !== 'control') {
      assert.ok(c.delta > 0 && c.regression, 'A measured CPU regression is required');
      assert.ok(w.delta > 0, 'The intentional write must consume more bytes');
    }
    cpu.push({ logical_id: contract.logical_id, base: c.base.consumed, head: c.head.consumed, delta: c.delta });
  }
  const policy = strict ? { thresholds: { functions: { hello: { cpu_instructions: 'strict_zero_tolerance' } } } } : {};
  const violations = enforceThresholds(diff, policy);
  assert.equal(violations.length, scenario === 'threshold' ? expectedIdentities.length : 0);
  if (scenario === 'threshold') {
    assert.match(summary, /threshold violation/);
    assert.match(summary, /cpu_instructions increased by .*strict zero tolerance/);
  } else assert.match(summary, /All thresholds passed/);
  return { status: 'VERIFIED', scenario, action_exit: status, result, cpu, violations };
}

module.exports = { verifyScenario };
