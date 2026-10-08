const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { xdr } = require('@stellar/stellar-sdk');
const { verifyScenario } = require('./experiments/flagship-analysis.cjs');
const archives = [
  { directory: 'hosted-comparison', hosted: true, url: 'https://github.com/WeighInNG/WeighIn/actions/runs/37777040210' },
  { directory: 'public-docs', hosted: false, url: null },
  { directory: 'publication', hosted: true, url: 'https://github.com/WeighInNG/WeighIn/actions/runs/37853815025' }
];
const hash = data => createHash('sha256').update(data).digest('hex');

for (const source of archives) for (const scenario of ['control', 'regression', 'threshold']) {
  test(`retained ${source.directory} ${scenario} has intact sources, real exits and logical changed-WASM pairing`, () => {
    const directory = path.resolve(__dirname, '../docs/experiments', source.directory, scenario);
    const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
    for (const [file, expected] of Object.entries(read('sha256.json'))) {
      assert.equal(hash(fs.readFileSync(path.join(directory, file))), expected, file);
    }
    const proof = read('verification.json'), diff = read('diff.json');
    assert.equal(proof.github_hosted_execution, source.hosted);
    assert.equal(read('environment.json').github_run_url, source.url);
    verifyScenario({ scenario, diff, status: proof.action_exit, result: proof.result,
      summary: fs.readFileSync(path.join(directory, 'summary.md'), 'utf8'),
      buildHashes: proof.build_hashes, baseSha: proof.base_sha, headSha: proof.head_sha,
      expectedIdentities: [['path:weighin-fixtures.json', 'id:reference-contract'],
        ['path:weighin-fixtures.json', 'wasm:contract/target/wasm32-unknown-unknown/release/contract_test.wasm']] });
    assert.equal(hash(fs.readFileSync(path.join(directory, 'head.wasm'))), proof.build_hashes[0]);
    assert.equal(hash(fs.readFileSync(path.join(directory, 'base.wasm'))), proof.build_hashes[2]);
    const native = read('native.json'), rpc = read('rpc.json');
    for (const contract of diff.contracts) for (const fn of contract.functions) for (const side of ['base', 'head']) {
      const provenance = fn[`${side}_provenance`];
      const replay = native.find(row => row.output && hash(JSON.stringify(row.input)) === provenance.input_sha256);
      assert.ok(replay, 'Exact native input linked by reported provenance');
      const output = replay.output;
      const call = rpc.find(row => row.request.method === 'simulateTransaction' && row.raw.result?.latestLedger === provenance.ledger
        && row.raw.result?.transactionData === output.transaction_data_xdr && row.raw.result?.results?.[0]?.xdr === output.retval_xdr);
      assert.ok(call, 'Parity-accepted raw RPC response');
      const resources = xdr.SorobanTransactionData.fromXDR(call.raw.result.transactionData, 'base64').resources();
      const events = (call.raw.result.events || []).map(value => xdr.DiagnosticEvent.fromXDR(value, 'base64'))
        .filter(event => event.inSuccessfulContractCall() && event.event().type().name !== 'diagnostic')
        .map(event => event.event().toXDR('base64'));
      assert.deepEqual(events, output.contract_events_xdr);
      const expected = {
        cpu_instructions: output.cpu_instructions_consumed, memory_bytes: output.memory_bytes_consumed,
        ledger_read_entries: resources.footprint().readOnly().length + resources.footprint().readWrite().length,
        ledger_read_bytes: resources.diskReadBytes(), ledger_write_entries: resources.footprint().readWrite().length,
        ledger_write_bytes: resources.writeBytes(), events_count: events.length,
        event_data_bytes: [...events, call.raw.result.results[0].xdr].reduce((sum, value) => sum + Buffer.from(value, 'base64').length, 0)
      };
      for (const [key, value] of Object.entries(expected)) assert.equal(fn.metrics.find(m => m.key === key)[side].consumed, value, key);
      for (const key of ['historical_data_read_bytes', 'contract_data_hard_limit', 'tx_size_bytes']) {
        const metric = fn.metrics.find(m => m.key === key)[side];
        assert.equal(metric.availability, 'unavailable'); assert.equal(metric.consumed, null); assert.ok(metric.reason);
      }
    }
  });
}
