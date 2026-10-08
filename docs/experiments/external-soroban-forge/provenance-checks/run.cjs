// Live measurement of two equivalent-source artifacts; captures IO without substitution.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const { runMeasurement } = require(path.join(root, 'dist/measurement'));
const { diffBenchmarks } = require(path.join(root, 'dist/diff'));
const hash = data => createHash('sha256').update(data).digest('hex');
const write = (file, value) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify(value, null, 2) + '\n');
async function main() {
  const results = {};
  for (const [name, artifact] of [
    ['original', process.env.WEIGHIN_ORIGINAL_ARTIFACT],
    ['isolated', path.join(__dirname, '../completed/control/base.wasm')]
  ]) {
    assert.ok(artifact && fs.existsSync(artifact));
    const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../integration/weighin-fixtures.json')));
    fixtures.contracts[0].wasm_path = artifact;
    const file = path.join(__dirname, `${name}-fixtures.json`); fs.writeFileSync(file, JSON.stringify(fixtures, null, 2));
    results[name] = await runMeasurement({ fixturesPath: file, fixtureId: 'weighin-fixtures.json',
      gitCommit: '07d7935234e9c86816116471121998b871b68439', sdkVersion: '28.0.0',
      rpcUrl: 'http://localhost:18000/rpc', keyFile: process.env.WEIGHIN_PROVENANCE_KEY_FILE });
    write(`${name}-results.json`, results[name]);
  }
  const diff = diffBenchmarks(results.original, results.isolated); write('diff.json', diff);
  assert.equal(diff.contracts.length, 1); assert.equal(diff.contracts[0].functions.length, 1);
  const fn = diff.contracts[0].functions[0];
  const native = JSON.parse(fs.readFileSync(path.join(__dirname, 'native.json')));
  const returns = [];
  for (const side of ['base', 'head']) {
    const row = native.find(row => row.output && hash(JSON.stringify(row.input)) === fn[`${side}_provenance`].input_sha256);
    assert.ok(row); returns.push(row.output.retval_xdr);
  }
  assert.equal(returns[0], returns[1]);
  const measured = fn.metrics.filter(metric => metric.availability === 'comparable'); assert.equal(measured.length, 8);
  write('verification.json', { status: 'VERIFIED', same_return_xdr: true,
    different_wasm_hashes: results.original[0].benchmarks[0].wasm_sha256 !== results.isolated[0].benchmarks[0].wasm_sha256,
    measured_resources_identical: measured.every(metric => metric.delta === 0),
    metrics: measured.map(metric => ({ key: metric.key, original: metric.base.consumed, isolated: metric.head.consumed, delta: metric.delta })),
    github_hosted_execution: false, compute_environment_matched: true });
  console.log(fs.readFileSync(path.join(__dirname, 'verification.json'), 'utf8'));
}
main().catch(error => { write('failure.json', { message: error.message, stack: error.stack }); console.error(error); process.exitCode = 1; });
