const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { xdr } = require('@stellar/stellar-sdk');
const { simulateSnapshot, resolveSimulationHelper, validateSnapshotEntry } = require('../dist/simulation');
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

test('validateSnapshotEntry accepts valid present entries with metadata and valid absent entries', () => {
  // Valid present entry with all metadata
  assert.doesNotThrow(() => {
    validateSnapshotEntry({
      key: 'testkey',
      xdr: 'AAAA...',
      extension_xdr: 'BBBB...',
      last_modified: 100,
      live_until: 200,
    });
  });

  // Valid absent entry with no metadata
  assert.doesNotThrow(() => {
    validateSnapshotEntry({
      key: 'testkey',
      xdr: null,
    });
  });

  // Valid absent entry with live_until: null
  assert.doesNotThrow(() => {
    validateSnapshotEntry({
      key: 'testkey',
      xdr: null,
      live_until: null,
    });
  });
});

test('validateSnapshotEntry rejects absent entries with present metadata', () => {
  // Contradictory absent entry with extension_xdr
  assert.throws(
    () => validateSnapshotEntry({ key: 'k', xdr: null, extension_xdr: 'AAAA' }),
    /Absent snapshot entry must not include entry metadata/,
  );

  // Contradictory absent entry with last_modified
  assert.throws(
    () => validateSnapshotEntry({ key: 'k', xdr: null, last_modified: 123 }),
    /Absent snapshot entry must not include entry metadata/,
  );

  // Contradictory absent entry with live_until
  assert.throws(
    () => validateSnapshotEntry({ key: 'k', xdr: null, live_until: 456 }),
    /Absent snapshot entry must not include entry metadata/,
  );
});

test('simulateSnapshot rejects input containing absent entry with metadata before helper execution', async () => {
  const badInput = {
    ...input,
    entries: [
      ...input.entries,
      { key: 'absentkey', xdr: null, last_modified: 999 },
    ],
  };
  await assert.rejects(
    simulateSnapshot(badInput, '/test/helper'),
    /Absent snapshot entry must not include entry metadata/,
  );
});
