const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const YAML = require('yaml');
const root = path.resolve(__dirname, '..');
const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/comment.yml'), 'utf8'));
const commentJob = workflow.jobs['post-comment'];
const steps = commentJob.steps;
const report = '<!-- weighin-comment -->\n# Resource report\nCPU instructions: 565371\n';
function git(directory, ...args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
}
// Evaluate the actual YAML guard's supported expression subset. Reject any
// unfamiliar syntax so a future workflow change cannot silently bypass coverage.
function shouldRun(condition, run) {
  const terms = condition.split(/\s*&&\s*/).map(term => {
    const match = /^github\.event\.workflow_run\.(conclusion|event)\s*==\s*'([^']+)'$/.exec(term.trim());
    assert.ok(match, `Unmodeled workflow condition: ${term}`);
    return run[match[1]] === match[2];
  });
  return terms.every(Boolean);
}
const successfulPr = { conclusion: 'success', event: 'pull_request' };
async function execute(order, includeMetadata = true, run = successfulPr, condition = commentJob.if) {
  if (!shouldRun(condition, run)) return { skipped: true, executedSteps: [], calls: [] };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-comment-test-'));
  const workspace = path.join(temporary, 'workspace'), calls = [];
  const server = http.createServer((request, response) => {
    let raw = ''; request.on('data', data => raw += data);
    request.on('end', () => {
      if (request.url !== '/repos/WeighInNG/WeighIn/issues/27/comments' || !['GET', 'POST'].includes(request.method)) {
        response.writeHead(400); response.end('Unexpected test API request'); return;
      }
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: request.method, body });
      response.writeHead(request.method === 'GET' ? 200 : 201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.method === 'GET' ? [] : { id: 42, body: body.body }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(workspace);
  try {
    git(workspace, 'init', '--quiet');
    git(workspace, 'config', 'user.name', 'WeighIn workflow test');
    git(workspace, 'config', 'user.email', 'workflow@example.invalid');
    for (const file of ['comment/action.yml', 'bundled/comment-action.js']) {
      const destination = path.join(workspace, file); fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
    }
    git(workspace, 'add', 'comment', 'bundled'); git(workspace, 'commit', '--quiet', '-m', 'Disposable workflow test');
    let result;
    for (const step of order) {
      if (step.uses === 'actions/checkout@v4') {
        // Real cleanup performed by checkout's default clean policy.
        git(workspace, 'clean', '-ffdx'); git(workspace, 'reset', '--hard', 'HEAD');
      } else if (step.uses === 'actions/download-artifact@v4') {
        assert.equal(step.with.name, 'weighin-artifacts');
        assert.equal(step.with['run-id'], '${{ github.event.workflow_run.id }}');
        const post = order.find(step => step.uses === './comment');
        fs.writeFileSync(path.join(workspace, post.with['report-path']), report);
        if (includeMetadata) fs.writeFileSync(path.join(workspace, post.with['metadata-path']), JSON.stringify({ prNumber: 27 }));
      } else if (step.uses === './comment') {
        const action = YAML.parse(fs.readFileSync(path.join(workspace, 'comment/action.yml'), 'utf8'));
        result = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--require', path.join(root, 'tests/support/comment-transport-hook.cjs'), path.resolve(workspace, 'comment', action.runs.main)], {
            cwd: workspace, timeout: 15000,
            env: { ...process.env, GITHUB_REPOSITORY: 'WeighInNG/WeighIn', GITHUB_EVENT_PATH: '', GITHUB_API_URL: apiUrl,
              HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1',
              'INPUT_REPORT-PATH': step.with['report-path'], 'INPUT_METADATA-PATH': step.with['metadata-path'], 'INPUT_GITHUB-TOKEN': 'unit-test-token' },
          });
          let stdout = '', stderr = '';
          child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
          child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
        });
        assert.ifError(result.error);
      } else throw new Error(`Unmodeled workflow step: ${step.uses}`);
    }
    assert.ok(result, 'Workflow must execute the comment Action');
    return { ...result, skipped: false, executedSteps: order.map(step => step.name), calls };
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(temporary, { recursive: true, force: true }); }
}
test('comment workflow preserves downloaded report/metadata and sends their contents through the bundled Action', async () => {
  const result = await execute(steps);
  assert.equal(result.skipped, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(result.calls[1].body.body, report);
});
test('the historical download-before-checkout order deletes the report and fails before any posting request', async () => {
  const historical = [steps.find(step => step.uses === 'actions/download-artifact@v4'), steps.find(step => step.uses === 'actions/checkout@v4'), steps.find(step => step.uses === './comment')];
  const result = await execute(historical);
  assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /Report file not found/);
  assert.deepEqual(result.calls, []);
});
test('missing downloaded metadata fails before any posting request', async () => {
  const result = await execute(steps, false);
  assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /Metadata file not found/);
  assert.deepEqual(result.calls, []);
});
test('comment delivery retains trusted checkout and triggering-run artifact selection', () => {
  assert.deepEqual(workflow.on.workflow_run.workflows, ['WeighIn CI']);
  assert.deepEqual(workflow.jobs['post-comment'].permissions, { 'pull-requests': 'write', actions: 'read' });
  const checkout = steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with?.ref, undefined, 'Do not execute triggering PR code with comment permissions');
});

test('comment test transport rejects non-local sockets before connecting', () => {
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'tests/support/comment-transport-hook.cjs'), '-e', "require('node:net').connect(443, 'api.github.com')"], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Non-local network connection forbidden/);
});

test('successful main push skips checkout, artifact download and comment execution', async () => {
  const result = await execute(steps, false, { conclusion: 'success', event: 'push' });
  assert.deepEqual(result, { skipped: true, executedSteps: [], calls: [] });
});
test('the historical success-only guard executes on a push and fails without PR metadata', async () => {
  const result = await execute(steps, false, { conclusion: 'success', event: 'push' }, "github.event.workflow_run.conclusion == 'success'");
  assert.equal(result.skipped, false);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Metadata file not found/);
  assert.deepEqual(result.calls, []);
});
for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
  test(`${conclusion} PR CI skips all comment-job steps`, async () => {
    const result = await execute(steps, false, { conclusion, event: 'pull_request' });
    assert.deepEqual(result, { skipped: true, executedSteps: [], calls: [] });
  });
}
for (const event of ['workflow_dispatch', 'pull_request_target', undefined]) {
  test(`${event ?? 'missing event'} does not qualify for PR comment delivery`, async () => {
    const result = await execute(steps, false, { conclusion: 'success', event });
    assert.deepEqual(result, { skipped: true, executedSteps: [], calls: [] });
  });
}
test('a successful fork PR uses the same comment delivery path', async () => {
  const result = await execute(steps, true, { ...successfulPr, head_repository: { fork: true } });
  assert.equal(result.skipped, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.calls[1].body.body, report);
});
