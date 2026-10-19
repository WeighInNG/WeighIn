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
const validMetadata = { schemaVersion: 1, repository: 'WeighInNG/WeighIn', prNumber: 27, headSha: 'f'.repeat(40) };
async function execute(order, metadata = true, run = successfulPr, condition = commentJob.if) {
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
        if (metadata !== false) {
          const value = metadata === true ? validMetadata : metadata;
          const text = typeof value === 'string' ? value : JSON.stringify(value);
          fs.writeFileSync(path.join(workspace, post.with['metadata-path']), text);
        }
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
test('a case-insensitive repository match is accepted by the bundled consumer', async () => {
  const result = await execute(steps, { ...validMetadata, repository: 'weighinng/weighin' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(result.calls[1].body.body, report);
});
for (const [label, metadata, pattern] of [
  ['malformed JSON', '{ not json', /not valid JSON/],
  ['a JSON array', '[]', /must be a JSON object/],
  ['legacy unversioned metadata', JSON.stringify({ prNumber: 27, headSha: 'f'.repeat(40) }), /Legacy unversioned/],
  ['an unsupported schema version', JSON.stringify({ ...validMetadata, schemaVersion: 2 }), /Unsupported PR metadata schemaVersion/],
  ['a string schema version', JSON.stringify({ ...validMetadata, schemaVersion: '1' }), /Unsupported PR metadata schemaVersion/],
  ['a missing repository', JSON.stringify({ ...validMetadata, repository: undefined }), /repository is missing/],
  ['a blank repository', JSON.stringify({ ...validMetadata, repository: '  ' }), /repository is missing/],
  ['another repository', JSON.stringify({ ...validMetadata, repository: 'attacker/WeighIn' }), /does not match trusted repository/],
  ['a string PR number', JSON.stringify({ ...validMetadata, prNumber: '27' }), /prNumber must be a positive integer/],
  ['a zero PR number', JSON.stringify({ ...validMetadata, prNumber: 0 }), /prNumber must be a positive integer/],
  ['a negative PR number', JSON.stringify({ ...validMetadata, prNumber: -3 }), /prNumber must be a positive integer/],
  ['a fractional PR number', JSON.stringify({ ...validMetadata, prNumber: 1.5 }), /prNumber must be a positive integer/],
  ['a malformed SHA', JSON.stringify({ ...validMetadata, headSha: 'abc123' }), /headSha must be a 40-character hexadecimal SHA/],
  ['a non-hex SHA', JSON.stringify({ ...validMetadata, headSha: 'g'.repeat(40) }), /headSha must be a 40-character hexadecimal SHA/],
]) {
  test(`the bundled consumer rejects ${label} with zero mutation calls`, async () => {
    const result = await execute(steps, metadata);
    assert.equal(result.status, 1, `${label} unexpectedly succeeded`);
    assert.match(result.stdout + result.stderr, pattern);
    assert.deepEqual(result.calls, []);
  });
}
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

const foreignValidMetadata = {
  schemaVersion: 1,
  repository: 'external-org/soroban-consumer',
  prNumber: 19,
  headSha: 'a'.repeat(40),
};
const foreignReport = '<!-- weighin-report -->\n## WeighIn Benchmark Report\nCPU Instructions: 266,842\n';

async function executeForeignCommentAction({
  reportContent = foreignReport,
  metadataContent = foreignValidMetadata,
  reportInput = 'artifacts/weighin-report.md',
  metadataInput = 'artifacts/pr-metadata.json',
  trustedRepository = 'external-org/soroban-consumer',
  existingComments = [],
  apiStatusOverride = null,
  useUnrelatedCwd = true,
} = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-foreign-comment-'));
  const actionInstallDir = path.join(temporary, 'runner/_actions/WeighInNG/WeighIn/foreign-sha');
  const callerWorkspace = path.join(temporary, 'caller-workspace/external-org/soroban-consumer');
  const unrelatedCwd = path.join(temporary, 'unrelated-execution-cwd');
  const calls = [];

  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', data => (raw += data));
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: request.method, url: request.url, body });
      if (apiStatusOverride && request.method !== 'GET') {
        response.writeHead(apiStatusOverride, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'Simulated GitHub API failure' }));
        return;
      }
      if (request.method === 'GET' && request.url === '/repos/external-org/soroban-consumer/issues/19/comments') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(existingComments));
        return;
      }
      if (request.method === 'POST' && request.url === '/repos/external-org/soroban-consumer/issues/19/comments') {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 77, body: body.body }));
        return;
      }
      if (request.method === 'PATCH' && request.url === '/repos/external-org/soroban-consumer/issues/comments/99') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 99, body: body.body }));
        return;
      }
      response.writeHead(400);
      response.end(`Unexpected test API request: ${request.method} ${request.url}`);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    fs.mkdirSync(actionInstallDir, { recursive: true });
    fs.mkdirSync(callerWorkspace, { recursive: true });
    fs.mkdirSync(unrelatedCwd, { recursive: true });

    // Populate ONLY the foreign Action installation directory with comment/action.yml and bundled/comment-action.js
    for (const file of ['comment/action.yml', 'bundled/comment-action.js']) {
      const destination = path.join(actionInstallDir, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
    }

    // Verify foreign Action installation has no node_modules, dist, or src, and caller has no action files
    assert.equal(fs.existsSync(path.join(actionInstallDir, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(actionInstallDir, 'dist')), false);
    assert.equal(fs.existsSync(path.join(callerWorkspace, 'comment')), false);
    assert.equal(fs.existsSync(path.join(callerWorkspace, 'bundled')), false);

    if (reportContent !== null) {
      const reportFile = path.join(callerWorkspace, reportInput);
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, reportContent);
    }
    if (metadataContent !== null) {
      const metadataFile = path.join(callerWorkspace, metadataInput);
      fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
      const text = typeof metadataContent === 'string' ? metadataContent : JSON.stringify(metadataContent);
      fs.writeFileSync(metadataFile, text);
    }

    const actionYmlPath = path.join(actionInstallDir, 'comment/action.yml');
    const actionDef = YAML.parse(fs.readFileSync(actionYmlPath, 'utf8'));
    assert.equal(actionDef.runs.using, 'node24');
    const resolvedBundle = path.resolve(path.dirname(actionYmlPath), actionDef.runs.main);
    assert.equal(resolvedBundle, path.join(actionInstallDir, 'bundled/comment-action.js'));
    assert.equal(resolvedBundle.startsWith(root), false, 'Bundle must resolve inside foreign installation directory, not this repository');

    const childCwd = useUnrelatedCwd ? unrelatedCwd : callerWorkspace;
    assert.notEqual(childCwd, root, 'Execution cwd must not be this repository');
    assert.notEqual(childCwd, actionInstallDir, 'Execution cwd must not be the action install dir');

    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--require', path.join(root, 'tests/support/comment-transport-hook.cjs'), resolvedBundle],
        {
          cwd: childCwd,
          timeout: 15000,
          env: {
            ...process.env,
            GITHUB_WORKSPACE: callerWorkspace,
            GITHUB_REPOSITORY: trustedRepository,
            GITHUB_EVENT_PATH: '',
            GITHUB_API_URL: apiUrl,
            HTTP_PROXY: '',
            HTTPS_PROXY: '',
            ALL_PROXY: '',
            http_proxy: '',
            https_proxy: '',
            all_proxy: '',
            NO_PROXY: '127.0.0.1',
            no_proxy: '127.0.0.1',
            'INPUT_REPORT-PATH': reportInput,
            'INPUT_METADATA-PATH': metadataInput,
            'INPUT_GITHUB-TOKEN': 'foreign-install-test-token',
          },
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => (stdout += data));
      child.stderr.on('data', data => (stderr += data));
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout, stderr }));
    });

    return { ...result, calls, resolvedBundle, actionInstallDir, callerWorkspace, childCwd };
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('foreign installation path resolves bundled comment Action and creates or updates PR comments without relying on repository cwd', async () => {
  // 1. Create new PR comment when invoked from an unrelated cwd with relative caller workspace paths
  const created = await executeForeignCommentAction({ useUnrelatedCwd: true });
  assert.equal(created.status, 0, created.stdout + created.stderr);
  assert.deepEqual(created.calls.map(c => c.method), ['GET', 'POST']);
  assert.equal(created.calls[1].url, '/repos/external-org/soroban-consumer/issues/19/comments');
  assert.equal(created.calls[1].body.body, foreignReport);

  // 2. Update existing PR comment when marker is already present
  const updated = await executeForeignCommentAction({
    existingComments: [{ id: 99, body: '<!-- weighin-report -->\nOld report' }],
    useUnrelatedCwd: true,
  });
  assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  assert.deepEqual(updated.calls.map(c => c.method), ['GET', 'PATCH']);
  assert.equal(updated.calls[1].url, '/repos/external-org/soroban-consumer/issues/comments/99');
  assert.equal(updated.calls[1].body.body, foreignReport);

  // 3. Case-insensitive repository match from foreign installation path
  const caseInsensitive = await executeForeignCommentAction({
    metadataContent: { ...foreignValidMetadata, repository: 'External-Org/Soroban-Consumer' },
  });
  assert.equal(caseInsensitive.status, 0, caseInsensitive.stdout + caseInsensitive.stderr);
  assert.deepEqual(caseInsensitive.calls.map(c => c.method), ['GET', 'POST']);
});

