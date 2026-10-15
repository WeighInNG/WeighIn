const test = require('node:test');
const assert = require('node:assert/strict');
const { CONDITIONS, METRIC_KEYS, analyzeDeploymentConditions } = require('./experiments/deployment-condition-analysis.cjs');

function sample(condition, index, overrides = {}) {
  const metrics = Object.fromEntries(METRIC_KEYS.map((key, metricIndex) => [key,
    ['historical_data_read_bytes', 'contract_data_hard_limit', 'tx_size_bytes'].includes(key)
      ? { availability: 'unavailable', consumed: null, limit: null, reason: 'not exposed by this measurement' }
      : { availability: 'measured', consumed: metricIndex + index, limit: 1000 },
  ]));
  return {
    sample_id: `${condition}-${index}`,
    condition,
    logical_id: 'hello-world',
    wasm_sha256: 'a'.repeat(64),
    invocation_fingerprint: 'b'.repeat(64),
    calibration_fingerprint: 'c'.repeat(64),
    deployer_public_key: 'G'.repeat(56),
    deployment_salt: (index.toString(16).padStart(2, '0') + 'd'.repeat(62)).slice(0, 64),
    contract_id: `C${condition}${index}`,
    setup_receipt_hash: 'e'.repeat(64),
    ledger_snapshot: 100 + index,
    ...CONDITIONS[condition],
    benchmarks: [{ function_name: 'hello', case_id: 'hello-world', args_fingerprint: 'b'.repeat(64), wasm_sha256: 'a'.repeat(64), metrics }],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const samples = Object.keys(CONDITIONS).flatMap(condition => Array.from({ length: 5 }, (_, index) => sample(condition, index + 1)));
  return { schema_version: 1, samples, ...overrides };
}

test('accepts five samples for each controlled condition', () => {
  const result = analyzeDeploymentConditions(evidence());
  assert.equal(result.status, 'VALID_DEPLOYMENT_CONDITION_EVIDENCE');
  assert.equal(result.conditions.cold_code.completed_samples, 5);
  assert.equal(result.conditions.uploaded_code.completed_samples, 5);
  assert.equal(result.conditions.reused_instance.completed_samples, 5);
});

test('rejects a mislabeled condition', () => {
  const value = evidence();
  value.samples[0].instance_preexisted = true;
  assert.throws(() => analyzeDeploymentConditions(value), /mislabeled/);
});

test('rejects changed WASM, calibration, or invocation identity', () => {
  for (const field of ['wasm_sha256', 'calibration_fingerprint', 'invocation_fingerprint']) {
    const value = evidence();
    value.samples[0][field] = 'f'.repeat(64);
    assert.throws(() => analyzeDeploymentConditions(value), /changed/);
  }
});

test('rejects missing samples and duplicate sample IDs', () => {
  const missing = evidence();
  missing.samples = missing.samples.filter(sample => sample.condition !== 'cold_code' || sample.sample_id !== 'cold_code-1');
  assert.throws(() => analyzeDeploymentConditions(missing), /requires at least five/);
  const duplicate = evidence();
  duplicate.samples[1].sample_id = duplicate.samples[0].sample_id;
  assert.throws(() => analyzeDeploymentConditions(duplicate), /duplicate sample_id/);
});
