const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const generator = path.resolve(__dirname, '../scripts/package-provenance.cjs');
const inputFiles = [
  'package.json',
  'package-lock.json',
  'action.yml',
  'src/action.ts',
  'src/nested/measurement.ts',
  'native/simulation/Cargo.toml',
  'native/simulation/Cargo.lock',
  'native/simulation/src/main.rs',
  'bundled/index.js',
  'bundled/comment-action.js',
];

test('package provenance is stable across environments and rejects stale inputs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const script = path.join(root, 'scripts/package-provenance.cjs');
  fs.copyFileSync(generator, script);
  for (const file of inputFiles) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `fixture:${file}\n`);
  }

  const runtimeOverride = path.join(root, 'runtime-override.cjs');
  fs.writeFileSync(
    runtimeOverride,
    'Object.defineProperty(process, "version", { configurable: true, value: process.env.TEST_NODE_VERSION });\n',
  );
  const tool = `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  printf '%s\\n' "$TEST_GIT_HEAD"
elif [ "$1" = "--version" ]; then
  printf '%s\\n' "$TEST_NPM_VERSION"
else
  exit 1
fi
`;
  const environment = (name, gitHead, nodeVersion, npmVersion) => {
    const bin = path.join(root, name);
    fs.mkdirSync(bin);
    for (const command of ['git', 'npm']) {
      const executable = path.join(bin, command);
      fs.writeFileSync(executable, tool);
      fs.chmodSync(executable, 0o755);
    }
    return {
      ...process.env,
      PATH: bin,
      NODE_OPTIONS: `--require=${runtimeOverride}`,
      TEST_GIT_HEAD: gitHead,
      TEST_NODE_VERSION: nodeVersion,
      TEST_NPM_VERSION: npmVersion,
    };
  };
  const firstEnvironment = environment(
    'environment-a',
    '1111111111111111111111111111111111111111',
    'v24.21.0',
    '11.19.0',
  );
  const secondEnvironment = environment(
    'environment-b',
    '2222222222222222222222222222222222222222',
    'v22.23.1',
    '10.9.4',
  );
  const run = (args, env) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
  const manifestPath = path.join(root, 'provenance-manifest.json');

  const generated = run([], firstEnvironment);
  assert.equal(generated.status, 0, generated.stderr);
  const firstManifest = fs.readFileSync(manifestPath, 'utf8');
  const regenerated = run([], secondEnvironment);
  assert.equal(regenerated.status, 0, regenerated.stderr);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), firstManifest);
  assert.equal(run(['--verify'], secondEnvironment).status, 0);

  for (const file of inputFiles) {
    fs.appendFileSync(path.join(root, file), 'changed\n');
    const stale = run(['--verify'], secondEnvironment);
    assert.notEqual(stale.status, 0, `${file} must invalidate the manifest`);
    const refreshed = run([], firstEnvironment);
    assert.equal(refreshed.status, 0, refreshed.stderr);
  }
  assert.equal(run(['--verify'], secondEnvironment).status, 0);
});
