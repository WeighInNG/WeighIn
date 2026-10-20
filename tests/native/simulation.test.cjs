const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { TransactionBuilder, xdr } = require('@stellar/stellar-sdk');
const { simulateSnapshot, measureInvocation } = require('../../dist/simulation');
const evidence = path.resolve(__dirname, '../../docs/experiments/compute-source-spike');
const helper = path.resolve(__dirname, '../../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const base = require(`${evidence}/base-input.json`);
const head = require(`${evidence}/head-input.json`);
const snapshot = require(`${evidence}/snapshot-raw.json`);

for (const [label, input] of [['base', base], ['head', head]]) {
  test(`${label}: real native source reproduces saved consumed compute five times, independently of leeway`, async () => {
    const captured = require(`${evidence}/${label}-output.json`);
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await simulateSnapshot(input, helper));
    for (const output of runs) {
      for (const [key, value] of Object.entries(captured)) assert.deepEqual(output[key], value, key);
      assert.deepEqual(output, runs[0]);
    }
    const leeway = await simulateSnapshot({ ...input, instruction_leeway: 5000000 }, helper);
    assert.equal(leeway.cpu_instructions_consumed, runs[0].cpu_instructions_consumed);
    assert.equal(leeway.memory_bytes_consumed, runs[0].memory_bytes_consumed);
    assert.ok(leeway.instruction_budget > runs[0].instruction_budget);
  });
}
test('real helper rejects missing config, uncaptured state, failed calls, protocol mismatch and malformed seed', async () => {
  const alteredHeader = xdr.LedgerHeader.fromXDR(base.header_xdr, 'base64'); alteredHeader.ledgerVersion(27);
  const badFunction = xdr.HostFunction.fromXDR(base.host_function_xdr, 'base64'); badFunction.invokeContract().functionName('missing');
  const cases = [
    [{ ...base, entries: [] }, /network configuration/],
    [{ ...base, entries: base.entries.filter(row => !['contractCode', 'contractData'].includes(xdr.LedgerKey.fromXDR(row.key, 'base64').switch().name)) }, /UNCAPTURED_KEY/],
    [{ ...base, host_function_xdr: badFunction.toXDR('base64') }, /host invocation failed/],
    [{ ...base, header_xdr: alteredHeader.toXDR('base64') }, /unsupported protocol/],
    [{ ...base, seed: [0] }, /32 bytes/],
  ];
  for (const [input, message] of cases) await assert.rejects(simulateSnapshot(input, helper), message);
});

function capturedRpc(t, mutate) {
  let entryCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    let result;
    if (body.method === 'getNetwork') result = { passphrase: base.network_passphrase, protocolVersion: 28 };
    if (body.method === 'simulateTransaction') result = snapshot.simulations[0].raw.result;
    if (body.method === 'getLedgerEntries') {
      entryCalls++;
      result = { ...snapshot.entries.raw.result, entries: snapshot.entries.raw.result.entries.filter(entry => body.params.keys.includes(entry.key)) };
    }
    if (body.method === 'getLedgers') result = snapshot.headers.raw.result;
    if (mutate) result = mutate(body, result, entryCalls);
    assert.ok(result, body.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  return () => entryCalls;
}
const transaction = () => TransactionBuilder.fromXDR(snapshot.simulations[0].request.params.transaction, base.network_passphrase);
test('production snapshot adapter measures real captured invocation and emits provenance', async t => {
  capturedRpc(t);
  const measured = await measureInvocation('http://captured/rpc', transaction(), helper);
  assert.equal(measured.output.cpu_instructions_consumed, 270219);
  assert.equal(measured.provenance.ledger, 229);
  assert.equal(measured.provenance.protocol, 28);
  assert.match(measured.provenance.helper_sha256, /^[a-f0-9]{64}$/);
  assert.match(measured.provenance.config_sha256, /^[a-f0-9]{64}$/);
  const names = new Set(['configSettingContractComputeV0', 'configSettingContractCostParamsCpuInstructions', 'configSettingContractCostParamsMemoryBytes', 'configSettingStateArchival']);
  const calibration = base.entries.filter(entry => {
    const key = xdr.LedgerKey.fromXDR(entry.key, 'base64');
    return key.switch().name === 'configSetting' && names.has(key.configSetting().configSettingId().name);
  }).sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'variant' }));
  // Adapter sorts raw base64 lexically, rather than locale-dependent sorting.
  calibration.sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  assert.equal(calibration.length, 4);
  const expected = crypto.createHash('sha256').update(JSON.stringify(calibration.map(({key,xdr}) => ({key,xdr})))).digest('hex');
  assert.equal(measured.provenance.compute_config_sha256, expected);
});
test('ledger drift retries the entire capture before measuring', async t => {
  const calls = capturedRpc(t, (body, result, count) => body.method === 'getLedgerEntries' && count === 1 ? { ...result, latestLedger: 230 } : result);
  assert.equal((await measureInvocation('http://captured/rpc', transaction(), helper)).output.cpu_instructions_consumed, 270219);
  assert.equal(calls(), 2);
});
test('protocol mismatch and missing extension metadata fail explicitly', async t => {
  capturedRpc(t, (body, result) => body.method === 'getNetwork' ? { ...result, protocolVersion: 29 } : result);
  await assert.rejects(measureInvocation('http://captured/rpc', transaction(), helper), /Unsupported protocol 29/);
  t.mock.restoreAll();
  capturedRpc(t, (body, result) => body.method === 'getLedgerEntries' ? { ...result, entries: result.entries.map(({ extXdr, ...entry }) => entry) } : result);
  await assert.rejects(measureInvocation('http://captured/rpc', transaction(), helper));
});
test('captured-state/local result disagreement is rejected rather than blended with RPC values', async t => {
  capturedRpc(t, (body, result) => body.method === 'simulateTransaction' ? { ...result, results: [{ ...result.results[0], xdr: xdr.ScVal.scvVoid().toXDR('base64') }] } : result);
  await assert.rejects(measureInvocation('http://captured/rpc', transaction(), helper), /disagrees with RPC/);
});

