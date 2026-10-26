const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { xdr } = require('@stellar/stellar-sdk');
const { simulateSnapshot, resolveSimulationHelper } = require('../dist/simulation');
const input = require('../docs/experiments/compute-source-spike/base-input.json');
const captured = require('../docs/experiments/compute-source-spike/base-output.json');
const valid = () => ({ ...captured, host_features: ['recording_mode', 'testutils'], auth_mode: 'recording(true,true)' });

function transport(t, output, failure) {
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    assert.deepEqual(args, [], 'Helper runs directly without a shell or interpolated arguments');
    const stdin = new EventEmitter(); stdin.end = data => {
      assert.deepEqual(JSON.parse(data), input);
      setImmediate(() => callback(failure, output, failure ? 'host invocation failed' : ''));
    };
    return { stdin };
  });
}
test('versioned transport accepts captured metered values and separate budget', async t => {
  transport(t, JSON.stringify(valid()));
  const output = await simulateSnapshot(input, '/test/helper');
  assert.equal(output.cpu_instructions_consumed, 270219);
  assert.equal(output.instruction_budget, 320219);
  assert.equal(output.memory_bytes_consumed, 1125761);
});
test('transport rejects missing/negative/nonfinite/string meters and unknown schema/version', async t => {
  for (const [key, value] of [['cpu_instructions_consumed', undefined], ['cpu_instructions_consumed', -1], ['memory_bytes_consumed', Infinity], ['memory_bytes_consumed', '1'], ['schema_version', 2], ['source_version', '29.0.0']]) {
    const output = valid(); output[key] = value;
    transport(t, JSON.stringify(output));
    await assert.rejects(simulateSnapshot(input, '/test/helper'), /Invalid simulation helper output/);
    t.mock.restoreAll();
  }
});
test('transport rejects malformed JSON and resource fields inconsistent with XDR', async t => {
  transport(t, '{invalid');
  await assert.rejects(simulateSnapshot(input, '/test/helper'), /Invalid simulation helper output/);
  t.mock.restoreAll();
  const output = valid(); output.instruction_budget += 1;
  transport(t, JSON.stringify(output));
  await assert.rejects(simulateSnapshot(input, '/test/helper'), /resource fields disagree/);
});
test('helper exit failures do not produce successful or zero benchmark values', async t => {
  transport(t, '', new Error('exit 1'));
  await assert.rejects(simulateSnapshot(input, '/test/helper'), /Simulation helper failed: host invocation failed/);
});
test('helper diagnostic events cannot be accepted as charged contract events', async t => {
  const rpc = require('../docs/experiments/compute-source-spike/base-rpc.json');
  const output = valid();
  output.contract_events_xdr = [xdr.DiagnosticEvent.fromXDR(rpc.raw.result.events[0], 'base64').event().toXDR('base64')];
  transport(t, JSON.stringify(output));
  await assert.rejects(simulateSnapshot(input, '/test/helper'), /diagnostic event is not a charged contract event/);
});
test('missing helper is an explicit provisioning failure', async () => {
  await assert.rejects(resolveSimulationHelper('/missing/weighin-helper'), /missing or not executable/);
});
test('absent snapshot entries without metadata are valid while present-entry metadata on absent entries is rejected', async t => {
  const { validateSnapshotEntry } = require('../dist/simulation');
  const absentKey = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(Buffer.alloc(32, 7)) })
  ).toXDR('base64');
  assert.doesNotThrow(() => validateSnapshotEntry({ key: absentKey, xdr: null }));
  for (const invalid of [
    { key: absentKey, xdr: null, extension_xdr: input.entries[0].extension_xdr },
    { key: absentKey, xdr: null, last_modified: 229 },
    { key: absentKey, xdr: null, live_until: 500 },
    { key: absentKey, xdr: null, live_until: null },
  ]) {
    assert.throws(
      () => validateSnapshotEntry(invalid),
      /Absent snapshot entry must not include extension, last-modified, or live-until metadata/
    );
  }
  const withValidAbsent = { ...input, entries: [...input.entries, { key: absentKey, xdr: null }] };
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    const stdin = new EventEmitter();
    stdin.end = data => {
      const parsed = JSON.parse(data);
      const added = parsed.entries.find(row => row.key === absentKey);
      assert.deepEqual(added, { key: absentKey, xdr: null });
      setImmediate(() => callback(null, JSON.stringify(valid()), ''));
    };
    return { stdin };
  });
  const output = await simulateSnapshot(withValidAbsent, '/test/helper');
  assert.equal(output.cpu_instructions_consumed, 270219);
});
