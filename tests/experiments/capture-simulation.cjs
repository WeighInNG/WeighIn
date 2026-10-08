// Explicit live experiment, excluded from npm test. Requires built dist/ and
// two already-built temporary contract fixtures plus a local Stellar network.
// No secret material is written to the evidence directory.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { rpc, scValToNative } = require('@stellar/stellar-sdk');
const { runMeasurement } = require('../../dist/measurement');
const [baseFixtures, headFixtures, outputDir, keyFile] = process.argv.slice(2);
if (!baseFixtures || !headFixtures || !outputDir || !keyFile) {
  throw new Error('Usage: node tests/experiments/capture-simulation.cjs BASE_FIXTURES HEAD_FIXTURES OUTPUT_DIR KEY_FILE');
}
const rpcUrl = process.env.WEIGHIN_EXPERIMENT_RPC_URL || 'http://localhost:18000/rpc';
fs.mkdirSync(outputDir, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
let nextId = 0;
async function request(method, params) {
  const body = { jsonrpc: '2.0', id: ++nextId, method, ...(params && { params }) };
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const raw = await response.json();
  if (!response.ok || raw.error) throw new Error(JSON.stringify(raw));
  return { request: body, raw };
}
function describe(parsed) {
  const resources = parsed.transactionData?.build().resources();
  return {
    keys: Object.keys(parsed), latestLedger: parsed.latestLedger,
    transactionData: parsed.transactionData?.build().toXDR('base64'),
    // Explicitly budgets / IO fields, never presented as consumed compute.
    resources: resources && { instruction_budget: resources.instructions(), disk_read_bytes: resources.diskReadBytes(), write_bytes: resources.writeBytes(), read_only_entries: resources.footprint().readOnly().length, read_write_entries: resources.footprint().readWrite().length },
    events: parsed.events.map(event => ({ success: event.inSuccessfulContractCall(), type: event.event().type().name, topics: event.event().body().v0().topics().map(scValToNative), data: scValToNative(event.event().body().v0().data()) })),
  };
}
async function main() {
  write('environment.json', {
    image: 'stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5',
    rpcUrl, network: (await request('getNetwork')).raw.result, version: (await request('getVersionInfo')).raw.result,
    node: process.version, javascript_sdk: JSON.parse(fs.readFileSync(path.join(__dirname, '../../node_modules/@stellar/stellar-sdk/package.json'), 'utf8')).version,
  });
  const originalSimulate = rpc.Server.prototype.simulateTransaction;
  let revision, captures;
  rpc.Server.prototype.simulateTransaction = async function (tx, leeway, authMode) {
    const captured = await request('simulateTransaction', { transaction: tx.toXDR(), ...(leeway && { resourceConfig: { instructionLeeway: leeway.cpuInstructions } }), ...(authMode && { authMode }) });
    const parsed = rpc.parseRawSimulation(captured.raw.result);
    captured.parsed = describe(parsed);
    captures.push(captured);
    write(`${revision}-simulation-${captures.length}.json`, captured);
    return parsed;
  };
  const runs = [];
  try {
    for (const [label, fixturesPath] of [['base', baseFixtures], ['control', baseFixtures], ['head', headFixtures]]) {
      revision = label;
      captures = [];
      const logs = [];
      const log = console.log;
      console.log = (...args) => { logs.push(args.map(String).join(' ')); log(...args); };
      let error;
      try {
        await runMeasurement({ fixturesPath, fixtureId: 'weighin-fixtures.json', keyFile, rpcUrl, gitCommit: label === 'head' ? 'temporary persistent-write experiment' : 'working-tree snapshot', sdkVersion: '25.3.1' });
      } catch (failure) { error = failure.message; }
      finally { console.log = log; }
      assert.match(error || '', /CPU and memory consumption unavailable/);
      const invocation = captures.at(-1);
      assert.ok(invocation.raw.result.results?.length);
      const contract = logs.find(line => line.startsWith('Contract ID: ')).slice('Contract ID: '.length);
      const wasm = logs.find(line => line.startsWith('WASM SHA256: ')).slice('WASM SHA256: '.length);
      const leeway = await request('simulateTransaction', { ...invocation.request.params, resourceConfig: { instructionLeeway: 5000000 } });
      leeway.parsed = describe(rpc.parseRawSimulation(leeway.raw.result));
      write(`${label}-leeway.json`, leeway);
      assert.ok(leeway.parsed.resources.instruction_budget > invocation.parsed.resources.instruction_budget);
      runs.push({ label, wasm_sha256: wasm, contract_id: contract, error, resources: invocation.parsed.resources, increased_leeway_instruction_budget: leeway.parsed.resources.instruction_budget });
    }
  } finally { rpc.Server.prototype.simulateTransaction = originalSimulate; }
  assert.equal(runs[0].wasm_sha256, runs[1].wasm_sha256);
  assert.equal(runs[0].contract_id, runs[1].contract_id);
  assert.deepEqual(runs[0].resources, runs[1].resources);
  assert.notEqual(runs[0].wasm_sha256, runs[2].wasm_sha256);
  assert.notEqual(runs[0].contract_id, runs[2].contract_id);
  assert.ok(runs[2].resources.read_write_entries > runs[0].resources.read_write_entries);
  assert.ok(runs[2].resources.write_bytes > runs[0].resources.write_bytes);
  const result = { status: 'BLOCKED', assertions: 'PASS: live responses captured, unchanged IO/budget control, changed WASM/address, increased IO, leeway affects budget, explicit unsupported compute error', measured_cpu_memory_comparison: false, threshold_proof: false, runs };
  write('experiment.json', result);
  console.log(JSON.stringify(result, null, 2));
  // The diagnostic assertions pass, but the requested full regression proof is blocked.
  process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