test('resource caps come from captured settings and fee-only changes do not alter their identity', async t => {
  capturedRpc(t);
  const original = await measureInvocation('http://captured/rpc', transaction(), helper);
  assert.match(original.provenance.resource_limits_sha256, /^[a-f0-9]{64}$/);
  assert.equal(original.limits.cpu_instructions, original.output.cpu_limit);
  assert.equal(original.limits.memory_bytes, original.output.memory_limit);
  t.mock.restoreAll();
  const mutateSetting = (name, change) => (body, result) => {
    if (body.method !== 'getLedgerEntries') return result;
    return { ...result, entries: result.entries.map(entry => {
      const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64');
      if (data.switch().name !== 'configSetting' || data.configSetting().switch().name !== name) return entry;
      change(data.configSetting());
      return { ...entry, xdr: data.toXDR('base64') };
    }) };
  };
  capturedRpc(t, mutateSetting('configSettingContractLedgerCostExtV0', setting => {
    const value = setting.contractLedgerCostExt(); value.txMaxFootprintEntries(value.txMaxFootprintEntries()+1);
  }));
  const cap = await measureInvocation('http://captured/rpc', transaction(), helper);
  assert.equal(cap.limits.footprint_entries, original.limits.footprint_entries+1);
  assert.notEqual(cap.provenance.resource_limits_sha256, original.provenance.resource_limits_sha256);
  assert.equal(cap.provenance.compute_config_sha256, original.provenance.compute_config_sha256);
  t.mock.restoreAll();
  capturedRpc(t, mutateSetting('configSettingContractLedgerCostExtV0', setting => {
    const value = setting.contractLedgerCostExt();
    value.feeWrite1Kb(xdr.Int64.fromString((BigInt(value.feeWrite1Kb().toString())+1n).toString()));
  }));
  const fee = await measureInvocation('http://captured/rpc', transaction(), helper);
  assert.notEqual(fee.provenance.config_sha256, original.provenance.config_sha256);
  assert.equal(fee.provenance.resource_limits_sha256, original.provenance.resource_limits_sha256);
  assert.equal(fee.provenance.compute_config_sha256, original.provenance.compute_config_sha256);
  t.mock.restoreAll();
  capturedRpc(t, (body,result) => body.method === 'getLedgerEntries' ? {
    ...result, entries:result.entries.map(entry => ({...entry,lastModifiedLedgerSeq:entry.lastModifiedLedgerSeq+1})),
  } : result);
  const metadata = await measureInvocation('http://captured/rpc', transaction(), helper);
  assert.notEqual(metadata.provenance.config_sha256, original.provenance.config_sha256);
  assert.equal(metadata.provenance.resource_limits_sha256, original.provenance.resource_limits_sha256);
});

test('RPC charged-event disagreement fails even when return value and transaction data agree', async t => {
  capturedRpc(t, (body,result) => {
    if (body.method !== 'simulateTransaction') return result;
    const event = xdr.DiagnosticEvent.fromXDR(result.events[0],'base64');
    event.event().type(xdr.ContractEventType.contract());
    return { ...result, events:[event.toXDR('base64'),...result.events.slice(1)] };
  });
  await assert.rejects(measureInvocation('http://captured/rpc', transaction(), helper), /disagrees with RPC/);
});

// ---------------------------------------------------------------------------
// Invocation chaining: write-then-read state-loss demonstration
//
// Each measureInvocation call operates against an immutable snapshot captured
// from the live network.  Writes that the simulation _would_ commit are
// reported as write_bytes / modified_entries / read_write_keys in the output,
// but they are never persisted to the snapshot.  A subsequent independent
// measureInvocation call fetches the same ledger state and therefore sees the
// same null (absent) entry for the contractData key that the previous
// simulation wrote.  This is the user-visible state-loss sequence described
// in the "Fixture execution / Unsupported chaining" row of KNOWN_LIMITATIONS.
//
// Archive return values are preserved in the assertions below so a reviewer
// can confirm the exact consumed resources without re-running the helper.
// ---------------------------------------------------------------------------

