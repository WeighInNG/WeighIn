const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enforceThresholds } = require('../dist/threshold');

function diff(consumed, availability = 'comparable') {
  const metrics = {};
  for (const key of require('../dist/diff').METRIC_KEYS) {
    const unavailable = key === 'historical_data_read_bytes' || key === 'contract_data_hard_limit' || key === 'tx_size_bytes';
    metrics[key] = { key, base: { availability: unavailable ? 'unavailable' : 'measured', consumed: unavailable ? null : 10, limit: null },
      head: { availability: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? 'unavailable' : 'measured',
        consumed: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? null : key === 'cpu_instructions' ? consumed : 10,
        limit: null, reason: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? 'not available' : undefined },
      availability: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? 'unavailable' : 'comparable',
      reason: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? 'not available' : undefined,
      delta: unavailable || (key === 'cpu_instructions' && availability === 'unavailable') ? null : key === 'cpu_instructions' ? consumed - 10 : 0,
      pct: null, regression: key === 'cpu_instructions' && consumed > 10 };
  }
  return { contracts: [{ fixture_id: 'path:fixtures.json', logical_id: 'id:contract', contract_id: 'CA',
    base_contract_id: 'CB', head_contract_id: 'CA', base_commit: 'base', head_commit: 'head', hasRegression: false,
    newFunctions: [], removedFunctions: [], newBenchmarks: [], removedBenchmarks: [],
    functions: [{ function_name: 'run', case_id: 'args:[]', metrics: Object.values(metrics), hasRegression: false }] }],
    hasRegression: false, newContracts: [], removedContracts: [] };
}

test('absolute limits report values above the cap and pass at the cap', () => {
  const config = { limits: { global: { cpu_instructions: 50 } } };
  const violation = enforceThresholds(diff(51), config);
  assert.equal(violation.length, 1);
  assert.equal(violation[0].rule, 'absolute_limit(50)');
  assert.equal(enforceThresholds(diff(50), config).length, 0);
});

test('an absolute limit fails closed when its metric is unavailable', () => {
  const violation = enforceThresholds(diff(0, 'unavailable'), { limits: { global: { cpu_instructions: 50 } } });
  assert.equal(violation.length, 1);
  assert.equal(violation[0].delta, null);
  assert.match(violation[0].message, /unavailable/);
});

test('per-function absolute limits require a matched function', () => {
  assert.throws(() => enforceThresholds({ contracts: [], hasRegression: false, newContracts: [], removedContracts: [] },
    { limits: { functions: { missing: { cpu_instructions: 50 } } } }), /no matched BASE\/HEAD benchmark/);
});

test('comparison reports record effective policy source, distinguish absent vs loaded empty policy, and resolve per-function/per-metric rules', () => {
  const { renderComment } = require('../dist/comment');

  const absentDiff = diff(51);
  assert.deepEqual(enforceThresholds(absentDiff, null, { mode: 'head', path: 'weighin.toml', revision: 'head', present: false }), []);
  assert.equal(absentDiff.policy.status, 'absent');
  assert.equal(absentDiff.policy.evaluation_mode, 'report_only');
  assert.equal(absentDiff.policy.source.present, false);
  assert.equal(absentDiff.policy.functions[0].metrics.cpu_instructions.regression_rule, 'report_only');
  assert.equal(absentDiff.policy.functions[0].metrics.cpu_instructions.regression_rule_source, 'default');

  const emptyDiff = diff(51);
  assert.deepEqual(enforceThresholds(emptyDiff, {}, { mode: 'head', path: 'weighin.toml', revision: 'head', content_sha256: 'abc123', present: true }), []);
  assert.equal(emptyDiff.policy.status, 'empty');
  assert.equal(emptyDiff.policy.evaluation_mode, 'report_only');
  assert.equal(emptyDiff.policy.source.present, true);

  const configuredDiff = diff(51);
  const violations = enforceThresholds(
    configuredDiff,
    {
      limits: { global: { cpu_instructions: 50 }, functions: { run: { memory_bytes: 100 } } },
      thresholds: {
        global: { fail_on_any_regression: true },
        functions: { run: { cpu_instructions: 'ignore', events_count: 5 } },
      },
    },
    { mode: 'trusted', path: 'ci/weighin.toml', revision: 'base', content_sha256: 'def456' },
  );
  assert.equal(violations.length, 4);
  assert.equal(configuredDiff.policy.status, 'configured');
  assert.equal(configuredDiff.policy.evaluation_mode, 'enforced');
  assert.equal(configuredDiff.policy.functions[0].metrics.cpu_instructions.regression_rule, 'ignore');
  assert.equal(configuredDiff.policy.functions[0].metrics.cpu_instructions.regression_rule_source, 'function');
  assert.equal(configuredDiff.policy.functions[0].metrics.cpu_instructions.absolute_limit, 50);
  assert.equal(configuredDiff.policy.functions[0].metrics.cpu_instructions.absolute_limit_source, 'global');
  assert.equal(configuredDiff.policy.functions[0].metrics.memory_bytes.regression_rule, 'fail_on_any_regression');
  assert.equal(configuredDiff.policy.functions[0].metrics.memory_bytes.regression_rule_source, 'global');
  assert.equal(configuredDiff.policy.functions[0].metrics.memory_bytes.absolute_limit, 100);
  assert.equal(configuredDiff.policy.functions[0].metrics.memory_bytes.absolute_limit_source, 'function');
  assert.equal(configuredDiff.policy.functions[0].metrics.events_count.regression_rule, 'allow_5_percent_increase');
  assert.equal(configuredDiff.policy.functions[0].metrics.events_count.regression_rule_source, 'function');

  const md = renderComment(configuredDiff, violations, 'base', 'head');
  assert.match(md, /### Effective Policy/);
  assert.match(md, /Policy status\*\*: `configured` \(evaluation mode: `enforced`\)/);
  assert.match(md, /Policy source\*\*: mode `trusted`, path `ci\/weighin\.toml` at `base`, SHA256 `def456` \(present\)/);
  assert.match(md, /\| `cpu_instructions` \| `ignore` \| `function` \| `50` \| `global` \| `enforced` \|/);
});
