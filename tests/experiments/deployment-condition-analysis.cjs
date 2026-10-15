// Validation and aggregation for the issue #55 deployment-condition experiment.
// This module never creates or substitutes measurements; it only validates
// evidence captured by a real setup and measurement run.
const METRIC_KEYS = [
  'cpu_instructions',
  'memory_bytes',
  'ledger_read_entries',
  'ledger_read_bytes',
  'ledger_write_entries',
  'ledger_write_bytes',
  'historical_data_read_bytes',
  'contract_data_hard_limit',
  'tx_size_bytes',
  'events_count',
  'event_data_bytes',
];

const CONDITIONS = {
  cold_code: { wasm_uploaded_before_measurement: false, instance_preexisted: false },
  uploaded_code: { wasm_uploaded_before_measurement: true, instance_preexisted: false },
  reused_instance: { wasm_uploaded_before_measurement: true, instance_preexisted: true },
};

function fail(message) {
  throw new Error(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is required`);
  return value;
}

function validateMetric(metric, label) {
  if (!metric || !['measured', 'unavailable'].includes(metric.availability)) {
    fail(`${label} must declare measured or unavailable availability`);
  }
  if (metric.availability === 'unavailable') {
    if (metric.consumed !== null || metric.limit !== null || typeof metric.reason !== 'string') {
      fail(`${label} unavailable metric must include null values and a reason`);
    }
  } else if (!Number.isFinite(metric.consumed) || metric.consumed < 0) {
    fail(`${label} measured metric must include a non-negative numeric consumed value`);
  }
}

function validateSample(sample, expected) {
  requireString(sample.sample_id, 'sample_id');
  requireString(sample.logical_id, 'logical_id');
  requireString(sample.wasm_sha256, 'wasm_sha256');
  requireString(sample.invocation_fingerprint, 'invocation_fingerprint');
  requireString(sample.calibration_fingerprint, 'calibration_fingerprint');
  requireString(sample.deployer_public_key, 'deployer_public_key');
  requireString(sample.deployment_salt, 'deployment_salt');
  requireString(sample.contract_id, 'contract_id');
  if (!/^[0-9a-fA-F]{64}$/.test(sample.deployment_salt)) fail(`invalid deployment salt for ${sample.sample_id}`);
  if (typeof sample.setup_receipt_hash !== 'string' || sample.setup_receipt_hash.length === 0) {
    fail(`setup receipt is required for ${sample.sample_id}`);
  }
  if (!Number.isInteger(sample.ledger_snapshot) || sample.ledger_snapshot < 0) {
    fail(`ledger snapshot is required for ${sample.sample_id}`);
  }
  const expectedFlags = CONDITIONS[expected];
  if (!expectedFlags) fail(`unknown deployment condition: ${expected}`);
  for (const [key, value] of Object.entries(expectedFlags)) {
    if (sample[key] !== value) fail(`${sample.sample_id} is mislabeled as ${expected}: ${key}=${sample[key]}`);
  }
  if (!Array.isArray(sample.benchmarks) || sample.benchmarks.length === 0) {
    fail(`${sample.sample_id} has no benchmark measurements`);
  }
  const benchmarkIds = new Set();
  for (const benchmark of sample.benchmarks) {
    requireString(benchmark.function_name, 'benchmark.function_name');
    requireString(benchmark.case_id, 'benchmark.case_id');
    if (benchmark.args_fingerprint !== sample.invocation_fingerprint) {
      fail(`${sample.sample_id} changed invocation arguments`);
    }
    if (benchmark.wasm_sha256 !== sample.wasm_sha256) fail(`${sample.sample_id} changed WASM`);
    if (benchmarkIds.has(benchmark.case_id)) fail(`duplicate benchmark ${benchmark.case_id} in ${sample.sample_id}`);
    benchmarkIds.add(benchmark.case_id);
    for (const key of METRIC_KEYS) validateMetric(benchmark.metrics?.[key], `${sample.sample_id}.${key}`);
  }
  return { ...sample, benchmarkIds };
}

function aggregate(samples) {
  const identities = new Set(samples.flatMap(sample => [...sample.benchmarkIds]));
  if (identities.size === 0) fail('no benchmark identities');
  return [...identities].sort().map(identity => {
    const benchmarks = samples.map(sample => sample.benchmarks.find(item => item.case_id === identity));
    if (benchmarks.some(item => !item)) fail(`missing sample for benchmark ${identity}`);
    const metrics = Object.fromEntries(METRIC_KEYS.map(key => {
      const values = benchmarks.map(item => item.metrics[key]);
      const unavailable = values.filter(item => item.availability === 'unavailable');
      if (unavailable.length === values.length) {
        return [key, { availability: 'unavailable', values: values.map(() => null), reason: values[0].reason }];
      }
      if (unavailable.length > 0) fail(`metric availability changed: ${identity}.${key}`);
      const numbers = values.map(item => item.consumed);
      const min = Math.min(...numbers), max = Math.max(...numbers);
      const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      const standardDeviation = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length);
      return [key, { availability: 'measured', values: numbers, min, max, range: max - min, mean,
        population_standard_deviation: standardDeviation, stable: min === max }];
    }));
    return { identity, wasm_hashes: [...new Set(benchmarks.map(item => item.wasm_sha256))], metrics };
  });
}

function analyzeDeploymentConditions(evidence) {
  if (!evidence || evidence.schema_version !== 1) fail('unsupported deployment-condition evidence schema');
  if (!Array.isArray(evidence.samples)) fail('samples must be an array');
  const byCondition = new Map(Object.keys(CONDITIONS).map(condition => [condition, []]));
  const sampleIds = new Set();
  for (const sample of evidence.samples) {
    if (!byCondition.has(sample.condition)) fail(`unknown deployment condition: ${sample.condition}`);
    if (sampleIds.has(sample.sample_id)) fail(`duplicate sample_id: ${sample.sample_id}`);
    sampleIds.add(sample.sample_id);
    byCondition.get(sample.condition).push(validateSample(sample, sample.condition));
  }
  for (const [condition, samples] of byCondition) {
    if (samples.length < 5) fail(`${condition} requires at least five completed samples`);
  }
  const all = [...byCondition.values()].flat();
  const logicalIds = new Set(all.map(sample => sample.logical_id));
  const wasmHashes = new Set(all.map(sample => sample.wasm_sha256));
  const invocationFingerprints = new Set(all.map(sample => sample.invocation_fingerprint));
  const calibrationFingerprints = new Set(all.map(sample => sample.calibration_fingerprint));
  if (logicalIds.size !== 1) fail('logical invocation identity changed between conditions');
  if (wasmHashes.size !== 1) fail('WASM artifact changed between conditions');
  if (invocationFingerprints.size !== 1) fail('invocation arguments changed between conditions');
  if (calibrationFingerprints.size !== 1) fail('calibration/configuration changed between conditions');
  return {
    status: 'VALID_DEPLOYMENT_CONDITION_EVIDENCE',
    schema_version: evidence.schema_version,
    logical_id: [...logicalIds][0],
    wasm_sha256: [...wasmHashes][0],
    invocation_fingerprint: [...invocationFingerprints][0],
    calibration_fingerprint: [...calibrationFingerprints][0],
    conditions: Object.fromEntries([...byCondition].map(([condition, samples]) => [condition, {
      completed_samples: samples.length,
      contract_ids: [...new Set(samples.map(sample => sample.contract_id))],
      deployment_salts: [...new Set(samples.map(sample => sample.deployment_salt))],
      ledgers: samples.map(sample => sample.ledger_snapshot),
      series: aggregate(samples),
    }])),
    unavailable_metrics: METRIC_KEYS.filter(key => [...byCondition.values()].some(samples =>
      samples.some(sample => sample.benchmarks.some(benchmark => benchmark.metrics[key].availability === 'unavailable')))),
  };
}

module.exports = { CONDITIONS, METRIC_KEYS, analyzeDeploymentConditions };
