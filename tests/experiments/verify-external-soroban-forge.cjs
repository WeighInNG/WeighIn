// Real external-project source, isolated local history, unmodified Action and live RPC/native IO.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { createHash } = require('node:crypto'), { xdr } = require('@stellar/stellar-sdk');
const { enforceThresholds } = require('../../dist/threshold');
const root = path.resolve(__dirname, '../..');
const sourceSha = '07d7935234e9c86816116471121998b871b68439';
const engineSha = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const scenario = process.argv[2], destination = path.resolve(process.argv[3]);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-external-private-'));
const workspace = path.join(temporary, 'project'), origin = path.join(temporary, 'origin.git');
const helper = process.env.WEIGHIN_HELPER_PATH;
const fixturesDir = path.join(root, 'docs/experiments/external-soroban-forge/integration');
const rpc = process.env.WEIGHIN_EXPERIMENT_RPC_URL || 'http://localhost:8000/rpc';
const hash = data => createHash('sha256').update(data).digest('hex');
fs.mkdirSync(destination, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(destination, name), JSON.stringify(value, null, 2) + '\n');
async function child(file, args, cwd = workspace, env = process.env) {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { cwd, env }); let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    p.on('error', reject); p.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function git(...args) {
  const result = await child('git', args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function outputField(raw, name) {
  const lines = raw.split('\n'), start = lines.findIndex(line => line.startsWith(`${name}<<`));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = lines.indexOf(lines[start].split('<<')[1], start + 1);
  assert.ok(end > start); return lines.slice(start + 1, end).join('\n');
}
async function main() {
  assert.ok(['control', 'regression', 'threshold'].includes(scenario));
  assert.ok(helper && fs.existsSync(helper), 'Provide a helper built from the verified native source');
  assert.ok(!fs.existsSync(path.join(destination, 'verification.json')), 'Use a fresh evidence directory');
  const clone = await child('git', ['clone', '--no-hardlinks', process.env.WEIGHIN_EXTERNAL_SOURCE || 'https://github.com/Meet-hybrid/soroban-forge.git', workspace], temporary);
  assert.equal(clone.status, 0, clone.stderr);
  await git('checkout', '--detach', sourceSha);
  await git('config', 'user.name', 'WeighIn isolated experiment');
  await git('config', 'user.email', 'experiment@example.invalid');
  await git('checkout', '-b', 'experiment-base');
  for (const file of ['weighin-fixtures.json', 'weighin.toml']) fs.copyFileSync(path.join(fixturesDir, file), path.join(workspace, file));
  fs.copyFileSync(path.join(fixturesDir, 'weighin.yml'), path.join(workspace, '.github/workflows/weighin.yml'));
  if (scenario === 'regression') fs.writeFileSync(path.join(workspace, 'weighin.toml'), '');
  await git('add', 'weighin-fixtures.json', 'weighin.toml', '.github/workflows/weighin.yml');
  await git('commit', '-m', 'Local experiment: configure the unchanged external escrow benchmark');
  const baseSha = await git('rev-parse', 'HEAD');
  const bare = await child('git', ['clone', '--bare', workspace, origin], temporary);
  assert.equal(bare.status, 0, bare.stderr); await git('remote', 'set-url', 'origin', origin);
  await git('checkout', '-b', 'experiment-head');
  const contractFile = path.join(workspace, 'crates/escrow/src/lib.rs');
  fs.copyFileSync(contractFile, path.join(destination, 'base-contract.rs'));
  if (scenario !== 'control') {
    const original = fs.readFileSync(contractFile, 'utf8');
    const marker = ') -> ParticipantEscrowsPage {\n        let ids = env';
    assert.equal(original.split(marker).length, 2, 'Regression anchor must be unique');
    const added = ') -> ParticipantEscrowsPage {\n        // Isolated experiment: redundant bounded reads preserve the returned page.\n        for _ in 0..8 {\n            let _ = env.storage().persistent().has(&DataKey::ParticipantIndex(participant.clone()));\n        }\n        let ids = env';
    fs.writeFileSync(contractFile, original.replace(marker, added));
    const fmt = await child('cargo', ['+1.95.0', 'fmt', '--all']); assert.equal(fmt.status, 0, fmt.stderr);
    await git('add', 'crates/escrow/src/lib.rs');
    await git('commit', '-m', 'Local experiment only: add redundant participant-index reads');
  }
  const headSha = await git('rev-parse', 'HEAD');
  fs.copyFileSync(contractFile, path.join(destination, 'head-contract.rs'));
  fs.writeFileSync(path.join(destination, 'regression.patch'), await git('diff', baseSha, headSha, '--', 'crates/escrow/src/lib.rs'));
  for (const file of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'weighin-fixtures.json', 'weighin.toml']) fs.copyFileSync(path.join(workspace, file), path.join(destination, file));
  const format = await child('cargo', ['+1.95.0', 'fmt', '--all', '--', '--check']);
  const metadata = await child('cargo', ['+1.95.0', 'metadata', '--locked', '--no-deps', '--format-version', '1']);
  assert.equal(format.status, 0, format.stderr); assert.equal(metadata.status, 0, metadata.stderr);
  write('source-checks.json', { format, metadata_exit: metadata.status });
  const outputs = path.join(destination, 'outputs.txt'), summaryPath = path.join(destination, 'summary.md');
  fs.writeFileSync(outputs, ''); fs.writeFileSync(summaryPath, '');
  const runner = path.join(temporary, 'runner'); fs.mkdirSync(runner);
  const heartbeat = setInterval(() => console.log(`${scenario}: external source builds and live simulation in progress`), 30000);
  let run;
  try {
    run = await child(process.execPath, ['--require', path.join(root, 'tests/support/record-migration-io.cjs'), path.join(root, 'bundled/index.js')], workspace, {
      ...process.env, TMPDIR: runner, CARGO_BUILD_JOBS: '2', CARGO_INCREMENTAL: '0',
      WEIGHIN_MIGRATION_EVIDENCE: destination, GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summaryPath,
      'INPUT_FIXTURES-PATH': 'weighin-fixtures.json', 'INPUT_CONFIG-PATH': 'weighin.toml',
      'INPUT_BASE-REF': 'experiment-base', 'INPUT_RPC-URL': rpc, 'INPUT_GITHUB-TOKEN': '',
      'INPUT_RUST-TOOLCHAIN': '1.95.0', 'INPUT_REPORT-PATH': 'weighin-report.md'
    });
  } finally { clearInterval(heartbeat); }
  write('process.json', run);
  const raw = fs.readFileSync(outputs, 'utf8'), summary = fs.readFileSync(summaryPath, 'utf8');
  const diff = JSON.parse(outputField(raw, 'diff-json')); write('diff.json', diff);
  assert.equal(run.status, scenario === 'threshold' ? 1 : 0, run.stderr + run.stdout);
  assert.equal(outputField(raw, 'result'), scenario === 'threshold' ? 'fail' : 'pass');
  assert.deepEqual(diff.newContracts, []); assert.deepEqual(diff.removedContracts, []);
  assert.equal(diff.contracts.length, 1);
  const contract = diff.contracts[0], fn = contract.functions[0];
  assert.equal(contract.fixture_id, 'id:soroban-forge-proof'); assert.equal(contract.logical_id, 'id:escrow');
  assert.equal(contract.functions.length, 1); assert.equal(fn.function_name, 'escrows_for_participant');
  assert.equal(fn.case_id, 'id:empty-participant-page');
  assert.equal(contract.base_commit, baseSha); assert.equal(contract.head_commit, headSha);
  assert.deepEqual(contract.newBenchmarks, []); assert.deepEqual(contract.removedBenchmarks, []);
  const buildHashes = [...run.stdout.matchAll(/Built soroban-forge-escrow: .*?; SHA256 ([a-f0-9]{64})/g)].map(match => match[1]);
  assert.equal(buildHashes.length, 2); assert.equal(buildHashes[0] === buildHashes[1], scenario === 'control');
  assert.equal(contract.base_contract_id === contract.head_contract_id, scenario === 'control');
  const measured = fn.metrics.filter(metric => metric.availability === 'comparable');
  assert.equal(measured.length, 8);
  for (const metric of measured) {
    assert.equal(metric.delta, metric.head.consumed - metric.base.consumed);
    if (scenario === 'control') assert.equal(metric.delta, 0, `Control noise: ${metric.key}`);
  }
  const cpu = measured.find(metric => metric.key === 'cpu_instructions');
  if (scenario !== 'control') assert.ok(cpu.delta > 0 && cpu.regression, 'A genuine CPU regression is required');
  assert.ok(summary.includes('id:escrow') && summary.includes('escrows_for_participant'));
  assert.ok(summary.includes(contract.base_contract_id) && summary.includes(contract.head_contract_id));
  const policy = scenario === 'regression' ? {} : { thresholds: { functions: { escrows_for_participant: { cpu_instructions: 'strict_zero_tolerance' } } } };
  const violations = enforceThresholds(diff, policy);
  assert.equal(violations.length, scenario === 'threshold' ? 1 : 0);
  if (scenario === 'threshold') assert.match(summary, /cpu_instructions increased by .*strict zero tolerance/);
  const native = JSON.parse(fs.readFileSync(path.join(destination, 'native.json')));
  const rpcCalls = JSON.parse(fs.readFileSync(path.join(destination, 'rpc.json')));
  const snapshots = {};
  for (const side of ['base', 'head']) {
    const provenance = fn[`${side}_provenance`];
    const sample = native.find(row => row.output && hash(JSON.stringify(row.input)) === provenance.input_sha256);
    assert.ok(sample, 'Reported provenance must match captured helper input'); snapshots[side] = sample;
    assert.equal(cpu[side].consumed, sample.output.cpu_instructions_consumed);
    assert.ok(rpcCalls.some(call => call.request.method === 'simulateTransaction' && call.raw.result?.latestLedger === provenance.ledger && call.raw.result?.transactionData === sample.output.transaction_data_xdr && call.raw.result?.results?.[0]?.xdr === sample.output.retval_xdr), 'Raw RPC/native transaction and return parity required');
    const code = sample.input.entries.map(entry => entry.xdr && xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64'))
      .find(entry => entry && entry.switch().name === 'contractCode' && hash(entry.contractCode().code()) === buildHashes[side === 'head' ? 0 : 1]);
    assert.ok(code, 'Actual captured WASM must match the build hash'); fs.writeFileSync(path.join(destination, `${side}.wasm`), code.contractCode().code());
  }
  assert.equal(snapshots.base.output.retval_xdr, snapshots.head.output.retval_xdr, 'The intentional regression must preserve the fixture output');
  write('verification.json', { status: 'VERIFIED', scenario, source_repository: 'https://github.com/Meet-hybrid/soroban-forge', source_sha: sourceSha,
    engine_sha: engineSha, bundle_sha256: hash(fs.readFileSync(path.join(root, 'bundled/index.js'))), helper_sha256: hash(fs.readFileSync(helper)),
    node: process.version, base_sha: baseSha, head_sha: headSha, build_hashes: buildHashes,
    cpu: { base: cpu.base.consumed, head: cpu.head.consumed, delta: cpu.delta }, action_exit: run.status, violations,
    same_return_xdr: true, real_git_build_rpc_native_action: true, io_observers_only: true,
    temporary_git_history_only: true, github_hosted_execution: false, shared_cargo_cache: true });
  const checksums = Object.fromEntries(fs.readdirSync(destination).filter(file => fs.statSync(path.join(destination, file)).isFile())
    .map(file => [file, hash(fs.readFileSync(path.join(destination, file)))]));
  write('sha256.json', checksums);
  console.log(JSON.stringify({ scenario, cpu: { base: cpu.base.consumed, head: cpu.head.consumed, delta: cpu.delta }, action_exit: run.status, status: 'VERIFIED' }));
  process.exitCode = run.status;
}
main().catch(error => { write('failure.json', { message: error.message, stack: error.stack }); console.error(error); process.exitCode = 1; });
