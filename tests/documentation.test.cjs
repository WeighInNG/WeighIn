const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const yaml = require('yaml'), TOML = require('toml');
const { parseFixtures } = require('../dist/identity');
const { validateConfig } = require('../dist/threshold');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mainDocs = ['README.md', 'CONTRIBUTING.md', 'docs/EVIDENCE.md', 'docs/KNOWN_LIMITATIONS.md', 'docs/architecture.md', 'docs/DEPENDENCY_SECURITY.md', 'docs/repeatability.md', 'docs/ledger-variation.md'];

const FROZEN_EVIDENCE_PREFIXES = ['docs/experiments/'];

function listActiveMarkdownDocs(repoRoot = root) {
  const candidates = ['README.md', 'CONTRIBUTING.md'];
  const walk = relDir => {
    for (const entry of fs.readdirSync(path.join(repoRoot, relDir), { withFileTypes: true })) {
      const relPath = path.posix.join(relDir, entry.name);
      if (FROZEN_EVIDENCE_PREFIXES.some(prefix => relPath.startsWith(prefix))) continue;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.isFile() && entry.name.endsWith('.md')) candidates.push(relPath);
    }
  };
  walk('docs');
  return candidates.sort();
}

function slugifyHeading(raw) {
  return raw
    .trim()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function extractHeadingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  const stripped = markdown.replace(/```[\s\S]*?```/g, '');
  for (const line of stripped.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = slugifyHeading(match[1]);
    if (!base) continue;
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return anchors;
}

function validateMarkdownLinksAndAnchors(docFiles, readDoc = read, repoRoot = root) {
  const failures = [];
  for (const file of docFiles) {
    const stripped = readDoc(file).replace(/```[\s\S]*?```/g, '');
    for (const match of stripped.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim();
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue;
      const hashIndex = href.indexOf('#');
      const relTarget = hashIndex === -1 ? href : href.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? '' : href.slice(hashIndex + 1);
      const resolvedPath = relTarget
        ? path.resolve(repoRoot, path.dirname(file), relTarget)
        : path.resolve(repoRoot, file);
      if (!fs.existsSync(resolvedPath)) {
        failures.push(`${file}: missing link target "${href}"`);
        continue;
      }
      if (anchor) {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile() || !resolvedPath.endsWith('.md')) {
          failures.push(`${file}: anchor "#${anchor}" requires a Markdown file target ("${href}")`);
          continue;
        }
        const targetRel = path.relative(repoRoot, resolvedPath).split(path.sep).join('/');
        const targetContent = targetRel === file ? readDoc(file) : fs.readFileSync(resolvedPath, 'utf8');
        const anchors = extractHeadingAnchors(targetContent);
        if (!anchors.has(anchor)) {
          failures.push(`${file}: missing heading anchor "#${anchor}" in "${href}"`);
        }
      }
    }
  }
  return failures;
}

