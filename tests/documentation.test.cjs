const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const yaml = require('yaml'), TOML = require('toml');
const { parseFixtures } = require('../dist/identity');
const { validateConfig } = require('../dist/threshold');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mainDocs = ['README.md', 'CONTRIBUTING.md', 'docs/EVIDENCE.md', 'docs/KNOWN_LIMITATIONS.md', 'docs/architecture.md', 'docs/DEPENDENCY_SECURITY.md'];

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

// Explicit reviewable exception list for optional conditional outputs or artifact files
// that are only produced under specific runtime conditions (e.g. pull_request context).
const OPTIONAL_CONDITIONAL_OUTPUT_EXCEPTIONS = Object.freeze({
  'action.yml': Object.freeze([]),
  'comment/action.yml': Object.freeze([]),
});

function extractRuntimeWiring(sourceText) {
  const inputs = new Set();
  const outputs = new Set();
  for (const match of sourceText.matchAll(/\b(?:getInput|parseOptionalBooleanInput)\(\s*["']([a-z0-9-]+)["']/g)) {
    inputs.add(match[1]);
  }
  for (const match of sourceText.matchAll(/\bsetOutput\(\s*["']([a-z0-9-]+)["']/g)) {
    outputs.add(match[1]);
  }
  return { inputs: [...inputs].sort(), outputs: [...outputs].sort() };
}

function verifyActionParity(specRelPath, declareSpec, sourceText, bundleText) {
  const declaredInputs = Object.keys(declareSpec.inputs || {}).sort();
  const declaredOutputs = Object.keys(declareSpec.outputs || {}).sort();
  const conditionalExceptions = new Set(OPTIONAL_CONDITIONAL_OUTPUT_EXCEPTIONS[specRelPath] || []);
  for (const exception of conditionalExceptions) {
    if (!declaredOutputs.includes(exception)) {
      throw new Error(`${specRelPath}: exception "${exception}" is not a declared output`);
    }
  }
  const sourceWiring = extractRuntimeWiring(sourceText);
  const bundleWiring = extractRuntimeWiring(bundleText);

  assert.deepEqual(
    sourceWiring.inputs,
    declaredInputs,
    `${specRelPath}: source runtime inputs must match declared action.yml inputs`
  );
  assert.deepEqual(
    bundleWiring.inputs,
    declaredInputs,
    `${specRelPath}: bundled runtime inputs must match declared action.yml inputs`
  );

  const requiredRuntimeOutputs = declaredOutputs.filter(name => !conditionalExceptions.has(name));
  for (const outputName of requiredRuntimeOutputs) {
    assert.ok(
      sourceWiring.outputs.includes(outputName),
      `${specRelPath}: declared output "${outputName}" is never emitted in source`
    );
    assert.ok(
      bundleWiring.outputs.includes(outputName),
      `${specRelPath}: declared output "${outputName}" is never emitted in bundle`
    );
  }
  for (const emitted of [...sourceWiring.outputs, ...bundleWiring.outputs]) {
    assert.ok(
      declaredOutputs.includes(emitted),
      `${specRelPath}: runtime emits undeclared output "${emitted}"`
    );
  }
}

test('both Action entry points enforce exact declared input/output parity against source and bundled wiring', () => {
  const mainActionSpec = yaml.parse(read('action.yml'));
  const commentActionSpec = yaml.parse(read('comment/action.yml'));

  assert.equal(mainActionSpec.runs.main, 'bundled/index.js');
  assert.equal(commentActionSpec.runs.main, '../bundled/comment-action.js');

  verifyActionParity('action.yml', mainActionSpec, read('src/action.ts'), read('bundled/index.js'));
  verifyActionParity('comment/action.yml', commentActionSpec, read('src/comment-action.ts'), read('bundled/comment-action.js'));

  // Negative parity checks: undeclared runtime input, unread declared input, and undeclared output fail
  assert.throws(
    () => verifyActionParity('action.yml', mainActionSpec, read('src/action.ts') + '\ncore.getInput("undeclared-flag");', read('bundled/index.js')),
    /source runtime inputs must match declared/
  );
  assert.throws(
    () => verifyActionParity(
      'action.yml',
      { ...mainActionSpec, inputs: { ...mainActionSpec.inputs, 'phantom-input': { required: false, default: '' } } },
      read('src/action.ts'),
      read('bundled/index.js')
    ),
    /source runtime inputs must match declared/
  );
  assert.throws(
    () => verifyActionParity('action.yml', mainActionSpec, read('src/action.ts') + '\ncore.setOutput("undeclared-output", "x");', read('bundled/index.js')),
    /runtime emits undeclared output "undeclared-output"/
  );
});

test('bundled Action entry points exercise omitted defaults, required input checks, and emitted outputs', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-parity-bundle-'));
  try {
    // 1. Main bundled Action with omitted optional inputs (using defaults) and missing required fixtures-path
    const out1 = path.join(tmpDir, 'out1.txt');
    fs.writeFileSync(out1, '', 'utf8');
    const mainMissingReq = spawnSync(
      process.execPath,
      [path.join(root, 'bundled/index.js')],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: tmpDir,
          GITHUB_OUTPUT: out1,
          'INPUT_FIXTURES-PATH': '',
          'INPUT_UNSUPPORTED-EXTRA': 'ignored-value',
        },
      }
    );
    assert.equal(mainMissingReq.status, 1);
    assert.match(mainMissingReq.stdout + mainMissingReq.stderr, /Input required and not supplied: fixtures-path/);
    const out1Content = fs.readFileSync(out1, 'utf8');
    assert.match(out1Content, /result[\s\S]*fail/);
    assert.match(out1Content, /diff-json[\s\S]*\{\}/);

    // 2. Comment bundled Action with omitted required input fails explicitly
    const commentMissingReq = spawnSync(
      process.execPath,
      [path.join(root, 'bundled/comment-action.js')],
      {
        cwd: tmpDir,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          'INPUT_REPORT-PATH': '',
          'INPUT_METADATA-PATH': 'pr-metadata.json',
          'INPUT_GITHUB-TOKEN': 'token',
        },
      }
    );
    assert.equal(commentMissingReq.status, 1);
    assert.match(commentMissingReq.stdout + commentMissingReq.stderr, /Input required and not supplied: report-path/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
