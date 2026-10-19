const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const yaml = require('yaml'), TOML = require('toml');
const { parseFixtures } = require('../dist/identity');
const { validateConfig } = require('../dist/threshold');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Explicit recorded list of frozen evidence content excluded from active doc validation
const frozenEvidenceList = [
  'conversation.md',
  'docs/experiments',
];

function isFrozenEvidence(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  return frozenEvidenceList.some(excluded => norm === excluded || norm.startsWith(excluded + '/'));
}

function extractHeadings(content) {
  const headings = new Set();
  const slugCounts = new Map();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (!match) continue;
    let headingText = match[1].trim();
    // remove markdown links inside headings [title](url) -> title
    headingText = headingText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // strip markdown formatting
    headingText = headingText.replace(/[`*_~]/g, '');
    // GitHub anchor slug: lowercase, strip punctuation except - and space, replace whitespace with -
    let slug = headingText
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!slug) continue;

    if (slugCounts.has(slug)) {
      const count = slugCounts.get(slug) + 1;
      slugCounts.set(slug, count);
      headings.add(`${slug}-${count}`);
    } else {
      slugCounts.set(slug, 0);
      headings.add(slug);
    }
  }
  return headings;
}

function getMaintainedDocs(dir = root) {
  const results = [];
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'bundled') continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (isFrozenEvidence(relPath)) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        results.push(relPath);
      }
    }
  }
  walk(dir);
  return results.sort();
}

function validateMarkdownLinks(filePath, content, options = {}) {
  const fileDir = path.dirname(path.resolve(root, filePath));
  const headingsCache = options.headingsCache || new Map();
  const errors = [];

  for (const match of content.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const rawTarget = match[2].trim();
    if (/^(https?:|mailto:|tel:)/.test(rawTarget)) continue;

    const [relPath, anchor] = rawTarget.split('#');
    const targetFile = relPath ? path.resolve(fileDir, relPath) : path.resolve(root, filePath);

    if (!fs.existsSync(targetFile)) {
      errors.push(`Broken link in ${filePath}: target file does not exist -> ${rawTarget}`);
      continue;
    }

    if (anchor) {
      const stat = fs.statSync(targetFile);
      if (stat.isDirectory()) {
        errors.push(`Broken link in ${filePath}: anchor #${anchor} specified on directory ${rawTarget}`);
        continue;
      }
      let targetHeadings = headingsCache.get(targetFile);
      if (!targetHeadings) {
        targetHeadings = extractHeadings(fs.readFileSync(targetFile, 'utf8'));
        headingsCache.set(targetFile, targetHeadings);
      }
      if (!targetHeadings.has(anchor.toLowerCase())) {
        errors.push(`Broken anchor in ${filePath}: #${anchor} not found in ${path.relative(root, targetFile)}`);
      }
    }
  }

  return errors;
}

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

test('validate relative links and actual heading anchor targets across all maintained docs without network access', () => {
  const maintained = getMaintainedDocs();
  assert.ok(maintained.length >= 30, `Expected maintained docs to be discovered, found ${maintained.length}`);
  const headingsCache = new Map();
  const allErrors = [];

  for (const file of maintained) {
    const content = read(file);
    const errors = validateMarkdownLinks(file, content, { headingsCache });
    if (errors.length > 0) {
      allErrors.push(...errors);
    }
  }

  assert.deepEqual(allErrors, [], `Found broken relative links or anchors:\n${allErrors.join('\n')}`);
});

test('link validator fails on broken relative target file', () => {
  const syntheticContent = 'See [Missing Target](./does-not-exist-fixture.md) for details.';
  const errors = validateMarkdownLinks('docs/architecture.md', syntheticContent);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /target file does not exist -> \.\/does-not-exist-fixture\.md/);
});

test('link validator fails on broken heading anchor target', () => {
  const syntheticContent = 'See [Valid Target with Bad Anchor](./docs/architecture.md#this-anchor-does-not-exist) for details.';
  const errors = validateMarkdownLinks('README.md', syntheticContent);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Broken anchor in README\.md: #this-anchor-does-not-exist not found in docs\/architecture\.md/);
});

test('explicit recorded list excludes frozen evidence content from maintained doc checks', () => {
  assert.equal(isFrozenEvidence('conversation.md'), true);
  assert.equal(isFrozenEvidence('docs/experiments/build-storage-safeguard/control-1/summary.md'), true);
  assert.equal(isFrozenEvidence('README.md'), false);
  assert.equal(isFrozenEvidence('docs/architecture.md'), false);

  const maintained = getMaintainedDocs();
  for (const doc of maintained) {
    assert.equal(isFrozenEvidence(doc), false, `Maintained docs must not contain frozen evidence: ${doc}`);
  }
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