test('public reviewer path resolves product documentation and retained evidence without internal notes', () => {
  const activeDocs = listActiveMarkdownDocs();
  assert.ok(activeDocs.length >= mainDocs.length);
  for (const file of mainDocs) {
    assert.ok(activeDocs.includes(file), `expected ${file} in active docs`);
  }
  for (const file of activeDocs) {
    const text = read(file);
    assert.doesNotMatch(text, /WEIGHIN_PROGRESS|DRIPS_APPEAL_CONTEXT|Drips|appeal preparation/);
  }
  const linkFailures = validateMarkdownLinksAndAnchors(activeDocs);
  assert.deepEqual(linkFailures, []);
  assert.ok(read('README.md').includes('(docs/EVIDENCE.md)'));
  assert.ok(read('README.md').includes('(docs/KNOWN_LIMITATIONS.md)'));
  assert.ok(read('docs/EVIDENCE.md').includes('/actions/runs/37777040210'));
  assert.ok(read('README.md').includes('report and metadata paths are read from the caller\'s working directory'));
  assert.match(read('docs/architecture.md'), /independently of the caller's current working\s+directory/);
  assert.ok(read('docs/KNOWN_LIMITATIONS.md').includes('(ledger-variation.md)'));
  assert.ok(read('docs/repeatability.md').includes('(ledger-variation.md)'));
  assert.ok(read('docs/EVIDENCE.md').includes('(ledger-variation.md)'));
});

test('markdown link and anchor validator rejects broken relative files, missing anchors, and non-markdown anchor targets (#168)', () => {
  const virtualDocs = {
    'README.md': [
      '# Overview',
      '## Quick Start',
      '### Repeated Heading',
      '### Repeated Heading',
      'Valid internal [start](#quick-start) and duplicate [second](#repeated-heading-1).',
      'Valid cross-doc [evidence](docs/EVIDENCE.md#reproduction).',
      'Broken file [missing](docs/DOES_NOT_EXIST.md).',
      'Broken anchor [bad-anchor](docs/EVIDENCE.md#no-such-section).',
      'Broken self anchor [bad-self](#missing-local-anchor).',
      'Broken directory anchor [dir-anchor](docs#section).',
      '```markdown',
      '[ignored inside code fence](docs/IGNORED_MISSING.md#ignored)',
      '```',
    ].join('\n'),
  };
  const failures = validateMarkdownLinksAndAnchors(
    ['README.md'],
    file => virtualDocs[file] ?? read(file),
    root,
  );
  assert.deepEqual(failures, [
    'README.md: missing link target "docs/DOES_NOT_EXIST.md"',
    'README.md: missing heading anchor "#no-such-section" in "docs/EVIDENCE.md#no-such-section"',
    'README.md: missing heading anchor "#missing-local-anchor" in "#missing-local-anchor"',
    'README.md: anchor "#section" requires a Markdown file target ("docs#section")',
  ]);
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
  const commentAction = yaml.parse(read('comment/action.yml'));
  const markdown = read('README.md');
  const documentedInputCells = new Set(
    markdown.split('\n').filter((line) => line.startsWith('|')).map((line) => line.split('|')[1].trim()),
  );
  for (const input of Object.keys(action.inputs)) assert.ok(documentedInputCells.has(`\`${input}\``), input);
  for (const output of Object.keys(action.outputs)) assert.ok(markdown.includes(`\`${output}\``), output);
  for (const match of markdown.matchAll(/```yaml\n([\s\S]*?)```/g)) {
    for (const step of yaml.parse(match[1])) for (const name of Object.keys(step.with || {})) assert.ok(action.inputs[name], name);
  }

  // Verify runtime wiring parity for both Action entry points (#169)
  const mainRuntime = fs.readFileSync(path.join(root, 'src/action.ts'), 'utf8');
  const commentRuntime = fs.readFileSync(path.join(root, 'src/comment-action.ts'), 'utf8');
  for (const input of Object.keys(action.inputs)) {
    assert.ok(
      mainRuntime.includes(`"${input}"`) || mainRuntime.includes(`'${input}'`),
      `action.yml input ${input} must be wired into src/action.ts`,
    );
  }
  for (const output of Object.keys(action.outputs)) {
    assert.ok(
      mainRuntime.includes(`setOutput("${output}"`) || mainRuntime.includes(`setOutput('${output}'`),
      `action.yml output ${output} must be emitted by src/action.ts`,
    );
  }
  for (const input of Object.keys(commentAction.inputs)) {
    assert.ok(
      commentRuntime.includes(`"${input}"`) || commentRuntime.includes(`'${input}'`),
      `comment/action.yml input ${input} must be wired into src/comment-action.ts`,
    );
  }

  const scripts = JSON.parse(read('package.json')).scripts;
  for (const file of mainDocs) for (const match of read(file).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) assert.ok(scripts[match[1]], `${file}: ${match[1]}`);
  for (const workflow of fs.readdirSync(path.join(root, '.github/workflows'))) yaml.parse(read(`.github/workflows/${workflow}`));
});
