const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const exec = require('@actions/exec');
const { buildContracts } = require('../dist/build');

async function scenario(options, verify) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-build-test-'));
  const original = exec.exec, originalFlush = fs.fsyncSync, originalRead = fs.readFileSync;
  let buildReturned = false;
  fs.fsyncSync = descriptor => {
    if (options.failedStorage && (!options.failAfterBuild || buildReturned))
      throw Object.assign(new Error('injected temporary-storage quota exceeded'), { code: 'EDQUOT' });
    return originalFlush(descriptor);
  };
  fs.readFileSync = (file, ...args) => {
    if (options.corruptStorage && path.basename(String(file)) === '.weighin-storage-probe')
      return Buffer.from('truncated temporary file');
    return originalRead(file, ...args);
  };
  const commands = [];
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 1, 0]);
  const names = options.names || ['hello-contract'];
  const packages = names.map((name, index) => {
    const manifest_path = path.join(directory, `crate${index}`, 'Cargo.toml');
    fs.mkdirSync(path.dirname(manifest_path)); fs.writeFileSync(manifest_path, '[package]');
    return { id: `pkg${index}`, name, manifest_path, targets: [{ crate_types: ['cdylib'] }] };
  });
  fs.writeFileSync(path.join(directory, 'Cargo.toml'), '[workspace]');
  const fixtures = path.join(directory, 'fixtures.json');
  const destinations = options.paths || names.map(name => `target/wasm32v1-none/release/${name.replaceAll('-', '_')}.wasm`);
  fs.writeFileSync(fixtures, JSON.stringify({ contracts: destinations.map((wasm_path, i) => ({ id: `contract${i}`, wasm_path, invocations: [{ function_name: 'hello', args: [] }] })) }));
  for (const destination of destinations) {
    fs.mkdirSync(path.dirname(path.join(directory, destination)), { recursive: true });
    fs.writeFileSync(path.join(directory, destination), 'stale artifact');
  }
  exec.exec = async (command, args, config) => {
    commands.push({ command, args, env: config.env });
    const emit = text => config.listeners.stdout(Buffer.from(text));
    if (command === 'rustc') emit(options.rust || 'rustc 1.95.0');
    else if (command === 'cargo') emit(JSON.stringify({ workspace_members: packages.map(pkg => pkg.id), packages }));
    else if (command === 'stellar' && args[0] === '--version') {
      if (options.missingCli) throw new Error('stellar executable not found');
      emit(options.stellar || 'stellar 28.1.0');
    } else if (command === 'stellar') {
      if (options.buildFailure) throw new Error('actual build failed');
      if (options.skippedOptimization) config.listeners.stderr(Buffer.from('Optimization skipped'));
      if (!options.missingOutput) {
        const name = args[args.indexOf('--package') + 1].replaceAll('-', '_');
        fs.writeFileSync(path.join(args[args.indexOf('--out-dir') + 1], `${name}.wasm`), options.badWasm ? 'invalid' : wasm);
      }
      buildReturned = true;
    } else throw new Error('Unexpected command');
    return 0;
  };
  try { await verify({ fixtures, directory, commands, wasm, destinations }); }
  finally { exec.exec = original; fs.fsyncSync = originalFlush; fs.readFileSync = originalRead; fs.rmSync(directory, { recursive: true, force: true }); }
}

