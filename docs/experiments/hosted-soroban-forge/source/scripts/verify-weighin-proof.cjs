// Hosted proof assertions. Reads actual Action/native/RPC results; no substituted measurements.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const engine = path.resolve('.weighin-engine');
const { xdr, scValToNative } = require(path.join(engine, 'node_modules/@stellar/stellar-sdk'));
const { enforceThresholds, loadConfig } = require(path.join(engine, 'dist/threshold'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const upstream = '07d7935234e9c86816116471121998b871b68439';
const base = process.env.PROOF_BASE_SHA;
const instrumented = process.env.PROOF_INSTRUMENTED_SHA;
const scenario = process.env.SCENARIO;
const contract = 'crates/escrow/src/lib.rs';
const marker = '    ) -> ParticipantEscrowsPage {\n';
const addition = '        // PROOF ONLY: redundant participant-index existence check.\n' +
  '        let _ = env\n            .storage()\n            .persistent()\n' +
  '            .has(&DataKey::ParticipantIndex(participant.clone()));\n';
assert.match(base || '', /^[a-f0-9]{40}$/);
assert.match(instrumented || '', /^[a-f0-9]{40}$/);
assert.ok(['control', 'regression', 'threshold'].includes(scenario));
if (process.argv[2] === 'preflight') {
  assert.equal(git('rev-parse', `${instrumented}^`), upstream, 'Baseline must be configuration-only child of reviewed upstream');
  const allowed = new Set(['weighin-fixtures.json', 'weighin.toml', 'weighin-report-only.toml',
    'scripts/verify-weighin-proof.cjs', 'scripts/capture-weighin-process.cjs', 'docs/WEIGHIN_PROOF.md']);
  for (const file of git('diff', '--name-only', upstream, instrumented).split('\n').filter(Boolean)) {
    assert.ok(allowed.has(file), `Unexpected baseline change: ${file}`);
  }
  if (scenario === 'control') {
    assert.equal(base, instrumented);
    assert.equal(base, instrumented);
  } else {
    for (const file of git('diff', '--name-only', instrumented, base).split('\n').filter(Boolean)) {
      assert.ok(['.github/workflows/weighin-escrow-proof.yml', 'scripts/verify-weighin-proof.cjs', 'docs/WEIGHIN_PROOF.md'].includes(file), `Unexpected control harness change: ${file}`);
    }
    assert.equal(git('rev-parse', 'HEAD^'), base);
    assert.equal(git('diff', '--name-only', base, 'HEAD'), contract);
  }
  const before = execFileSync('git', ['show', `${base}:${contract}`], { encoding: 'utf8' });
  assert.equal(before.split(marker).length, 2, 'Unique insertion site');
  const expected = scenario === 'control' ? before : before.replace(marker, marker + addition);
  assert.equal(fs.readFileSync(contract, 'utf8'), expected, 'Only the approved one-read regression is allowed');
  for (const file of git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean)) {
    assert.ok(['.github/workflows/weighin-escrow-proof.yml', 'scripts/verify-weighin-proof.cjs', 'docs/WEIGHIN_PROOF.md', contract].includes(file), `Unexpected HEAD change: ${file}`);
  }
  console.log('Source preflight verified; no metrics have yet been measured.');
  process.exit(0);
}
assert.equal(process.argv[2], 'result');
const directory = process.env.EVIDENCE_PATH;
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const diff = JSON.parse(process.env.DIFF_JSON);
const report = fs.readFileSync('weighin-proof/report.md', 'utf8');
fs.writeFileSync(path.join(directory, 'diff.json'), JSON.stringify(diff, null, 2) + '\n');
assert.equal(diff.contracts.length, 1);
assert.deepEqual(diff.newContracts, []);
assert.deepEqual(diff.removedContracts, []);
const c = diff.contracts[0];
assert.equal(c.fixture_id, 'id:soroban-forge-escrow-proof');
assert.equal(c.logical_id, 'id:escrow');
assert.equal(c.base_commit, base);
assert.equal(c.head_commit, git('rev-parse', 'HEAD'));
assert.deepEqual(c.newBenchmarks, []);
assert.deepEqual(c.removedBenchmarks, []);
assert.equal(c.functions.length, 1);
const fn = c.functions[0];
assert.equal(fn.function_name, 'escrows_for_participant');
assert.equal(fn.case_id, 'id:empty-participant-page');
const cpu = fn.metrics.find(metric => metric.key === 'cpu_instructions');
const native = read('native.json'), rpc = read('rpc.json');
const wasm = {}, returns = {};
for (const side of ['base', 'head']) {
  const provenance = fn[`${side}_provenance`];
  assert.equal(provenance.protocol, 28);
  assert.equal(provenance.source, 'soroban-simulation');
  assert.equal(provenance.source_version, '28.0.1');
  const replay = native.find(row => row.output && hash(JSON.stringify(row.input)) === provenance.input_sha256);
  assert.ok(replay, 'Exact native input linked to reported provenance');
  const output = replay.output;
  const call = rpc.find(row => row.request.method === 'simulateTransaction' &&
    row.raw.result?.latestLedger === provenance.ledger &&
    row.raw.result?.transactionData === output.transaction_data_xdr &&
    row.raw.result?.results?.[0]?.xdr === output.retval_xdr);
  assert.ok(call, 'Exact RPC/native transaction-data and return parity');
  returns[side] = output.retval_xdr;
  assert.deepEqual(scValToNative(xdr.ScVal.fromXDR(output.retval_xdr, 'base64')),
    { ids: [], next_cursor: null, total: 0 });
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
    event_data_bytes: [...events, output.retval_xdr].reduce((sum, value) => sum + Buffer.from(value, 'base64').length, 0)
  };
  for (const [key, value] of Object.entries(expected)) {
    const metric = fn.metrics.find(m => m.key === key)[side];
    assert.equal(metric.availability, 'measured');
    assert.equal(metric.consumed, value, `${side} ${key}`);
  }
  for (const key of ['historical_data_read_bytes', 'contract_data_hard_limit', 'tx_size_bytes']) {
    const metric = fn.metrics.find(m => m.key === key)[side];
    assert.equal(metric.consumed, null); assert.equal(metric.availability, 'unavailable'); assert.ok(metric.reason);
  }
  const codes = replay.input.entries.filter(entry => entry.xdr)
    .map(entry => xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64'))
    .filter(entry => entry.switch().name === 'contractCode');
  assert.equal(codes.length, 1, 'Selected view has no contract dependencies');
  const bytes = codes[0].contractCode().code();
  wasm[side] = { sha256: hash(bytes), size: bytes.length };
  assert.equal(wasm[side].sha256, codes[0].contractCode().hash().toString('hex'));
  fs.writeFileSync(path.join(directory, `${side}.wasm`), bytes);
}
assert.equal(returns.base, returns.head, 'Business return is unchanged');
assert.equal(hash(fs.readFileSync('target/wasm32v1-none/release/soroban_forge_escrow.wasm')), wasm.head.sha256);
const violations = enforceThresholds(diff, loadConfig(process.env.CONFIG_PATH));
if (scenario === 'control') {
  assert.equal(wasm.base.sha256, wasm.head.sha256);
  for (const metric of fn.metrics.filter(m => m.availability === 'comparable')) assert.equal(metric.delta, 0, metric.key);
  assert.equal(diff.hasRegression, false);
} else {
  assert.notEqual(wasm.base.sha256, wasm.head.sha256);
  assert.notEqual(c.base_contract_id, c.head_contract_id);
  assert.ok(cpu.delta > 0, 'One extra read must cause a measured CPU regression; otherwise proof has not succeeded');
  assert.equal(cpu.delta, cpu.head.consumed - cpu.base.consumed);
  assert.equal(cpu.pct, (cpu.delta / cpu.base.consumed) * 100);
}
const negative = scenario === 'threshold';
const processExit = read('process-exit.json');
assert.equal(processExit.code, negative ? 1 : 0, 'Actual pinned Action Node process exit');
assert.equal(process.env.ACTION_OUTCOME, negative ? 'failure' : 'success');
assert.equal(process.env.ACTION_RESULT, negative ? 'fail' : 'pass');
if (negative) {
  assert.equal(violations.length, 1);
  assert.equal(violations[0].metric, 'cpu_instructions');
  assert.equal(violations[0].rule, 'strict_zero_tolerance');
  assert.ok(report.includes(violations[0].message), 'Report contains the actual policy violation');
} else assert.deepEqual(violations, []);
const proof = { status: 'VERIFIED', scenario, upstream_sha: upstream, base_sha: base,
  head_sha: c.head_commit, weighin_sha: 'bbbe9001bbd375fd6a1ff75be5da2593c86fff20',
  action_outcome: process.env.ACTION_OUTCOME, action_result: process.env.ACTION_RESULT,
  action_exit: processExit.code, configuration_baseline_sha: instrumented,
  runtime_contract_ids: { base: c.base_contract_id, head: c.head_contract_id },
  logical_identity: [c.fixture_id, c.logical_id, fn.function_name, fn.case_id],
  return_value: { ids: [], total: 0, next_cursor: null }, invocation_args: JSON.parse(fs.readFileSync('weighin-fixtures.json')).contracts[0].invocations[0].args,
  metrics: fn.metrics, threshold_config: loadConfig(process.env.CONFIG_PATH),
  exit_code_evidence: 'process-exit.json captured by forwarding observer; original Action step outcome independently checked',
  enclosing_job_pattern: negative ? 'Expected policy failure verified; job may finish green' : 'Successful Action',
  wasm, cpu, violations, return_parity: true,
  run_url: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` };
fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof, null, 2));
