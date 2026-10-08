// Verify retained real optimizer/build/RPC evidence; no substituted measurements.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { xdr } = require('@stellar/stellar-sdk');
const dir = path.resolve(process.argv[2] || 'docs/experiments/optimizer-repeatability');
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const healthy = '103874c717632bb9b51d3ff6effc9869433fcbdf8e3c719c927eb7b6aa14f398';
const constrained = 'f6edc17c367984295ce7007e4099d45982d84f5fdbffae899492d0e6c547c953';
for (const [file, expected] of [['temp-results.json', null], ['build-results.json', healthy], ['system-build-results.json', constrained]]) {
  const rows = read(file);
  const groups = new Map();
  for (const row of rows) { assert.equal(row.exit, 0); const key = row.mode; groups.set(key, [...(groups.get(key) || []), row]); }
  for (const [mode, rows] of groups) { assert.equal(rows.length, 5); for (const row of rows) assert.equal(row.sha256, expected || (mode === 'system-temp' ? constrained : healthy)); }
}
const native = read('live/native.json'), rpc = read('live/rpc.json'), returns = [];
let referenceEnvironment;
for (const [mode, expected, cpu] of [['system-temp', constrained, 565373], ['workspace-temp', healthy, 565371]]) {
  assert.equal(hash(fs.readFileSync(path.join(dir, `${mode}.wasm`))), expected);
  let metrics;
  for (let i = 1; i <= 5; i++) {
    const result = read(`live/${mode}-${i}-results.json`), benchmark = result[0].benchmarks[0];
    assert.equal(benchmark.wasm_sha256, expected);
    assert.equal(benchmark.metrics.cpu_instructions.consumed, cpu);
    const values = Object.fromEntries(Object.entries(benchmark.metrics).filter(([, m]) => m.availability === 'measured').map(([key, m]) => [key, m.consumed]));
    if (metrics) assert.deepEqual(values, metrics); else metrics = values;
    const p = benchmark.measurement_provenance || benchmark.provenance;
    assert.ok(p, 'Measurement provenance is required');
    const environment = Object.fromEntries(['source_version', 'protocol', 'helper_sha256', 'network_id', 'config_sha256', 'resource_limits_sha256', 'compute_config_sha256', 'seed', 'auth_mode', 'host_features'].map(key => [key, p[key]]));
    if (referenceEnvironment) assert.deepEqual(environment, referenceEnvironment); else referenceEnvironment = environment;
    assert.equal(Object.keys(values).length, 8);
    const unavailable = Object.values(benchmark.metrics).filter(m => m.availability === 'unavailable');
    assert.equal(unavailable.length, 3);
    for (const metric of unavailable) { assert.equal(metric.consumed, null); assert.ok(metric.reason); }
    const sample = native.find(row => row.output && hash(JSON.stringify(row.input)) === p.input_sha256);
    assert.ok(sample); assert.equal(sample.output.cpu_instructions_consumed, cpu);
    assert.ok(rpc.some(call => call.request.method === 'simulateTransaction' && call.raw.result?.latestLedger === p.ledger && call.raw.result?.transactionData === sample.output.transaction_data_xdr && call.raw.result?.results?.[0]?.xdr === sample.output.retval_xdr));
    assert.ok(sample.input.entries.some(entry => { if (!entry.xdr) return false; const e = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64'); return e.switch().name === 'contractCode' && hash(e.contractCode().code()) === expected; }));
    returns.push(sample.output.retval_xdr);
  }
}
assert.equal(new Set(returns).size, 1, 'All fixture return values must match');
const summary = read('live/verification.json'); assert.equal(summary.status, 'VERIFIED');
assert.equal(summary.cross_mode_cpu_delta, -2);
for (const [file, expected] of Object.entries(read('sha256.json'))) assert.equal(hash(fs.readFileSync(path.join(dir, file))), expected, file);
console.log('VERIFIED: five builds and five live runs per storage mode; deployed WASM, CPU, raw RPC/native parity, identical returns, and all artifact hashes.');
