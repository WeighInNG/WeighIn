const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { Keypair, xdr } = require('@stellar/stellar-sdk');
const { runMeasurement } = require('../dist/measurement');
const { parseFixtures } = require('../dist/identity');
const {
  verifyDiscardedWritesProof,
} = require('./experiments/discarded-writes-analysis.cjs');
const {
  generateEvidence,
  verifyEvidence,
} = require('./experiments/verify-discarded-writes.cjs');

const root = path.resolve(__dirname, '..');
const expDir = path.join(root, 'docs/experiments/discarded-writes');
const fixtureDir = path.join(root, 'tests/fixtures/discarded-writes');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(expDir, file), 'utf8'));
}

test('archived discarded-writes proof bundle verifies hashes, return values, and committed-state reads', () => {
  const result = verifyEvidence(expDir);
  assert.deepEqual(result.writeReturn, ['Hello', 'write', 'wrote', 'seeded']);
  assert.deepEqual(result.readReturn, ['Hello', 'read', 'absent', 'uninit']);
});

test('generateEvidence reproduces the exact verified discarded-writes bundle in an isolated directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-discarded-writes-'));
  try {
    generateEvidence(tmpDir);
    const verified = verifyEvidence(tmpDir);
    assert.deepEqual(verified.writeReturn, ['Hello', 'write', 'wrote', 'seeded']);
    assert.deepEqual(verified.readReturn, ['Hello', 'read', 'absent', 'uninit']);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(tmpDir, 'sha256.json'), 'utf8')),
      readJson('sha256.json'),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runMeasurement executes write-then-read against a fresh deployment without submitting invocation writes', async () => {
  const rpcCalls = readJson('rpc-calls.json');
  const nativeReplays = readJson('native-replays.json');
  const env = readJson('environment.json');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weighin-live-write-read-'));
  const keyFile = path.join(tmpDir, '.weighin-temp-key');
  const keypair = Keypair.random();
  fs.writeFileSync(keyFile, keypair.secret());

  const wasmDir = path.join(tmpDir, 'contract/target/wasm32v1-none/release');
  fs.mkdirSync(wasmDir, { recursive: true });
  const wasmPath = path.join(wasmDir, 'discarded_writes_contract.wasm');
  fs.writeFileSync(wasmPath, Buffer.from('0061736d01000000', 'hex'));

  const fixturesPath = path.join(tmpDir, 'weighin-fixtures.json');
  fs.copyFileSync(path.join(fixtureDir, 'weighin-fixtures.json'), fixturesPath);

  const helperDummyPath = path.join(tmpDir, 'weighin-simulation-helper');
  fs.writeFileSync(helperDummyPath, 'weighin-simulation-stub', { mode: 0o755 });

  const submittedTxHashes = [];
  let simulateCount = 0;
  let helperCallCount = 0;
  let contractCreated = false;

  const accountEntryXdr = xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: Keypair.fromPublicKey(keypair.publicKey()).xdrAccountId(),
      balance: xdr.Int64.fromString('10000000000'),
      seqNum: xdr.SequenceNumber.fromString('100'),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: Buffer.alloc(0),
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    }),
  ).toXDR('base64');

  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalExecFile = cp.execFile;

  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });

  cp.execFile = function (file, _args, _options, callback) {
    if (path.resolve(file) !== path.resolve(helperDummyPath)) {
      return originalExecFile.apply(this, arguments);
    }
    const stdin = new EventEmitter();
    stdin.on = () => stdin;
    stdin.end = () => {
      const idx = Math.min(helperCallCount, nativeReplays.length - 1);
      helperCallCount += 1;
      setImmediate(() =>
        callback(null, JSON.stringify(nativeReplays[idx].output), ''),
      );
    };
    return { stdin };
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      if (payload.method === 'getNetwork') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              passphrase: 'Standalone Network ; February 2017',
              protocolVersion: 28,
            },
          }),
        );
        return;
      }
      if (payload.method === 'getLedgerEntries') {
        const keys = payload.params.keys || [];
        if (keys.length === 1) {
          const parsedKey = xdr.LedgerKey.fromXDR(keys[0], 'base64');
          if (parsedKey.switch().name === 'account') {
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id,
                result: {
                  latestLedger: 1101,
                  entries: [
                    {
                      key: keys[0],
                      xdr: accountEntryXdr,
                      lastModifiedLedgerSeq: 1099,
                    },
                  ],
                },
              }),
            );
            return;
          }
          if (!contractCreated) {
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id,
                result: { latestLedger: 1100, entries: [] },
              }),
            );
            return;
          }
        }
        const baseEntries = rpcCalls[0].get_ledger_entries.result.entries;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              latestLedger: 1101,
              entries: baseEntries.filter((e) => keys.includes(e.key)),
            },
          }),
        );
        return;
      }
      if (payload.method === 'simulateTransaction') {
        if (!contractCreated) {
          const dummyTxData = rpcCalls[0].simulate_transaction.result.transactionData;
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              result: {
                latestLedger: 1100,
                minResourceFee: '10000',
                cost: { cpuInsns: '1000', memBytes: '1000' },
                transactionData: dummyTxData,
                events: [],
                results: [
                  {
                    xdr: xdr.ScVal.scvVoid().toXDR('base64'),
                    auth: [],
                  },
                ],
              },
            }),
          );
          return;
        }
        const caseIdx = Math.min(Math.floor(simulateCount / 2), 1);
        simulateCount += 1;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: rpcCalls[caseIdx].simulate_transaction.result,
          }),
        );
        return;
      }
      if (payload.method === 'sendTransaction') {
        const hash = String(submittedTxHashes.length + 1).padStart(64, 'a');
        submittedTxHashes.push(hash);
        if (submittedTxHashes.length === 2) {
          contractCreated = true;
        }
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: { status: 'PENDING', hash, latestLedger: 1100 },
          }),
        );
        return;
      }
      if (payload.method === 'getTransaction') {
        const sampleRpc = JSON.parse(
          fs.readFileSync(
            path.join(root, 'docs/experiments/repeatability/completed/run-1-rpc.json'),
            'utf8',
          ),
        );
        const sampleTxResult = sampleRpc.find(
          (x) => x.request.method === 'getTransaction' && x.raw.result?.status === 'SUCCESS',
        ).raw.result;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: sampleTxResult,
          }),
        );
        return;
      }
      if (payload.method === 'getLedgers') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: rpcCalls[0].get_ledgers.result,
          }),
        );
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Unexpected RPC method: ${payload.method}` }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const rpcUrl = `http://127.0.0.1:${port}/rpc`;

  try {
    const results = await runMeasurement({
      fixturesPath,
      gitCommit: env.git_commit,
      sdkVersion: env.soroban_sdk_version,
      rpcUrl,
      keyFile,
      helperPath: helperDummyPath,
    });

    // Only WASM upload and contract creation were submitted; neither benchmark invocation was submitted
    assert.equal(submittedTxHashes.length, 2);
    assert.equal(results.length, 1);
    assert.equal(results[0].benchmarks.length, 2);

    const [writeCase, readCase] = results[0].benchmarks;
    assert.equal(writeCase.case_id, 'id:write-seed');
    assert.equal(writeCase.metrics.ledger_write_entries.consumed, 1);
    assert.equal(writeCase.metrics.ledger_write_bytes.consumed, 88);

    assert.equal(readCase.case_id, 'id:read-after-write');
    assert.equal(readCase.metrics.ledger_write_entries.consumed, 0);
    assert.equal(readCase.metrics.ledger_write_bytes.consumed, 0);
  } finally {
    cp.execFile = originalExecFile;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('failure and invalid cases fail closed when prior writes are discarded or tampered with', () => {
  const rejectedPaths = readJson('rejected-paths.json');
  assert.equal(rejectedPaths.length, 4);

  // 1. Duplicate case identity without distinct case IDs fails parseFixtures
  assert.throws(
    () =>
      parseFixtures(
        JSON.stringify({
          id: 'dup-suite',
          contracts: [
            {
              id: 'reference-contract',
              wasm_path: 'contract/target/wasm32v1-none/release/discarded_writes_contract.wasm',
              invocations: [
                { id: 'write-seed', function_name: 'hello', args: [{ type: 'symbol', value: 'write' }] },
                { id: 'write-seed', function_name: 'hello', args: [{ type: 'symbol', value: 'read' }] },
              ],
            },
          ],
        }),
        'weighin-fixtures.json',
      ),
    /Duplicate benchmark identity/,
  );

  // 2. Tampering with archived return value in caseSequence fails verification
  const tamperedSequence = structuredClone(readJson('case-sequence.json'));
  tamperedSequence[1].decoded_return = ['Hello', 'read', 'present', 'seeded'];
  assert.throws(
    () =>
      verifyDiscardedWritesProof({
        contractSource: fs.readFileSync(path.join(fixtureDir, 'contract/src/lib.rs'), 'utf8'),
        fixtureJson: fs.readFileSync(path.join(fixtureDir, 'weighin-fixtures.json'), 'utf8'),
        environment: readJson('environment.json'),
        deployment: readJson('deployment.json'),
        measurementResults: readJson('measurement-results.json'),
        caseSequence: tamperedSequence,
        returnValuesArchive: readJson('return-values.json'),
        rpcCalls: readJson('rpc-calls.json'),
        nativeReplays: readJson('native-replays.json'),
        seededStateControl: readJson('seeded-state-control.json'),
        rejectedPaths,
        analysis: readJson('analysis.json'),
        controlDiff: readJson('control-diff.json'),
        seededVsDiscardedDiff: readJson('seeded-vs-discarded-diff.json'),
        policy: readJson('policy.json'),
        violations: readJson('violations.json'),
        summary: fs.readFileSync(path.join(expDir, 'summary.md'), 'utf8'),
        verification: readJson('verification.json'),
      }),
    /Expected values to be strictly deep-equal/,
  );
});