test('modern optimized build replaces stale configured WASM with fresh selected-package output', async () => scenario({}, async ({ fixtures, directory, commands, wasm, destinations }) => {
  const results = await buildContracts(fixtures, '1.95.0');
  assert.deepEqual(fs.readFileSync(path.join(directory, destinations[0])), wasm);
  assert.equal(results[0].package, 'hello-contract'); assert.match(results[0].wasm_sha256, /^[a-f0-9]{64}$/);
  const build = commands.find(command => command.command === 'stellar' && command.args[0] === 'contract');
  assert.ok(build.args.includes('--locked')); assert.ok(build.args.includes('--optimize=true'));
  assert.ok(commands.every(command => command.env.RUSTUP_TOOLCHAIN === '1.95.0'));
  assert.equal(commands.some(command => command.args.includes('wasm32-unknown-unknown')), false);
}));
test('multiple workspace contracts select independent packages; repeated package aliases build once', async () => scenario({ names: ['first', 'second'], paths: ['artifacts/first.wasm', 'artifacts/second.wasm', 'other/first.wasm'] }, async ({ fixtures, commands }) => {
  const results = await buildContracts(fixtures);
  assert.deepEqual(results.map(result => result.package), ['first', 'second', 'first']);
  assert.equal(commands.filter(command => command.command === 'stellar' && command.args[0] === 'contract').length, 2);
}));
test('temporary migration alias receives the same fresh WASM from one modern build', async () => scenario({paths:[
  'target/wasm32v1-none/release/hello_contract.wasm',
  'target/wasm32-unknown-unknown/release/hello_contract.wasm',
]},async({fixtures,directory,commands,destinations,wasm})=>{
  const results=await buildContracts(fixtures,'1.95.0');
  assert.equal(results.length,2);assert.equal(results[0].wasm_sha256,results[1].wasm_sha256);
  for(const destination of destinations)assert.deepEqual(fs.readFileSync(path.join(directory,destination)),wasm);
  const builds=commands.filter(command=>command.command==='stellar'&&command.args[0]==='contract');
  assert.equal(builds.length,1);assert.ok(builds[0].args.includes('--optimize=true'));
  assert.equal(commands.some(command=>command.args.includes('wasm32-unknown-unknown')),false);
}));
test('ambiguous Cargo packages are rejected before building', async () => scenario({ names: ['same', 'same'], paths: ['artifacts/same.wasm'] }, async ({ fixtures, commands }) => {
  await assert.rejects(buildContracts(fixtures), /exactly one.*found 2/);
  assert.ok(!commands.some(command => command.args[0] === 'contract'));
}));
test('unknown artifact basename is rejected before building any package', async () => scenario({ paths: ['artifacts/unrelated.wasm'] }, async ({ fixtures }) => {
  await assert.rejects(buildContracts(fixtures), /exactly one.*found 0/);
}));
for (const [label, options, expected] of [
  ['missing CLI', { missingCli: true }, /not found/],
  ['obsolete Rust', { rust: 'rustc 1.83.0' }, /Rust 1.84/],
  ['obsolete CLI', { stellar: 'stellar 25.2.0' }, /Stellar CLI 28.1/],
  ['failed build', { buildFailure: true }, /actual build failed/],
  ['missing output despite stale destination', { missingOutput: true }, /ENOENT/],
  ['invalid WASM output', { badWasm: true }, /valid WASM/],
  ['optimization skipped', { skippedOptimization: true }, /optimization support/],
]) test(`build fails explicitly for ${label}`, async () => scenario(options, async ({ fixtures }) => {
  await assert.rejects(buildContracts(fixtures), expected);
}));
test('every declared contract must have a manifest, even when another one is valid', async () => scenario({}, async ({ fixtures, directory }) => {
  const spec = JSON.parse(fs.readFileSync(fixtures));
  spec.contracts.push({ id: 'missing', wasm_path: path.join(directory, '../no-contract-here/other.wasm'), invocations: [{ function_name: 'hello', args: [] }] });
  fs.writeFileSync(fixtures, JSON.stringify(spec));
  await assert.rejects(buildContracts(fixtures), /No Cargo.toml/);
}));


test('both revisions use verified isolated CLI temporary storage without changing caller environment', async () => scenario({}, async ({ fixtures, commands }) => {
  const callerEnvironment = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  await buildContracts(fixtures, '1.95.0');
  await buildContracts(fixtures, '1.95.0');
  const builds = commands.filter(c => c.command === 'stellar' && c.args[0] === 'contract');
  assert.equal(builds.length, 2);
  assert.notEqual(builds[0].env.TMPDIR, builds[1].env.TMPDIR);
  for (const build of builds) {
    const directory = build.args[build.args.indexOf('--out-dir') + 1];
    assert.equal(build.env.TMPDIR, directory);
    assert.equal(build.env.TEMP, directory); assert.equal(build.env.TMP, directory);
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.equal(fs.existsSync(directory), false, 'Owned build directory must be cleaned');
  }
  assert.deepEqual({ TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }, callerEnvironment);
}));
for (const [label, options, afterBuild] of [
  ['storage flush fails before optimization', { failedStorage: true }, false],
  ['storage contents are truncated before optimization', { corruptStorage: true }, false],
  ['storage flush fails after successful CLI exit', { failedStorage: true, failAfterBuild: true }, true],
]) test(label, async () => scenario(options, async ({ fixtures, directory, commands, destinations }) => {
  const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('weighin-build-')).sort();
  await assert.rejects(buildContracts(fixtures), /Build temporary storage is unusable.*refusing to accept optimizer output/);
  assert.equal(commands.some(c => c.command === 'stellar' && c.args[0] === 'contract'), afterBuild);
  assert.equal(fs.readFileSync(path.join(directory, destinations[0]), 'utf8'), 'stale artifact');
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('weighin-build-')).sort(), before);
}));
test('missing caller temporary-storage directory fails visibly before optimization', async () => scenario({}, async ({ fixtures, directory, commands }) => {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = path.join(directory, 'missing-temp');
  try { await assert.rejects(buildContracts(fixtures), /Cannot create build temporary storage/); }
  finally { if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
  assert.equal(commands.some(c => c.command === 'stellar' && c.args[0] === 'contract'), false);
}));
