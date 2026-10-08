// Real isolated Git/build/RPC/native/Action proof. Never modifies the production contract.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { xdr } = require('@stellar/stellar-sdk');
const { verifyScenario } = require('./flagship-analysis.cjs');
const root = path.resolve(__dirname, '../..');
const scenario = process.argv[2], destination = path.resolve(process.argv[3] || '/tmp/weighin-flagship-evidence');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-flagship-private-'));
const workspace = path.join(temporary, 'project'), origin = path.join(temporary, 'origin.git');
const helper = path.join(root, 'native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation');
const rpc = process.env.WEIGHIN_EXPERIMENT_RPC_URL || 'http://localhost:8000/rpc';
const cargoTarget = process.env.WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR || path.join(temporary, 'cargo-cache');
const inputs = ['contract/Cargo.toml', 'contract/Cargo.lock', 'contract/src/lib.rs', 'rust-toolchain.toml', 'weighin-fixtures.json'];
const hash = data => createHash('sha256').update(data).digest('hex');
fs.mkdirSync(destination, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(destination, name), JSON.stringify(value, null, 2) + '\n');
async function child(command, args, cwd = workspace, env = process.env) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd, env }); let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    p.on('error', reject); p.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function git(...args) {
  const r = await child('git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function outputField(raw, name) {
  const lines = raw.split('\n'), start = lines.findIndex(l => l.startsWith(`${name}<<`));
  assert.ok(start >= 0, `Missing output ${name}`);
  const end = lines.indexOf(lines[start].split('<<')[1], start + 1);
  assert.ok(end > start); return lines.slice(start + 1, end).join('\n');
}
function saveInputs(side) {
  for (const file of [...inputs, 'weighin.toml']) {
    const target = path.join(destination, side, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(workspace, file), target);
  }
}
async function main() {
  assert.ok(['control', 'regression', 'threshold'].includes(scenario), 'Choose control, regression or threshold');
  assert.ok(!fs.existsSync(path.join(destination, 'verification.json')), 'Use a new evidence directory');
  fs.mkdirSync(path.join(workspace, 'contract/src'), { recursive: true });
  for (const file of inputs) fs.copyFileSync(path.join(root, file), path.join(workspace, file));
  // Keep both current identities; this experiment does not retire the historical bridge.
  const fixtures = JSON.parse(fs.readFileSync(path.join(workspace, 'weighin-fixtures.json')));
  const expectedIdentities = fixtures.contracts.map(c => ['path:weighin-fixtures.json', c.id ? `id:${c.id}` : `wasm:${c.wasm_path}`]);
  const policy = scenario === 'regression' ? {} : { thresholds: { functions: { hello: { cpu_instructions: 'strict_zero_tolerance' } } } };
  fs.writeFileSync(path.join(workspace, 'weighin.toml'), scenario === 'regression' ? '' : '[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\n');
  fs.writeFileSync(path.join(workspace, '.gitignore'), 'contract/target/\n');
  await git('init', '-b', 'main'); await git('config', 'user.name', 'WeighIn isolated proof');
  await git('config', 'user.email', 'experiment@example.invalid');
  await git('add', '.'); await git('commit', '-m', 'Isolated reference BASE');
  const baseSha = await git('rev-parse', 'HEAD'); saveInputs('base');
  const clone = await child('git', ['clone', '--bare', workspace, origin], temporary);
  assert.equal(clone.status, 0, clone.stderr); await git('remote', 'add', 'origin', origin);
  await git('checkout', '-b', 'experiment-head');
  if (scenario !== 'control') {
    const file = path.join(workspace, 'contract/src/lib.rs'), source = fs.readFileSync(file, 'utf8');
    assert.equal(source.split('vec![&env,').length, 2, 'Regression insertion must occur exactly once');
    fs.writeFileSync(file, source.replace('vec![&env,', 'env.storage().persistent().set(&symbol_short!("bench"), &to);\n        vec![&env,'));
    await git('add', 'contract/src/lib.rs'); await git('commit', '-m', 'Isolated intentional persistent write');
  }
  const headSha = await git('rev-parse', 'HEAD'); saveInputs('head');
  const producer = await child('git', ['rev-parse', 'HEAD'], root);
  const stellar = await child('stellar', ['--version']), rust = await child('rustc', ['--version']);
  assert.equal(stellar.status, 0); assert.equal(rust.status, 0);
  write('environment.json', { producer_sha: producer.stdout.trim(), node: process.version, stellar: stellar.stdout.trim(), rust: rust.stdout.trim(),
    sdk: '28.0.0', target: 'wasm32v1-none', quickstart_image: 'stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5',
    bundle_sha256: hash(fs.readFileSync(path.join(root, 'bundled/index.js'))), helper_sha256: hash(fs.readFileSync(helper)),
    reused_external_cargo_cache: !!process.env.WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR, shared_base_head_cargo_cache: true,
    native_helper_prebuilt_from_repository_source: true, temporary_git_history_only: true,
    producer_files: Object.fromEntries(['tests/experiments/verify-flagship-ci.cjs', 'tests/experiments/flagship-analysis.cjs',
      'tests/support/record-migration-io.cjs', '.github/workflows/flagship-proof.yml'].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    github_run_url: process.env.GITHUB_ACTIONS === 'true' ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null });
  const outputs = path.join(destination, 'outputs.txt'), summaryPath = path.join(destination, 'summary.md');
  fs.writeFileSync(outputs, ''); fs.writeFileSync(summaryPath, '');
  const runner = path.join(temporary, 'runner'); fs.mkdirSync(runner);
  const heartbeat = setInterval(() => console.log(`${scenario}: real builds / live measurement in progress`), 30000);
  let run;
  try {
    run = await child(process.execPath, ['--require', path.join(root, 'tests/support/record-migration-io.cjs'), path.join(root, 'bundled/index.js')], workspace,
      { ...process.env, TMPDIR: runner, CARGO_TARGET_DIR: cargoTarget, CARGO_BUILD_JOBS: '2', CARGO_INCREMENTAL: '0',
        WEIGHIN_HELPER_PATH: helper, WEIGHIN_MIGRATION_EVIDENCE: destination, GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summaryPath, 'INPUT_FIXTURES-PATH': 'weighin-fixtures.json',
        'INPUT_CONFIG-PATH': 'weighin.toml', 'INPUT_BASE-REF': 'main', 'INPUT_RPC-URL': rpc,
        'INPUT_GITHUB-TOKEN': '', 'INPUT_RUST-TOOLCHAIN': '1.95.0' });
  } finally { clearInterval(heartbeat); }
  write('process.json', run); console.log(run.stdout); console.error(run.stderr);
  const raw = fs.readFileSync(outputs, 'utf8'), summary = fs.readFileSync(summaryPath, 'utf8');
  const diff = JSON.parse(outputField(raw, 'diff-json')); write('diff.json', diff);
  const buildHashes = [...run.stdout.matchAll(/Built contract_test: .*?; SHA256 ([a-f0-9]{64})/g)].map(m => m[1]);
  const proof = verifyScenario({ scenario, diff, status: run.status, result: outputField(raw, 'result'), summary, buildHashes, baseSha, headSha, expectedIdentities });
  const native = JSON.parse(fs.readFileSync(path.join(destination, 'native.json')));
  const calls = JSON.parse(fs.readFileSync(path.join(destination, 'rpc.json')));
  for (const contract of diff.contracts) for (const fn of contract.functions) for (const side of ['base', 'head']) {
    const provenance = fn[`${side}_provenance`];
    const replay = native.find(r => r.output && hash(JSON.stringify(r.input)) === provenance.input_sha256);
    assert.ok(replay, 'Native input must match reported provenance');
    assert.ok(calls.some(c => c.request.method === 'simulateTransaction' && c.raw.result?.latestLedger === provenance.ledger
      && c.raw.result?.transactionData === replay.output.transaction_data_xdr && c.raw.result?.results?.[0]?.xdr === replay.output.retval_xdr), 'Raw RPC/native parity evidence required');
    assert.equal(fn.metrics.find(m => m.key === 'cpu_instructions')[side].consumed, replay.output.cpu_instructions_consumed);
  }
  const wasm = fs.readFileSync(path.join(workspace, fixtures.contracts[0].wasm_path));
  assert.equal(hash(wasm), buildHashes[0]); fs.writeFileSync(path.join(destination, 'head.wasm'), wasm);
  // Recover the BASE bytes from the actual captured ledger state, after its worktree was removed.
  const baseInput = native.find(r => r.output && hash(JSON.stringify(r.input)) === diff.contracts[0].functions[0].base_provenance.input_sha256).input;
  const baseCode = baseInput.entries.map(e => e.xdr && xdr.LedgerEntryData.fromXDR(e.xdr, 'base64'))
    .find(e => e && e.switch().name === 'contractCode' && hash(e.contractCode().code()) === buildHashes[fixtures.contracts.length]);
  assert.ok(baseCode, 'Captured BASE artifact must match its real build hash');
  fs.writeFileSync(path.join(destination, 'base.wasm'), baseCode.contractCode().code());
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  write('verification.json', { ...proof, base_sha: baseSha, head_sha: headSha, build_hashes: buildHashes, policy,
    real_git_build_rpc_native_action: true, io_observers_only: true, github_hosted_execution: process.env.GITHUB_ACTIONS === 'true' });
  const checksums = {};
  function inventory(dir) {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, file.name);
      if (file.isDirectory()) inventory(absolute);
      else checksums[path.relative(destination, absolute)] = hash(fs.readFileSync(absolute));
    }
  }
  inventory(destination); write('sha256.json', checksums);
  // Preserve the bundled Action's genuine exit. Workflow separately verifies the expected failure.
  process.exitCode = run.status;
}
main().catch(error => { write('failure.json', { message: error.message, stack: error.stack }); console.error(error); process.exitCode = 1; });
