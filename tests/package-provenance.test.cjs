const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['package.json', 'package-lock.json', 'action.yml',
    'src/nested/input.ts', 'native/simulation/Cargo.toml',
    'native/simulation/Cargo.lock', 'native/simulation/src/main.rs',
    'bundled/index.js', 'bundled/comment-action.js']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file.endsWith('.json') ? '{}' : 'fixture\n');
  }
  fs.mkdirSync(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts/package-provenance.cjs');
  fs.copyFileSync(path.resolve(__dirname, '../scripts/package-provenance.cjs'), script);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Provenance test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  const manifestPath = path.join(root, 'provenance-manifest.json');
  const read = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { root, git, run, manifestPath, read };
}

test('unchanged package preserves producer metadata across checkout and toolchain changes', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const recorded = f.read();
  recorded.tools = { node: 'v20.19.0', npm: '10.8.2' };
  fs.writeFileSync(f.manifestPath, JSON.stringify(recorded, null, 2) + '\n');
  const before = fs.readFileSync(f.manifestPath, 'utf8');
  f.git('commit', '--allow-empty', '-m', 'later checkout');
  assert.notEqual(f.git('rev-parse', 'HEAD'), recorded.source_revision);
  assert.equal(f.run('--verify').status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.manifestPath, 'utf8'), before);
  assert.ok(recorded.inputs.some((input) => input.path === 'src/nested/input.ts'));
  assert.ok(recorded.inputs.every((input) => !input.path.includes('\\')));
});

test('changed source, bundle, added and removed inputs fail verification until regenerated', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  for (const mutate of [
    () => fs.appendFileSync(path.join(f.root, 'src/nested/input.ts'), 'changed'),
    () => fs.appendFileSync(path.join(f.root, 'bundled/index.js'), 'changed'),
    () => fs.writeFileSync(path.join(f.root, 'src/added.ts'), 'added'),
    () => fs.unlinkSync(path.join(f.root, 'src/added.ts')),
  ]) {
    const before = f.read().inputs;
    mutate();
    assert.notEqual(f.run('--verify').status, 0);
    assert.equal(f.run().status, 0);
    assert.notDeepEqual(f.read().inputs, before);
    assert.equal(f.run('--verify').status, 0);
  }
});

test('missing or malformed producer metadata fails verification and is repaired by regeneration', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run('--verify').status, 0);
  assert.equal(f.run().status, 0);
  const valid = f.read();
  for (const invalid of ['{', JSON.stringify({ ...valid, schema_version: 2 }),
    JSON.stringify({ ...valid, source_revision: 'invented' }),
    JSON.stringify({ ...valid, tools: {} })]) {
    fs.writeFileSync(f.manifestPath, invalid);
    assert.notEqual(f.run('--verify').status, 0);
    assert.equal(f.run().status, 0);
    assert.equal(f.run('--verify').status, 0);
  }
});