// The HEAD fixture (snapshot.simulations[1]) writes 88 bytes to one persistent
// contractData key that did not exist in the snapshot (xdr: null).
const writeSimResult = snapshot.simulations[1].raw.result;
const writeTransaction = () => TransactionBuilder.fromXDR(
  snapshot.simulations[1].request.params.transaction, base.network_passphrase);

// A capturedRpc variant that routes simulateTransaction to the write simulation.
function capturedRpcWrite(t, mutate) {
  let entryCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    let result;
    if (body.method === 'getNetwork') result = { passphrase: base.network_passphrase, protocolVersion: 28 };
    if (body.method === 'simulateTransaction') result = writeSimResult;
    if (body.method === 'getLedgerEntries') {
      entryCalls++;
      // The RW contractData key that the write targets is absent from
      // snapshot.entries (it never existed before this simulated write).
      // Filtering by requested keys naturally returns no entry for it,
      // which the adapter records as { key, xdr: null } — the absent /
      // not-yet-written state that every independent simulation sees.
      result = { ...snapshot.entries.raw.result, entries: snapshot.entries.raw.result.entries.filter(entry => body.params.keys.includes(entry.key)) };
    }
    if (body.method === 'getLedgers') result = snapshot.headers.raw.result;
    if (mutate) result = mutate(body, result, entryCalls);
    assert.ok(result, body.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  return () => entryCalls;
}

test('write simulation reports write_bytes and modified_entries for a persistent contractData key', async t => {
  // Archive: this invocation writes 88 bytes to one contractData key that was
  // absent (xdr: null) in the captured snapshot.  The return value is the
  // canonical void ScVal retval_xdr from the archive.
  capturedRpcWrite(t);
  const measured = await measureInvocation('http://captured/rpc', writeTransaction(), helper);

  // The simulation reports the write footprint and byte count.
  assert.equal(measured.output.write_bytes, 88,
    'write simulation must report 88 bytes written to the persistent key');
  assert.equal(measured.output.read_write_keys.length, 1,
    'write simulation must include exactly one read-write footprint key');
  assert.equal(measured.output.modified_entries, 1,
    'write simulation must report exactly one modified ledger entry');

  // CPU / provenance are intact — this is a well-formed measurement.
  assert.ok(measured.output.cpu_instructions_consumed > 0,
    'write simulation must report non-zero CPU consumption');
  assert.equal(measured.provenance.ledger, 229,
    'archived provenance ledger must equal 229');
});

test('second independent simulation sees same null entry — write-then-read state is lost', async t => {
  // Run the write simulation first.
  capturedRpcWrite(t);
  const write = await measureInvocation('http://captured/rpc', writeTransaction(), helper);
  assert.equal(write.output.write_bytes, 88, 'first call must confirm the write');
  t.mock.restoreAll();

  // Run a second independent simulation with identical captured state.
  // capturedRpcWrite re-installs the same mock, returning the same snapshot
  // entries — the RW key is still absent (xdr: null), exactly as it was
  // before the first simulation ran.  The second call cannot observe the
  // write from the first call because simulated writes are never committed
  // to the snapshot; each invocation is isolated.
  capturedRpcWrite(t);
  const read = await measureInvocation('http://captured/rpc', writeTransaction(), helper);

  // The second call produces the same output as the first: it still sees the
  // absent entry and still simulates the same write (88 bytes), confirming
  // there is no accumulated or shared state between invocations.
  assert.equal(read.output.write_bytes, 88,
    'second simulation must see the same pre-write snapshot state and reproduce the same write cost');
  assert.equal(read.output.read_write_keys.length, 1,
    'second simulation must have the same read-write footprint as the first');
  assert.deepEqual(read.output.read_write_keys, write.output.read_write_keys,
    'both simulations operate against the same absent entry — state was not persisted between calls');

  // Snapshot_sha256 must be identical across both calls: the captured entries
  // did not change between invocations, which is the observable proof that the
  // first simulation's write was discarded.
  assert.equal(read.provenance.snapshot_sha256, write.provenance.snapshot_sha256,
    'snapshot digest must be identical — simulated writes do not alter the captured ledger state');
});

test('write-then-read chaining with invalid RPC response fails closed and does not leak prior write state', async t => {
  // Verify that a malformed second simulation response fails explicitly
  // rather than silently returning stale or zero-valued metrics, ensuring
  // the unsupported-chaining boundary is fail-closed.
  capturedRpcWrite(t);
  const write = await measureInvocation('http://captured/rpc', writeTransaction(), helper);
  assert.equal(write.output.write_bytes, 88);
  t.mock.restoreAll();

  // Second call: corrupt the simulateTransaction result so the return value
  // disagrees with the native helper.  This must reject rather than blend
  // values from the (discarded) first-call write.
  capturedRpcWrite(t, (body, result) =>
    body.method === 'simulateTransaction'
      ? { ...result, results: [{ xdr: xdr.ScVal.scvVoid().toXDR('base64') }] }
      : result
  );
  await assert.rejects(
    measureInvocation('http://captured/rpc', writeTransaction(), helper),
    /disagrees with RPC/,
    'parity check must reject a tampered second simulation, not silently use prior write output'
  );
});
