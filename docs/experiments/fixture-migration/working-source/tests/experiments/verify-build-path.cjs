// Explicit Stage 2 local proof. Real Git fetch/worktrees, Stellar contract builds,
// RPC deployment/simulation, native meters and bundled Action. No IO hooks/stubs.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const destination = path.resolve(process.argv[2] || '/tmp/weighin-stage2-proof');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-build-proof-'));
const workspace = path.join(temporary, 'project');
const origin = path.join(temporary, 'origin.git');
const rpc = process.env.WEIGHIN_EXPERIMENT_RPC_URL || 'http://localhost:18000/rpc';
const policyMetric = process.env.WEIGHIN_EXPERIMENT_POLICY_METRIC || 'cpu_instructions';
const cargoTarget = process.env.WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR || path.join(temporary, 'cargo-cache');
assert.ok(['cpu_instructions', 'ledger_write_bytes'].includes(policyMetric), 'Experiment policy must name an audited metric');
fs.mkdirSync(destination, { recursive: true });
fs.mkdirSync(path.join(workspace, 'contract/src'), { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(destination, name), JSON.stringify(value, null, 2) + '\n');
async function child(command, args, cwd = workspace, env = process.env) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd, env }); let stdout = '', stderr = '';
    process.stdout.on('data', data => { stdout += data; }); process.stderr.on('data', data => { stderr += data; });
    process.on('error', reject); process.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function git(...args) {
  const result = await child('git', args);
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function outputField(raw, name) {
  const lines = raw.split('\n'); const start = lines.findIndex(line => line.startsWith(`${name}<<`));
  assert.ok(start >= 0, `Missing output ${name}`); const delimiter = lines[start].split('<<')[1];
  const end = lines.indexOf(delimiter, start + 1); return lines.slice(start + 1, end).join('\n');
}
async function action(label, expected) {
  const runnerTemp = path.join(temporary, `runner-${label}`); fs.mkdirSync(runnerTemp);
  const outputs = path.join(destination, `${label}-outputs.txt`), summary = path.join(destination, `${label}-summary.md`);
  fs.writeFileSync(outputs, ''); fs.writeFileSync(summary, '');
  const result = await child(process.execPath, [path.join(repository, 'bundled/index.js')], workspace, {
    ...process.env, TMPDIR: runnerTemp, CARGO_TARGET_DIR: cargoTarget,
    GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summary,
    'INPUT_FIXTURES-PATH': 'weighin-fixtures.json', 'INPUT_CONFIG-PATH': 'weighin.toml', 'INPUT_BASE-REF': 'main',
    'INPUT_RPC-URL': rpc, 'INPUT_GITHUB-TOKEN': '', 'INPUT_RUST-TOOLCHAIN': '1.95.0',
  });
  write(`${label}-process.json`, result);
  assert.equal(result.status, expected, result.stdout + result.stderr);
  const raw = fs.readFileSync(outputs, 'utf8');
  assert.equal(outputField(raw, 'result'), expected ? 'fail' : 'pass');
  const diff = JSON.parse(outputField(raw, 'diff-json')); write(`${label}-diff.json`, diff);
  const contractCount = JSON.parse(fs.readFileSync(path.join(workspace, 'weighin-fixtures.json'))).contracts.length;
  assert.equal(diff.contracts.length, contractCount);
  for (const contract of diff.contracts) assert.equal(contract.functions.length, 1);
  const contract = diff.contracts.find(c => c.logical_id === 'id:reference-contract') || diff.contracts[0];
  const cpu = contract.functions[0].metrics.find(metric => metric.key === 'cpu_instructions');
  const selected = contract.functions[0].metrics.find(metric => metric.key === policyMetric);
  assert.equal(selected.availability, 'comparable');
  assert.ok(label === 'control' ? selected.delta === 0 : selected.delta > 0);
  if (label === 'regression') assert.match(fs.readFileSync(summary, 'utf8'), /threshold violation/);
  assert.ok(result.stdout.includes('Stellar') || result.stdout.includes('stellar 28.1.0'));
  assert.ok(result.stdout.includes('SHA256'));
  const buildHashes = [...result.stdout.matchAll(/Built contract_test: .*?; SHA256 ([a-f0-9]{64})/g)].map(match => match[1]);
  assert.equal(buildHashes.length, 2 * contractCount, 'Both HEAD and BASE must produce every configured artifact');
  if (label === 'control') assert.equal(new Set(buildHashes).size, 1);
  else assert.notEqual(buildHashes[0], buildHashes[contractCount]);
  // Save only the built artifact; keys remain in the private temporary runner dir.
  const wasm = fs.readFileSync(path.join(workspace, 'contract/target/wasm32v1-none/release/contract_test.wasm'));
  fs.writeFileSync(path.join(destination, `${label}.wasm`), wasm);
  return { cpu, selected, contract, buildHashes, wasm_sha256: createHash('sha256').update(wasm).digest('hex'), exit: result.status };
}
async function main() {
  for (const file of ['contract/Cargo.toml', 'contract/Cargo.lock', 'contract/src/lib.rs', 'rust-toolchain.toml', 'weighin-fixtures.json']) {
    fs.copyFileSync(path.join(repository, file), path.join(workspace, file));
  }
  fs.writeFileSync(path.join(workspace, '.gitignore'), 'contract/target/\n');
  fs.writeFileSync(path.join(workspace, 'weighin.toml'), `[thresholds.functions.hello]\n${policyMetric}="strict_zero_tolerance"\n`);
  await git('init', '-b', 'main'); await git('config', 'user.name', 'WeighIn isolated experiment');
  await git('config', 'user.email', 'experiment@example.invalid'); await git('add', '.');
  await git('commit', '-m', 'Isolated BASE fixture'); const baseSha = await git('rev-parse', 'HEAD');
  const clone = await child('git', ['clone', '--bare', workspace, origin], temporary);
  assert.equal(clone.status, 0, clone.stderr); await git('remote', 'add', 'origin', origin);
  await git('checkout', '-b', 'experiment-head');
  const control = await action('control', 0); assert.equal(control.cpu.delta, 0);
  const source = path.join(workspace, 'contract/src/lib.rs');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('vec![&env,', 'env.storage().persistent().set(&symbol_short!("bench"), &to);\n        vec![&env,'));
  await git('add', 'contract/src/lib.rs'); await git('commit', '-m', 'Isolated intentional resource regression');
  const headSha = await git('rev-parse', 'HEAD');
  const regression = await action('regression', 1); assert.ok(regression.cpu.delta > 0);
  assert.notEqual(control.wasm_sha256, regression.wasm_sha256);
  assert.notEqual(regression.contract.base_contract_id, regression.contract.head_contract_id);
  assert.equal(regression.contract.base_commit, baseSha); assert.equal(regression.contract.head_commit, headSha);
  fs.copyFileSync(source, path.join(destination, 'head-contract.rs'));
  for (const file of ['contract/Cargo.toml','contract/Cargo.lock','contract/src/lib.rs','rust-toolchain.toml','weighin-fixtures.json']) {
    fs.copyFileSync(path.join(repository,file), path.join(destination, file.replaceAll('/', '-')));
  }
  const version = await child('stellar', ['--version']);
  const rust = await child('rustc', ['--version']);
  const proof = { status: 'PRODUCTION_BUILD_COMPARISON_PASS', base_sha: baseSha, head_sha: headSha,
    temporary_git_history_only: true, checkout_build_measurement_policy_action_all_real: true,
    infrastructure_stubs: false, shared_cargo_artifact_cache: true, clean_build_repeatability_proven: false,
    reused_external_cargo_cache: !!process.env.WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR,
    public_github_ci_proven: false, stellar_version: version.stdout.trim(), rust_version: rust.stdout.trim(),
    policy_metric: policyMetric, policy_base: regression.selected.base.consumed,
    policy_head: regression.selected.head.consumed, policy_delta: regression.selected.delta,
    sdk: '28.0.0', target: 'wasm32v1-none', locked: true, optimized: true,
    control: { exit: control.exit, cpu_delta: control.cpu.delta, wasm_sha256: control.wasm_sha256, head_base_build_hashes: control.buildHashes },
    regression: { exit: regression.exit, cpu_base: regression.cpu.base.consumed, cpu_head: regression.cpu.head.consumed,
      cpu_delta: regression.cpu.delta, cpu_pct: regression.cpu.pct, wasm_sha256: regression.wasm_sha256, head_base_build_hashes: regression.buildHashes } };
  write('verification.json', proof); console.log(JSON.stringify(proof, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
