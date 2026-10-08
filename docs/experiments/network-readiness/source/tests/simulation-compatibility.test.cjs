const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Account, Keypair, rpc, xdr } = require('@stellar/stellar-sdk');
const { runMeasurement } = require('../dist/measurement');
const base = require('./fixtures/stage1b/base-simulation.json');
const head = require('./fixtures/stage1b/head-simulation.json');
const control = require('./fixtures/stage1b/control-simulation.json');
const leeway = require('./fixtures/stage1b/base-leeway.json');

test('the live unchanged control has identical transaction resource fields', () => {
  assert.deepEqual(control.parsed.resources, base.parsed.resources);
});

test('the same live invocation has a different instruction budget when leeway changes', () => {
  assert.equal(leeway.request.params.transaction, base.request.params.transaction);
  assert.equal(leeway.request.params.resourceConfig.instructionLeeway, 5000000);
  const initial = rpc.parseRawSimulation(base.raw.result).transactionData.build().resources();
  const adjusted = rpc.parseRawSimulation(leeway.raw.result).transactionData.build().resources();
  assert.equal(initial.instructions(), 320219);
  assert.equal(adjusted.instructions(), 5270219);
  assert.equal(adjusted.writeBytes(), initial.writeBytes());
  assert.equal(leeway.raw.result.cost, undefined);
});

for (const [revision, capture] of [['base', base], ['head', head]]) {
  test(`${revision}: captured successful RPC response survives SDK parsing without compute consumption`, () => {
    const parsed = rpc.parseRawSimulation(capture.raw.result);
    assert.equal(rpc.Api.isSimulationSuccess(parsed), true);
    assert.deepEqual(Object.keys(parsed), capture.parsed.keys);
    assert.equal(parsed.transactionData.build().toXDR('base64'), capture.raw.result.transactionData);
    assert.equal(parsed.cost, undefined);
    assert.equal(capture.raw.result.cost, undefined);
    const resources = parsed.transactionData.build().resources();
    assert.ok(resources.instructions() > 0, 'A submission budget exists even though consumption is absent');
    assert.equal(resources.memoryBytes, undefined);
    assert.deepEqual(parsed.events.map(e => e.event().type().name), ['diagnostic', 'diagnostic']);
  });
}

test('captured raw and SDK parsed IO resource values agree exactly', () => {
  for (const capture of [base, head]) {
    const rawResources = xdr.SorobanTransactionData.fromXDR(capture.raw.result.transactionData, 'base64').resources();
    const sdkResources = rpc.parseRawSimulation(capture.raw.result).transactionData.build().resources();
    for (const method of ['instructions', 'diskReadBytes', 'writeBytes']) {
      assert.equal(sdkResources[method](), rawResources[method]());
    }
    assert.equal(sdkResources.footprint().readOnly().length, rawResources.footprint().readOnly().length);
    assert.equal(sdkResources.footprint().readWrite().length, rawResources.footprint().readWrite().length);
  }
});

// Replay captured responses through the public measurement entry point.
// RPC transport is isolated here; these tests do not claim a live measurement.
async function replay(t, response) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-simulation-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keypair = Keypair.random();
  fs.writeFileSync(path.join(dir, 'key'), keypair.secret(), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'contract.wasm'), Buffer.from('test-only-wasm'));
  fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify({
    contracts: [{ id: 'greeting', wasm_path: 'contract.wasm', invocations: [{ id: 'world', function_name: 'hello', args: [{ type: 'Symbol', value: 'world' }] }] }],
  }));
  // Account readiness now reads raw RPC instead of SDK getAccount, which masks errors.
  const rows = require('../docs/experiments/fixture-migration/bridge/rpc.json').flatMap(c => c.raw.result?.entries || []);
  const accountRow = rows.find(e => { try { return xdr.LedgerEntryData.fromXDR(e.xdr, 'base64').switch().name === 'account'; } catch { return false; } });
  const accountValue = xdr.LedgerEntryData.fromXDR(accountRow.xdr, 'base64');
  accountValue.account().accountId(keypair.xdrPublicKey());
  t.mock.method(globalThis, 'fetch', async (url, options) => new Response(JSON.stringify({ result: {
    latestLedger: 100, entries: [{ key: JSON.parse(options.body).params.keys[0], xdr: accountValue.toXDR('base64') }],
  } })));
  t.mock.method(rpc.Server.prototype, 'getAccount', async () => new Account(keypair.publicKey(), '1'));
  t.mock.method(rpc.Server.prototype, 'getLedgerEntries', async () => ({ entries: [{}] }));
  t.mock.method(rpc.Server.prototype, 'simulateTransaction', async () => response);
  return runMeasurement({ fixturesPath: path.join(dir, 'fixtures.json'), fixtureId: 'fixtures.json', keyFile: path.join(dir, 'key'), gitCommit: 'test-replay', sdkVersion: '25.3.1', helperPath: path.join(dir, 'missing-helper') });
}

for (const [revision, capture] of [['base', base], ['head', head]]) {
  test(`${revision}: missing native helper fails explicitly and produces no benchmark`, async t => {
    const parsed = rpc.parseRawSimulation(capture.raw.result);
    const prepare = t.mock.method(rpc.Server.prototype, 'prepareTransaction', async () => {
      throw new Error('Should not prepare another transaction after unavailable compute');
    });
    await assert.rejects(replay(t, parsed), /Simulation helper missing or not executable/);
    assert.equal(prepare.mock.callCount(), 0);
  });
}

test('a larger transaction instruction budget cannot masquerade as measured CPU', async t => {
  const parsed = rpc.parseRawSimulation(head.raw.result);
  parsed.transactionData.setResources(99999999, 12345, 54321);
  await assert.rejects(replay(t, parsed), /Simulation helper missing or not executable/);
});

test('legacy cost values are not trusted as an unverified consumption source', async t => {
  const parsed = rpc.parseRawSimulation(base.raw.result);
  parsed.cost = { cpuInsns: '1234', memBytes: '5678' };
  await assert.rejects(replay(t, parsed), /Simulation helper missing or not executable/);
});

test('simulation errors retain their original failure reason', async t => {
  await assert.rejects(replay(t, { _parsed: true, latestLedger: 1, events: [], error: 'HostError(Budget, LimitExceeded)' }), /Simulation failed for hello: HostError\(Budget, LimitExceeded\)/);
});

test('a response without transaction data fails before attempting metric extraction', async t => {
  await assert.rejects(replay(t, { _parsed: true, latestLedger: 1, events: [] }), /Simulation did not return transaction data for hello/);
});