test('foreign installation path fails closed on missing files, invalid metadata, and API errors with zero unauthorized mutations', async () => {
  const missingReport = await executeForeignCommentAction({ reportContent: null });
  assert.equal(missingReport.status, 1);
  assert.match(missingReport.stdout + missingReport.stderr, /Report file not found/);
  assert.deepEqual(missingReport.calls, []);

  const missingMetadata = await executeForeignCommentAction({ metadataContent: null });
  assert.equal(missingMetadata.status, 1);
  assert.match(missingMetadata.stdout + missingMetadata.stderr, /Metadata file not found/);
  assert.deepEqual(missingMetadata.calls, []);

  for (const [label, invalidMeta, pattern] of [
    ['malformed JSON', '{broken', /not valid JSON/],
    ['legacy unversioned metadata', { prNumber: 19, headSha: 'a'.repeat(40) }, /Legacy unversioned/],
    ['unsupported schemaVersion', { ...foreignValidMetadata, schemaVersion: 2 }, /Unsupported PR metadata schemaVersion/],
    ['cross-repository mismatch', { ...foreignValidMetadata, repository: 'attacker-org/other-repo' }, /does not match trusted repository/],
    ['non-positive prNumber', { ...foreignValidMetadata, prNumber: 0 }, /prNumber must be a positive integer/],
    ['malformed headSha', { ...foreignValidMetadata, headSha: '12345' }, /headSha must be a 40-character hexadecimal SHA/],
  ]) {
    const failed = await executeForeignCommentAction({ metadataContent: invalidMeta });
    assert.equal(failed.status, 1, `Expected foreign install failure for ${label}`);
    assert.match(failed.stdout + failed.stderr, pattern);
    assert.deepEqual(failed.calls, [], `Expected zero API calls for ${label}`);
  }

  const apiFailure = await executeForeignCommentAction({ apiStatusOverride: 500 });
  assert.equal(apiFailure.status, 1);
  assert.deepEqual(apiFailure.calls.map(c => c.method), ['GET', 'POST']);
});
