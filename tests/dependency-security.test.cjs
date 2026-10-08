const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('policy parser rejects scalar prototype traversal without polluting the process', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const TOML = require('toml');
    for (const payload of [
      '[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__]\\nweighin_polluted = "yes"',
      'aa = 1\\n[[a]]\\n[aa.__proto__.__proto__]\\nweighin_polluted = "yes"'
    ]) {
      assert.throws(() => TOML.parse(payload));
      assert.equal(({}).weighin_polluted, undefined);
    }
  `], { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('policy parser accepts supported named, decimal and absolute cap configurations', () => {
  const TOML = require('toml');
  const { validateConfig } = require('../dist/threshold');
  const config = TOML.parse('[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\nmemory_bytes="allow_2.5_percent_increase"\n[limits.functions.hello]\ncpu_instructions=350000');
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(config.limits.functions.hello.cpu_instructions, 350000);
  assert.equal(config.thresholds.functions.hello.memory_bytes, 'allow_2.5_percent_increase');
});
