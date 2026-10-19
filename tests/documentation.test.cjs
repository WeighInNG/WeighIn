const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const yaml = require('yaml'), TOML = require('toml');
const { parseFixtures } = require('../dist/identity');
const { validateConfig } = require('../dist/threshold');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const mainDocs = ['README.md', 'CONTRIBUTING.md', 'docs/EVIDENCE.md', 'docs/KNOWN_LIMITATIONS.md', 'docs/architecture.md', 'docs/DEPENDENCY_SECURITY.md', 'docs/repeatability.md', 'docs/ledger-variation.md'];

test('public reviewer path resolves product documentation and retained evidence without internal notes', () => {
  for (const file of mainDocs) {
    const text = read(file);
    assert.doesNotMatch(text, /WEIGHIN_PROGRESS|DRIPS_APPEAL_CONTEXT|Drips|appeal preparation/);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^https?:/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
    }
  }
  assert.ok(read('README.md').includes('(docs/EVIDENCE.md)'));
  assert.ok(read('README.md').includes('(docs/KNOWN_LIMITATIONS.md)'));
  assert.ok(read('docs/EVIDENCE.md').includes('/actions/runs/37777040210'));
  assert.ok(read('docs/KNOWN_LIMITATIONS.md').includes('(ledger-variation.md)'));
  assert.ok(read('docs/repeatability.md').includes('(ledger-variation.md)'));
  assert.ok(read('docs/EVIDENCE.md').includes('(ledger-variation.md)'));
});

test('README fixture and policy examples parse with the current public runtime API', () => {
  const markdown = read('README.md');
  const fixtures = parseFixtures(markdown.match(/```json\n([\s\S]*?)```/)[1], 'weighin-fixtures.json');
  assert.equal(fixtures.fixture_id, 'id:greeting-suite');
  assert.equal(fixtures.contracts[0].logical_id, 'id:greeting');
  assert.equal(fixtures.contracts[0].invocations[0].case_id, 'id:world');
  assert.equal(fixtures.contracts[0].invocations[0].function_name, 'hello');
  for (const match of markdown.matchAll(/```toml\n([\s\S]*?)```/g)) assert.doesNotThrow(() => validateConfig(TOML.parse(match[1])));
});

test('documented Action inputs, outputs and workflow snippets use supported names', () => {
  const action = yaml.parse(read('action.yml'));
  const markdown = read('README.md');
  for (const input of Object.keys(action.inputs)) assert.ok(markdown.includes(`| \`${input}\` |`), input);
  for (const output of Object.keys(action.outputs)) assert.ok(markdown.includes(`\`${output}\``), output);
  for (const match of markdown.matchAll(/```yaml\n([\s\S]*?)```/g)) {
    for (const step of yaml.parse(match[1])) for (const name of Object.keys(step.with || {})) assert.ok(action.inputs[name], name);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const file of mainDocs) for (const match of read(file).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) assert.ok(scripts[match[1]], `${file}: ${match[1]}`);
  for (const workflow of fs.readdirSync(path.join(root, '.github/workflows'))) yaml.parse(read(`.github/workflows/${workflow}`));
});

test('package metadata declares license, repository, and node engine consistent with docs and CI', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(pkg.repository, {
    type: 'git',
    url: 'https://github.com/WeighInNG/WeighIn.git',
  });
  assert.equal(pkg.engines?.node, '>=24.0.0');

  // Verify LICENSE file
  const licenseText = read('LICENSE');
  assert.match(licenseText, /Apache License\s+Version 2.0/);

  // Verify CONTRIBUTING.md documents Node 24 and repo clone URL
  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /Node 24/);
  assert.match(contributing, /git clone https:\/\/github\.com\/WeighInNG\/WeighIn\.git/);

  // Verify CI workflows use Node 24
  const ciWorkflow = read('.github/workflows/ci.yml');
  assert.match(ciWorkflow, /node-version:\s*24/);
});
