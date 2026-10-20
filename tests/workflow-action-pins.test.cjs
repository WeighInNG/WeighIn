const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
// The check governs the active workflow directory only. Frozen experiment
// snapshots under docs/experiments are historical evidence and stay untouched.
const workflowDir = '.github/workflows';
const snapshotDir = 'docs/experiments';
const SHA = /^[0-9a-f]{40}$/;
const OFFICIAL = 'https://github.com/';

// Reviewed references. Each commit was resolved from the official repository's
// own tag or branch (git ls-remote, confirmed through the upstream commit API);
// nothing here was written from memory.
const reviewed = {
  'actions/checkout': ['11d5960a326750d5838078e36cf38b85af677262'],
  'actions/setup-node': ['49933ea5288caeca8642d1e84afbd3f7d6820020'],
  'actions/upload-artifact': ['ea165f8d65b6e75b540449e92b4886f43607fa02'],
  'actions/download-artifact': ['d3f86a106a0bac45b974a628896c90dbdf5c8093'],
  'actions/cache': ['0057852bfaa89a56745cba8c7296529d2fc39830'],
  'dtolnay/rust-toolchain': ['d1031067263f94b142dd6c0ce24c5eb9d02d52a0', '683b588c487a69d01f6c6ddf40f036ff682cc2c8'],
  'WeighInNG/WeighIn': ['bbbe9001bbd375fd6a1ff75be5da2593c86fff20'],
  'WeighInNG/WeighIn/comment': ['bbbe9001bbd375fd6a1ff75be5da2593c86fff20'],
};

// The moving refs this change retired, kept so the review stays documented.
const originalMovingRefs = [
  'actions/checkout@v4',
  'actions/setup-node@v4',
  'actions/upload-artifact@v4',
  'actions/download-artifact@v4',
  'dtolnay/rust-toolchain@master',
];

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = file => YAML.parse(read(path.join(workflowDir, file)));
const workflowFiles = () => fs.readdirSync(path.join(root, workflowDir)).filter(name => /\.ya?ml$/.test(name)).sort();

function usesIn(node, found = []) {
  if (Array.isArray(node)) { for (const item of node) usesIn(item, found); return found; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses' && typeof value === 'string') found.push(value);
      else usesIn(value, found);
    }
  }
  return found;
}

// Local (./...) and container (docker://...) references are not third-party
// GitHub Actions and keep their existing form.
function thirdParty(uses) {
  if (uses.startsWith('./') || uses.startsWith('docker://')) return null;
  const at = uses.lastIndexOf('@');
  return { action: uses.slice(0, at), ref: uses.slice(at + 1) };
}

function activeInventory() {
  const violations = [], found = new Set();
  for (const file of workflowFiles()) {
    const document = parse(file);
    assert.ok(document && typeof document === 'object', `${file} must parse as YAML`);
    for (const uses of usesIn(document)) {
      const target = thirdParty(uses);
      if (!target) continue;
      found.add(uses);
      if (target.ref.includes('${{')) violations.push(`${file}: dynamic reference ${uses}`);
      else if (!SHA.test(target.ref)) violations.push(`${file}: moving third-party reference ${uses}`);
      else if (!reviewed[target.action]) violations.push(`${file}: unreviewed Action ${uses}`);
      else if (!reviewed[target.action].includes(target.ref)) violations.push(`${file}: ${target.ref} is not a reviewed ${target.action} commit`);
    }
  }
  return { violations, found };
}

test('every active third-party Action reference is a verified full commit SHA', () => {
  const { violations, found } = activeInventory();
  assert.deepEqual(violations, [], violations.join('\n'));
  assert.ok(found.size > 0, 'active workflows must still reference third-party Actions');
  // A pin that no workflow uses would be stale review inventory, not protection.
  for (const [action, shas] of Object.entries(reviewed)) {
    for (const sha of shas) assert.ok(found.has(`${action}@${sha}`), `stale reviewed pin ${action}@${sha}`);
  }
});

