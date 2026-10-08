const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { simulateSnapshot } = require('../../dist/simulation');
const replays = require('../../docs/experiments/metric-provenance/native-replays.json');
const helper = path.resolve(__dirname,'../../native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const records = require('../../docs/experiments/metric-provenance/measurements.json');
const { createHash } = require('node:crypto');
for (const measured of records[0].benchmarks) {
  test(`real captured ${measured.case_id} snapshot reproduces metered compute, IO and event XDR independently of instruction leeway`, async () => {
    const captured = replays.find(r=>r.output && createHash('sha256').update(JSON.stringify(r.input)).digest('hex')===measured.provenance.input_sha256);
    assert.ok(captured);
    const output = await simulateSnapshot(captured.input,helper);
    assert.deepEqual(output,captured.output);
    const leeway = await simulateSnapshot({...captured.input,instruction_leeway:5000000},helper);
    for (const key of ['cpu_instructions_consumed','memory_bytes_consumed','disk_read_bytes','write_bytes','read_only_keys','read_write_keys','contract_events_xdr','retval_xdr']) assert.deepEqual(leeway[key],output[key],key);
    assert.ok(leeway.instruction_budget>output.instruction_budget);
  });
}
