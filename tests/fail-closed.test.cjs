const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateConfig, loadConfig, enforceThresholds } = require('../dist/threshold');
const { diffBenchmarks } = require('../dist/diff');
const { parseFixtures } = require('../dist/identity');

const policy = '[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\n';
const captured = require('../docs/experiments/native-integration/base.json');
const control = diffBenchmarks(captured, structuredClone(captured));

test('configuration rejects unsupported rules and typos even without regressions', () => {
  for (const rule of ['typo', 'allow_1.2.3_percent_increase', 'allow_-1_percent_increase', -1, Infinity, NaN, true]) {
    assert.throws(() => enforceThresholds(control, { thresholds: { functions: { hello: { cpu_instructions: rule } } } }));
  }
  for (const config of [
    { threshold: {} }, { thresholds: { global: { fail_on_any_regression: 'false' } } },
    { thresholds: { global: { max_allowed_cpu_increase_pct: -1 } } },
    { thresholds: { functions: { hello: { cpu_instruction: 'ignore' } } } },
  ]) assert.throws(() => validateConfig(config));
});
test('valid percentage policies handle exact caps and scientific numeric notation', () => {
  for (const rule of [0, 1e-7, 'allow_2.5_percent_increase', 'ignore', 'strict_zero_tolerance']) {
    assert.deepEqual(enforceThresholds(control, { thresholds: { functions: { hello: { cpu_instructions: rule } } } }), []);
  }
  const head = structuredClone(captured);
  head[0].benchmarks[0].metrics.cpu_instructions.consumed *= 2;
  const diff = diffBenchmarks(captured, head);
  for (const rule of [100, 'allow_100_percent_increase']) assert.equal(enforceThresholds(diff, { thresholds: { functions: { hello: { cpu_instructions: rule } } } }).length, 0);
  assert.equal(enforceThresholds(diff, { thresholds: { functions: { hello: { cpu_instructions: 99 } } } }).length, 1);
});
test('policy referring to an unpaired function cannot silently pass', () => {
  assert.throws(() => enforceThresholds(control, { thresholds: { functions: { typo: { cpu_instructions: 10 } } } }), /no matched/);
  assert.throws(() => enforceThresholds(diffBenchmarks([], captured), { thresholds: { global: { max_allowed_cpu_increase_pct: 10 } } }), /no matched/);
});
test('empty fixture suites and contracts are rejected; zero argument invocations remain valid', () => {
  assert.throws(() => parseFixtures('{"contracts":[]}', 'fixtures.json'));
  assert.throws(() => parseFixtures('{"contracts":[{"wasm_path":"contract.wasm","invocations":[]}]}', 'fixtures.json'));
  assert.equal(parseFixtures('{"contracts":[{"wasm_path":"contract.wasm","invocations":[{"function_name":"hello","args":[]}]}]}', 'fixtures.json').contracts.length, 1);
});

function action(mode, config = policy) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-action-unit-'));
  try {
    for (const name of ['head', 'base']) {
      const directory = path.join(temporary, name);
      fs.mkdirSync(path.join(directory, 'contract'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'contract/Cargo.toml'), '[package]\nname="unit"\nversion="0.0.0"');
      if (!(name === 'base' && mode === 'missing-fixtures') && !(name === 'head' && mode === 'head-fixtures')) {
        fs.writeFileSync(path.join(directory, 'fixtures.json'), name === 'base' && mode === 'malformed-fixtures' ? '{broken'
          : JSON.stringify({ contracts: name === 'base' && mode === 'empty-fixtures' ? [] : [{ wasm_path: 'contract/contract.wasm', invocations: [{ function_name: 'hello', args: [] }] }] }));
      }
    }
    if (config !== null) fs.writeFileSync(path.join(temporary, 'head/weighin.toml'), config);
    const output = path.join(temporary, 'outputs'), summary = path.join(temporary, 'summary');
    fs.writeFileSync(output, ''); fs.writeFileSync(summary, '');
    const processResult = spawnSync(process.execPath, ['--require', path.resolve(__dirname, 'support/action-unit-hook.cjs'), path.resolve(__dirname, '../dist/action.js')], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, WEIGHIN_UNIT_MODE: mode, WEIGHIN_UNIT_BASE: path.join(temporary, 'base'), TMPDIR: temporary,
        GITHUB_WORKSPACE: path.join(temporary, 'head'), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
        'INPUT_FIXTURES-PATH': 'fixtures.json', 'INPUT_CONFIG-PATH': 'weighin.toml', 'INPUT_GITHUB-TOKEN': '', 'INPUT_BASE-REF': 'main' },
    });
    assert.ifError(processResult.error);
    return { ...processResult, output: fs.readFileSync(output, 'utf8'), summary: fs.readFileSync(summary, 'utf8'), missingConfig: loadConfig(path.join(temporary, 'missing.toml')) };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
for (const [mode, message] of [
  ['checkout', /unit checkout failure/], ['worktree', /unit worktree failure/],
  ['build', /unit base build failure/], ['measurement', /unit base measurement failure/],
  ['missing-fixtures', /fixtures-path not found in base/], ['schema', /Version 2\/3/],
  ['provenance', /Invalid compute provenance/], ['empty', /No matched/], ['unmatched', /No matched/],
  ['head-measurement', /HEAD measurement failed/], ['head-fixtures', /fixtures-path not found/],
  ['malformed-fixtures', /Required BASE comparison failed/], ['empty-fixtures', /Required BASE comparison failed/],
]) test(`Action exits 1 and reports failure for ${mode}`, () => {
  const result = action(mode);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.output, /fail/); assert.doesNotMatch(result.output, /no-baseline|pass/);
  assert.match(result.summary, message); assert.match(result.summary, /No passing comparison/);
});
for (const config of ['not valid toml = ', '[thresholds.functions.hello]\ncpu_instructions="typo"', '[thresholds.global]\nfail_on_any_regression="false"']) {
  test(`Action fails malformed policy: ${config}`, () => {
    const result = action('control', config);
    assert.equal(result.status, 1); assert.match(result.output, /fail/); assert.match(result.summary, /comparison failed/);
  });
}
test('Action unchanged control and optional absent policy still pass; regression fails', () => {
  assert.equal(action('control').status, 0);
  const absent = action('control', null); assert.equal(absent.status, 0); assert.equal(absent.missingConfig, null);
  const regression = action('regression'); assert.equal(regression.status, 1); assert.match(regression.summary, /increased/);
});