test('the dependency review documents each original ref, resolved commit and official upstream', () => {
  const documentation = read('docs/DEPENDENCY_SECURITY.md');
  for (const ref of originalMovingRefs) assert.ok(documentation.includes(`\`${ref}\``), `original ref ${ref} must be documented`);
  for (const [action, shas] of Object.entries(reviewed)) {
    for (const sha of shas) assert.ok(documentation.includes(sha), `${action}@${sha} must be documented`);
    assert.ok(documentation.includes(`${OFFICIAL}${action.split('/').slice(0, 2).join('/')}`), `official upstream for ${action}`);
  }
  assert.match(documentation, /### Updating a workflow Action pin/);
});

test('local entries, immutable consumer pins and historical evidence attribution are preserved', () => {
  const ci = read(path.join(workflowDir, 'ci.yml'));
  const weighin = read(path.join(workflowDir, 'weighin.yml'));
  const comment = read(path.join(workflowDir, 'comment.yml'));
  const weighinComment = read(path.join(workflowDir, 'weighin-comment.yml'));
  assert.ok(/uses: \.\/\s*#/.test(ci), 'CI still runs the Action from its own checkout');
  assert.ok(weighin.includes('uses: ./'), 'benchmark still runs the checkout Action');
  assert.ok(comment.includes('uses: ./comment'), 'comment workflow still runs the local comment Action');
  // Already reviewed third-party pins stay byte-identical.
  assert.ok(ci.includes('uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0'), 'CI rust-toolchain pin is preserved');
  assert.ok(weighin.includes('uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0'), 'benchmark rust-toolchain pin is preserved');
  // Immutable WeighIn consumer pins keep their PR #13 evidence attribution.
  assert.ok(weighin.includes('uses: WeighInNG/WeighIn@bbbe9001bbd375fd6a1ff75be5da2593c86fff20'), 'consumer Action pin is preserved');
  assert.ok(weighinComment.includes('uses: WeighInNG/WeighIn/comment@bbbe9001bbd375fd6a1ff75be5da2593c86fff20'), 'consumer comment pin is preserved');
  const attribution = 'Immutable public revision verified by PR #13 hosted control/regression/threshold and core CI.';
  assert.ok(weighin.includes(attribution) && weighinComment.includes(attribution), 'evidence attribution stays with the pins');
});

test('permissions, fork event guards and expected-negative threshold verification are preserved', () => {
  for (const file of ['comment.yml', 'weighin-comment.yml']) {
    const job = parse(file).jobs['post-comment'];
    assert.deepEqual(job.permissions, { 'pull-requests': 'write', actions: 'read' }, file);
    assert.match(job.if, /workflow_run\.conclusion == 'success'/, file);
    assert.match(job.if, /workflow_run\.event == 'pull_request'/, file);
  }
  assert.deepEqual(parse('weighin.yml').permissions, { contents: 'read' });
  assert.deepEqual(parse('flagship-proof.yml').permissions, { contents: 'read' });
  // The core CI declaration belongs to the explicit-permissions issue; it must
  // stay absent or read-only, never widened by this change.
  const ciPermissions = parse('ci.yml').permissions;
  if (ciPermissions) assert.deepEqual(ciPermissions, { contents: 'read' });
  for (const file of workflowFiles()) {
    const workflow = parse(file);
    const scopes = [workflow.permissions, ...Object.values(workflow.jobs).map(job => job.permissions)].filter(Boolean);
    for (const scope of scopes) for (const [scopeName, mode] of Object.entries(scope)) {
      if (mode !== 'write') continue;
      assert.ok(scopeName === 'pull-requests' && /^(weighin-)?comment\.yml$/.test(file), `${file} grants ${scopeName}: ${mode}`);
    }
  }
  const benchmark = parse('weighin.yml').jobs.benchmark.steps;
  const guards = benchmark.filter(step => typeof step.if === 'string' && step.if.includes('github.repository'));
  assert.deepEqual(guards.map(step => step.if), ["github.repository == 'WeighInNG/WeighIn'", "github.repository != 'WeighInNG/WeighIn'"]);
  assert.equal(guards[0].uses, './');
  assert.match(guards[1].uses, /^WeighInNG\/WeighIn@[0-9a-f]{40}$/);
  const proof = parse('flagship-proof.yml').jobs.proof;
  assert.deepEqual(proof.strategy.matrix.scenario, ['control', 'regression', 'threshold']);
  const run = proof.steps.find(step => step.id === 'benchmark');
  assert.equal(run['continue-on-error'], "${{ matrix.scenario == 'threshold' }}");
  const requirement = proof.steps.find(step => step.name === 'Require verified result and genuine policy failure');
  assert.equal(requirement.if, '${{ !cancelled() }}');
  assert.match(requirement.run, /proof\.status, 'VERIFIED'/);
  assert.match(requirement.run, /evidence\/failure\.json'\)\), false/);
  assert.match(requirement.run, /proof\.action_exit, process\.env\.SCENARIO === 'threshold' \? 1 : 0/);
  assert.match(requirement.run, /process\.env\.BENCHMARK_OUTCOME, process\.env\.SCENARIO === 'threshold' \? 'failure' : 'success'/);
});

test('frozen experiment snapshots stay outside the pin check', () => {
  const snapshots = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.yml') && full.split(path.sep).includes('.github')) snapshots.push(full);
    }
  };
  walk(path.join(root, snapshotDir));
  assert.ok(snapshots.length > 0, 'retained experiment workflow snapshots must still exist');
  // The snapshots keep their original moving refs, which is exactly why the
  // check must not read them: they are frozen evidence, not active workflows.
  const moving = snapshots.filter(file => /uses:\s+\S+\/\S+@(v\d+|master|main|stable|latest)/.test(fs.readFileSync(file, 'utf8')));
  assert.ok(moving.length > 0, 'frozen snapshots must retain their original moving refs');
  const governed = workflowFiles().map(name => path.join(root, workflowDir, name));
  for (const snapshot of snapshots) assert.ok(!governed.includes(snapshot), `${snapshot} is outside the governed scope`);
  const { violations } = activeInventory();
  assert.deepEqual(violations, [], violations.join('\n'));
});
