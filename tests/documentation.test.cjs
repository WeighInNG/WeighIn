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

const FROZEN_MARKDOWN_EXCLUSIONS = [
  'conversation.md',
  'docs/experiments/',
  // Historical evidence notes captured with "../experiments/" links in merged evidence commits:
  'docs/auth-invocation-evidence.md',
  'docs/runner-stability.md',
];

function isFrozenMarkdownPath(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return FROZEN_MARKDOWN_EXCLUSIONS.some(entry =>
    entry.endsWith('/') ? normalized.startsWith(entry) : normalized === entry
  );
}

function listActiveMarkdownFiles(baseDir) {
  const results = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'bundled', 'target']);
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(path.join(currentDir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = path.relative(baseDir, path.join(currentDir, entry.name)).replace(/\\/g, '/');
        if (!isFrozenMarkdownPath(rel)) results.push(rel);
      }
    }
  }
  walk(baseDir);
  return results.sort();
}

function githubHeadingSlug(headingText) {
  return headingText
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

function extractMarkdownAnchors(markdownText) {
  const withoutCodeFences = markdownText.replace(/```[\s\S]*?```/g, '');
  const counts = new Map();
  const anchors = new Set();
  for (const line of withoutCodeFences.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!match) continue;
    const baseSlug = githubHeadingSlug(match[1]);
    if (!baseSlug) continue;
    if (counts.has(baseSlug)) {
      const nextCount = counts.get(baseSlug) + 1;
      counts.set(baseSlug, nextCount);
      anchors.add(`${baseSlug}-${nextCount}`);
    } else {
      counts.set(baseSlug, 0);
      anchors.add(baseSlug);
    }
  }
  return anchors;
}

function validateMarkdownLinksAndAnchors(baseDir, relFiles) {
  const anchorCache = new Map();
  function getAnchors(absFilePath) {
    if (!anchorCache.has(absFilePath)) {
      anchorCache.set(absFilePath, extractMarkdownAnchors(fs.readFileSync(absFilePath, 'utf8')));
    }
    return anchorCache.get(absFilePath);
  }

  for (const relFile of relFiles) {
    const absSource = path.join(baseDir, relFile);
    const content = fs.readFileSync(absSource, 'utf8');
    const withoutCodeFences = content.replace(/```[\s\S]*?```/g, '');
    for (const match of withoutCodeFences.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || /^(https?:|mailto:)/i.test(rawTarget)) continue;
      const hashIndex = rawTarget.indexOf('#');
      const targetPathPart = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
      const anchorPart = hashIndex === -1 ? null : rawTarget.slice(hashIndex + 1);
      const absTarget = targetPathPart
        ? path.resolve(baseDir, path.dirname(relFile), targetPathPart)
        : absSource;
      const relResolved = path.relative(baseDir, absTarget);
      if (relResolved.startsWith('..') || path.isAbsolute(relResolved)) {
        throw new Error(`${relFile}: link escapes repository root (${rawTarget})`);
      }
      if (!fs.existsSync(absTarget)) {
        throw new Error(`${relFile}: broken relative link target "${rawTarget}"`);
      }
      if (anchorPart !== null) {
        if (!anchorPart) {
          throw new Error(`${relFile}: empty heading anchor in "${rawTarget}"`);
        }
        const stat = fs.statSync(absTarget);
        if (!stat.isFile() || !absTarget.endsWith('.md')) {
          throw new Error(`${relFile}: heading anchor "${rawTarget}" targets non-Markdown path`);
        }
        const validAnchors = getAnchors(absTarget);
        if (!validAnchors.has(anchorPart)) {
          throw new Error(`${relFile}: missing heading anchor "#${anchorPart}" in "${rawTarget}"`);
        }
      }
    }
  }
}

test('all active local Markdown files resolve relative links and heading anchors offline while excluding frozen evidence', () => {
  const activeFiles = listActiveMarkdownFiles(root);
  assert.ok(activeFiles.includes('README.md'));
  assert.ok(activeFiles.includes('CONTRIBUTING.md'));
  assert.ok(activeFiles.includes('docs/EVIDENCE.md'));
  assert.ok(activeFiles.includes('docs/flagship-ci.md'));
  assert.ok(!activeFiles.some(f => f.startsWith('docs/experiments/')));
  assert.ok(!activeFiles.includes('conversation.md'));
  assert.doesNotThrow(() => validateMarkdownLinksAndAnchors(root, activeFiles));
});

test('Markdown link and anchor validator accepts valid anchors/duplicate headings and rejects broken paths or anchors', () => {
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-md-links-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'experiments'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      [
        '# WeighIn Guide',
        '',
        'See [setup](docs/guide.md#setup--install), [second](docs/guide.md#details-1), and [self](#weighin-guide).',
        '',
        '```markdown',
        '[ignored-in-code-fence](docs/nonexistent.md#missing)',
        '```',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'docs/guide.md'),
      [
        '# Guide',
        '## Setup & Install',
        '## Details',
        '## Details',
      ].join('\n'),
      'utf8'
    );
    // Broken link inside frozen evidence directory must be excluded by listActiveMarkdownFiles
    fs.writeFileSync(
      path.join(tmpDir, 'docs/experiments/frozen.md'),
      '[broken-frozen](missing-file.md#missing-anchor)\n',
      'utf8'
    );

    const active = listActiveMarkdownFiles(tmpDir);
    assert.deepEqual(active, ['README.md', 'docs/guide.md']);
    assert.doesNotThrow(() => validateMarkdownLinksAndAnchors(tmpDir, active));

    // 1. Broken relative file link
    fs.writeFileSync(path.join(tmpDir, 'docs/broken-file.md'), 'See [missing](does-not-exist.md).\n', 'utf8');
    assert.throws(
      () => validateMarkdownLinksAndAnchors(tmpDir, listActiveMarkdownFiles(tmpDir)),
      /broken relative link target "does-not-exist\.md"/
    );
    fs.unlinkSync(path.join(tmpDir, 'docs/broken-file.md'));

    // 2. Broken cross-file heading anchor
    fs.writeFileSync(path.join(tmpDir, 'docs/broken-anchor.md'), 'See [bad anchor](guide.md#nonexistent-heading).\n', 'utf8');
    assert.throws(
      () => validateMarkdownLinksAndAnchors(tmpDir, listActiveMarkdownFiles(tmpDir)),
      /missing heading anchor "#nonexistent-heading" in "guide\.md#nonexistent-heading"/
    );
    fs.unlinkSync(path.join(tmpDir, 'docs/broken-anchor.md'));

    // 3. Broken same-file heading anchor
    fs.writeFileSync(path.join(tmpDir, 'docs/broken-self.md'), '# Title\nSee [self](#wrong-title).\n', 'utf8');
    assert.throws(
      () => validateMarkdownLinksAndAnchors(tmpDir, listActiveMarkdownFiles(tmpDir)),
      /missing heading anchor "#wrong-title" in "#wrong-title"/
    );
    fs.unlinkSync(path.join(tmpDir, 'docs/broken-self.md'));

    // 4. Empty anchor
    fs.writeFileSync(path.join(tmpDir, 'docs/empty-anchor.md'), '# Title\nSee [empty](guide.md#).\n', 'utf8');
    assert.throws(
      () => validateMarkdownLinksAndAnchors(tmpDir, listActiveMarkdownFiles(tmpDir)),
      /empty heading anchor in "guide\.md#"/
    );
    fs.unlinkSync(path.join(tmpDir, 'docs/empty-anchor.md'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
