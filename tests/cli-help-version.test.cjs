const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');

// --help/-h and --version are standalone, offline invocations: they must exit 0
// before the Git probe, fixture reads, RPC requests or native-helper setup.
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const bin = path.resolve(root, pkg.bin.weighin);

// An empty working directory outside any Git repository, and a fake `git` on PATH
// that leaves a marker when the CLI probes the commit.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-cli-help-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'work'), fakeBin = path.join(dir, 'bin'), marker = path.join(dir, 'git-probed');
  fs.mkdirSync(cwd); fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'git'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
  const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], {
    cwd, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, ...env },
  });
  return { cwd, marker, run };
}

function assertNoSideEffects(box, r) {
  assert.doesNotMatch(r.stdout + r.stderr, /Starting Weighin Benchmarking|Benchmarking failed/);
  assert.deepEqual(fs.readdirSync(box.cwd), [], 'no result file or other output is written');
  assert.equal(fs.existsSync(box.marker), false, 'Git is not probed');
}

for (const flag of ['--help', '-h']) {
  test(`weighin ${flag} prints usage and exits 0 without measuring`, (t) => {
    const box = sandbox(t);
    const r = box.run([flag]);
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^Usage: weighin \[fixtures\.json\] \[results\.json \| -\] \[options\]/);
    for (const text of ['--rpc-url <url>', '--output <file | ->', '--stdout, --json-stdout', '-h, --help', '--version',
      '(default: weighin-fixtures.json)', '(default: weighin-results.json)', '(default: http://localhost:8000/rpc)']) {
      assert.ok(r.stdout.includes(text), `help mentions ${text}`);
    }
    assert.match(r.stdout, /does not build contracts, compare revisions, enforce thresholds\s+or post pull request comments/);
    assertNoSideEffects(box, r);
  });
}

test('weighin --version prints the package version and exits 0 without measuring', (t) => {
  const box = sandbox(t);
  const r = box.run(['--version']);
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${pkg.version}\n`);
  assertNoSideEffects(box, r);
});

test('the Git probe marker works: a measurement run does probe Git', (t) => {
  const box = sandbox(t);
  const r = box.run(['missing.json', '--output', 'results.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Benchmarking failed/);
  assert.equal(fs.existsSync(box.marker), true);
});

test('--version reads the installed package metadata, not a constant', (t) => {
  // A copy of the built CLI installed next to a package.json with another version.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-cli-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'weighin', version: '0.0.0-metadata-check' }));
  const r = spawnSync(process.execPath, [path.join(dir, 'dist', 'cli.js'), '--version'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '0.0.0-metadata-check\n');
});
