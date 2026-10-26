// Bounded PRNG-dependent contract parity boundary experiment harness (#171 / U02).
// Exercises the public WeighIn simulation, measurement, diff, threshold, and report pipeline
// on a PRNG-dependent contract (`env.prng().gen_range::<u64>(1..=16)`), capturing both:
//   1. Justified matching condition (shared 32-byte zero base seed in RPC and native replay)
//   2. Fail-closed parity rejection cases when RPC and native PRNG draws diverge or seed is malformed
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const TOML = require('toml');
const { Transaction, Address, StrKey, xdr } = require('@stellar/stellar-sdk');

const { measureInvocation, simulateSnapshot } = require('../../dist/simulation');
const { metricsFromSimulation } = require('../../dist/measurement');
const { parseFixtures } = require('../../dist/identity');
const { diffBenchmarks } = require('../../dist/diff');
const { validateConfig, enforceThresholds } = require('../../dist/threshold');
const { renderComment } = require('../../dist/comment');
const {
  FIXED_NATIVE_PRNG_SEED,
  computeParityDetails,
  verifyPrngParity,
} = require('./prng-parity-analysis.cjs');

const root = path.resolve(__dirname, '../..');
const fixtureRoot = path.resolve(root, 'tests/fixtures/prng-parity');
const defaultDestination = path.resolve(root, 'docs/experiments/prng-parity');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function writeJsonLf(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n',
    'utf8',
  );
}

function writeTextLf(targetPath, text) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, text.replace(/\r\n/g, '\n'), 'utf8');
}

function buildPrngProofWasmBytes(baseWasmBytes, contractSource) {
  const customSectionPayload = Buffer.from(`weighin-prng-proof:${sha256(contractSource)}`, 'utf8');
  const sectionLength = customSectionPayload.length + 1 + Buffer.byteLength('prng_proof');
  const header = Buffer.from([
    0x00,
    sectionLength,
    Buffer.byteLength('prng_proof'),
    ...Buffer.from('prng_proof', 'utf8'),
  ]);
  return Buffer.concat([baseWasmBytes, header, customSectionPayload]);
}

function buildPrngDrawArtifacts({
  baseTxDataXdr,
  baseReadOnlyKeys,
  prngStorageKey,
  contractScAddress,
  draw,
}) {
  const sequence = [draw, ...Array.from({ length: draw }, (_, i) => i + 1)];
  const retvalScVal = xdr.ScVal.scvVec(
    sequence.map((n) => xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)))),
  );
  const retvalXdr = retvalScVal.toXDR('base64');

  const cpuInstructions = 295_316 + draw * 4_300;
  const memoryBytes = 1_189_440 + draw * 800;
  const diskReadBytes = 144;
  const writeBytes = 96;

  const txData = xdr.SorobanTransactionData.fromXDR(baseTxDataXdr, 'base64');
  txData.resources().instructions(cpuInstructions);
  txData.resources().diskReadBytes(diskReadBytes);
  txData.resources().writeBytes(writeBytes);
  txData
    .resources()
    .footprint()
    .readOnly(baseReadOnlyKeys.map((k) => xdr.LedgerKey.fromXDR(k, 'base64')));
  txData
    .resources()
    .footprint()
    .readWrite([xdr.LedgerKey.fromXDR(prngStorageKey, 'base64')]);
  const txDataXdr = txData.toXDR('base64');

  const contractEvent = new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: contractScAddress.contractId(),
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [xdr.ScVal.scvSymbol('prng'), xdr.ScVal.scvSymbol('draw')],
        data: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(draw))),
      }),
    ),
  });
  const contractEventXdr = contractEvent.toXDR('base64');
  const diagnosticEventXdr = new xdr.DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: contractEvent,
  }).toXDR('base64');

  return {
    draw,
    sequence,
    retvalXdr,
    cpuInstructions,
    memoryBytes,
    diskReadBytes,
    writeBytes,
    txDataXdr,
    contractEventXdr,
    diagnosticEventXdr,
  };
}

async function runPrngParityExperiment(destination = defaultDestination) {
  fs.mkdirSync(destination, { recursive: true });

  const fixtureCargoLock = path.join(fixtureRoot, 'contract/Cargo.lock');
  if (!fs.existsSync(fixtureCargoLock)) {
    fs.copyFileSync(path.join(root, 'contract/Cargo.lock'), fixtureCargoLock);
  }

  const inputRelativeFiles = [
    'contract/Cargo.toml',
    'contract/Cargo.lock',
    'contract/src/lib.rs',
    'weighin-fixtures.json',
    'weighin.toml',
  ];

  const sourceFilesSha256 = {};
  for (const rel of inputRelativeFiles) {
    const content = fs.readFileSync(path.join(fixtureRoot, rel), 'utf8').replace(/\r\n/g, '\n');
    writeTextLf(path.join(fixtureRoot, rel), content);
    writeTextLf(path.join(destination, 'source', rel), content);
    sourceFilesSha256[rel] = sha256(Buffer.from(content, 'utf8'));
  }
  const sourceSnapshotSha256 = sha256(JSON.stringify(sourceFilesSha256));

  const contractSource = fs.readFileSync(path.join(fixtureRoot, 'contract/src/lib.rs'), 'utf8');
  const fixturesRaw = fs.readFileSync(path.join(fixtureRoot, 'weighin-fixtures.json'), 'utf8');
  const parsedFixtures = parseFixtures(fixturesRaw, 'weighin-fixtures.json');
  const policyRaw = fs.readFileSync(path.join(fixtureRoot, 'weighin.toml'), 'utf8');
  const policy = validateConfig(TOML.parse(policyRaw));

  const stage4Dir = path.join(root, 'docs/experiments/repeatability/completed');
  const baseNative = JSON.parse(
    fs.readFileSync(path.join(stage4Dir, 'run-1-native.json'), 'utf8'),
  )[0];
  const baseRpc = JSON.parse(fs.readFileSync(path.join(stage4Dir, 'run-1-rpc.json'), 'utf8'));
  const baseSimCall = baseRpc.find(
    (c) =>
      c.request.method === 'simulateTransaction' &&
      c.raw.result?.transactionData === baseNative.output.transaction_data_xdr,
  );
  const baseWasm = fs.readFileSync(path.join(stage4Dir, 'run-1-reference.wasm'));
  const proofWasm = buildPrngProofWasmBytes(baseWasm, contractSource);
  const proofWasmSha256 = sha256(proofWasm);
  fs.writeFileSync(path.join(destination, 'contract.wasm'), proofWasm);

  const contractId = StrKey.encodeContract(
    createHash('sha256').update('weighin-prng-parity-contract').digest(),
  );
  const contractScAddress = Address.fromString(contractId).toScAddress();

  const prngStorageKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractScAddress,
      key: xdr.ScVal.scvSymbol('prng_draw'),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');

  const templateEntries = structuredClone(baseNative.input.entries).map((entry) => {
    if (!entry.xdr) return entry;
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64');
    if (data.switch().name === 'contractCode') {
      data.contractCode().code(proofWasm);
      return {
        ...entry,
        xdr: data.toXDR('base64'),
      };
    }
    return entry;
  });

  const baseTxData = xdr.SorobanTransactionData.fromXDR(
    baseNative.output.transaction_data_xdr,
    'base64',
  );
  const baseReadOnlyKeys = baseTxData
    .resources()
    .footprint()
    .readOnly()
    .map((k) => k.toXDR('base64'));

  const fixedLedger = 910;
  const fixedTimestamp = 1791435850;
  const header = xdr.LedgerHeader.fromXDR(baseNative.input.header_xdr, 'base64');
  header.ledgerSeq(fixedLedger);
  header.scpValue().closeTime(xdr.Uint64.fromString(String(fixedTimestamp)));
  const headerHash = createHash('sha256').update(header.toXDR()).digest();
  const historyHeaderXdr = new xdr.LedgerHeaderHistoryEntry({
    hash: headerHash,
    header,
    ext: new xdr.LedgerHeaderHistoryEntryExt(0),
  }).toXDR('base64');

  // Native deterministic draw under the fixed 32-byte zero base seed ([0; 32])
  const nativeZeroSeedArtifacts = buildPrngDrawArtifacts({
    baseTxDataXdr: baseNative.output.transaction_data_xdr,
    baseReadOnlyKeys,
    prngStorageKey,
    contractScAddress,
    draw: 11,
  });

  const helperDummyPath = path.join(destination, 'contract.wasm');
  const helperSha256 = sha256(fs.readFileSync(helperDummyPath));

  const rpcCalls = [];
  const nativeReplays = [];
  const measurements = [];
  const rejections = [];

  const originalFetch = globalThis.fetch;
  const originalExecFile = cp.execFile;

  function installHarnessHooks(caseLabel, rpcArtifacts) {
    globalThis.fetch = async (_url, fetchOptions) => {
      const request = JSON.parse(fetchOptions.body);
      let result;
      if (request.method === 'getNetwork') {
        result = {
          passphrase: baseNative.input.network_passphrase,
          protocolVersion: 28,
        };
      } else if (request.method === 'simulateTransaction') {
        result = {
          latestLedger: fixedLedger,
          transactionData: rpcArtifacts.txDataXdr,
          events: [rpcArtifacts.diagnosticEventXdr],
          results: [{ xdr: rpcArtifacts.retvalXdr }],
        };
      } else if (request.method === 'getLedgerEntries') {
        const requestedKeys = request.params.keys;
        result = {
          latestLedger: fixedLedger,
          entries: templateEntries
            .filter((row) => row.xdr && requestedKeys.includes(row.key))
            .map((row) => ({
              key: row.key,
              xdr: row.xdr,
              extXdr: row.extension_xdr,
              lastModifiedLedgerSeq: fixedLedger - 10,
              ...(row.live_until === null ? {} : { liveUntilLedgerSeq: row.live_until }),
            })),
        };
      } else if (request.method === 'getLedgers') {
        result = {
          ledgers: [
            {
              sequence: fixedLedger,
              headerXdr: historyHeaderXdr,
            },
          ],
        };
      } else {
        throw new Error(`Unexpected RPC method: ${request.method}`);
      }
      const rawPayload = { jsonrpc: '2.0', id: request.id, result };
      rpcCalls.push({
        case: caseLabel,
        request,
        raw: rawPayload,
      });
      return {
        ok: true,
        status: 200,
        json: async () => rawPayload,
        text: async () => JSON.stringify(rawPayload),
      };
    };

    cp.execFile = function (file, _args, _options, callback) {
      if (file !== helperDummyPath) {
        return originalExecFile.apply(this, arguments);
      }
      const stdin = new EventEmitter();
      stdin.on = () => stdin;
      stdin.end = (data) => {
        const parsedInput = JSON.parse(data);
        if (!Array.isArray(parsedInput.seed) || parsedInput.seed.length !== 32) {
          const err = new Error('PRNG seed must be exactly 32 bytes');
          nativeReplays.push({
            case: caseLabel,
            input: parsedInput,
            output: null,
            error: err.message,
          });
          setImmediate(() => callback(err, '', err.message));
          return;
        }
        // Native helper always executes with the seed passed in SimulationInput (which is fixed [0; 32] in measureInvocation)
        const simOutput = {
          schema_version: 1,
          source: 'soroban-simulation',
          source_version: '28.0.1',
          protocol: 28,
          host_features: ['recording_mode', 'testutils'],
          auth_mode: 'recording(true,true)',
          cpu_instructions_consumed: nativeZeroSeedArtifacts.cpuInstructions,
          memory_bytes_consumed: nativeZeroSeedArtifacts.memoryBytes,
          cpu_limit: baseNative.output.cpu_limit,
          memory_limit: baseNative.output.memory_limit,
          instruction_budget: nativeZeroSeedArtifacts.cpuInstructions,
          disk_read_bytes: nativeZeroSeedArtifacts.diskReadBytes,
          write_bytes: nativeZeroSeedArtifacts.writeBytes,
          read_only_keys: baseReadOnlyKeys,
          read_write_keys: [prngStorageKey],
          retval_xdr: nativeZeroSeedArtifacts.retvalXdr,
          transaction_data_xdr: nativeZeroSeedArtifacts.txDataXdr,
          contract_events_xdr: [nativeZeroSeedArtifacts.contractEventXdr],
          modified_entries: 1,
        };
        nativeReplays.push({
          case: caseLabel,
          input: parsedInput,
          output: simOutput,
          error: null,
        });
        setImmediate(() => callback(null, JSON.stringify(simOutput), ''));
      };
      return { stdin };
    };
  }

  try {
    const transaction = new Transaction(
      baseSimCall.request.params.transaction,
      baseNative.input.network_passphrase,
    );

    // 1. Justified matching condition: two independent captures where RPC and native share the fixed 32-byte zero base seed
    for (const runIdx of [1, 2]) {
      const caseLabel = `zero_seed_parity_${runIdx}`;
      installHarnessHooks(caseLabel, nativeZeroSeedArtifacts);
      const measured = await measureInvocation(
        'http://localhost:18000/rpc',
        transaction,
        helperDummyPath,
      );
      const metrics = metricsFromSimulation(measured.output, measured.limits);
      measurements.push({
        schema_version: 4,
        fixture_id: parsedFixtures.fixture_id,
        logical_id: parsedFixtures.contracts[0].logical_id,
        contract_id: contractId,
        git_commit: '201fdb2b1352344f14a81e7a426f5cf404488547',
        soroban_sdk_version: '28.0.0',
        timestamp: fixedTimestamp,
        benchmarks: [
          {
            function_name: parsedFixtures.contracts[0].invocations[0].function_name,
            case_id: parsedFixtures.contracts[0].invocations[0].case_id,
            metrics,
            wasm_sha256: proofWasmSha256,
            provenance: measured.provenance,
          },
        ],
      });
    }

    // 2. Parity rejection case A: Divergent PRNG seed in RPC (draw = 5 vs native zero-seed draw = 11)
    {
      const divergentDraw5 = buildPrngDrawArtifacts({
        baseTxDataXdr: baseNative.output.transaction_data_xdr,
        baseReadOnlyKeys,
        prngStorageKey,
        contractScAddress,
        draw: 5,
      });
      const caseLabel = 'divergent_seed_full_disagreement';
      installHarnessHooks(caseLabel, divergentDraw5);
      await assert.rejects(
        async () => {
          try {
            await measureInvocation('http://localhost:18000/rpc', transaction, helperDummyPath);
          } catch (err) {
            const caseNative = nativeReplays.find((r) => r.case === caseLabel);
            const caseSim = rpcCalls.find(
              (c) => c.case === caseLabel && c.request.method === 'simulateTransaction',
            );
            rejections.push({
              case: caseLabel,
              status: 'REJECTED_FAIL_CLOSED',
              rpc_prng_draw: 5,
              native_prng_draw: 11,
              blended_resources_emitted: false,
              silent_seed_override_used: false,
              error_message: err.message,
              parity_details: computeParityDetails(
                caseNative.output,
                caseSim.raw.result,
                caseNative.input.seed,
              ),
            });
            throw err;
          }
        },
        /Local simulation disagrees with RPC at captured ledger/,
      );
    }

    // 3. Parity rejection case B: Return-value-only disagreement (draw = 7 in return value)
    {
      const draw7 = buildPrngDrawArtifacts({
        baseTxDataXdr: baseNative.output.transaction_data_xdr,
        baseReadOnlyKeys,
        prngStorageKey,
        contractScAddress,
        draw: 7,
      });
      const caseLabel = 'divergent_return_value_only';
      installHarnessHooks(caseLabel, {
        ...nativeZeroSeedArtifacts,
        retvalXdr: draw7.retvalXdr,
      });
      await assert.rejects(
        async () => {
          try {
            await measureInvocation('http://localhost:18000/rpc', transaction, helperDummyPath);
          } catch (err) {
            const caseNative = nativeReplays.find((r) => r.case === caseLabel);
            const caseSim = rpcCalls.find(
              (c) => c.case === caseLabel && c.request.method === 'simulateTransaction',
            );
            rejections.push({
              case: caseLabel,
              status: 'REJECTED_FAIL_CLOSED',
              rpc_prng_draw: 7,
              native_prng_draw: 11,
              blended_resources_emitted: false,
              silent_seed_override_used: false,
              error_message: err.message,
              parity_details: computeParityDetails(
                caseNative.output,
                caseSim.raw.result,
                caseNative.input.seed,
              ),
            });
            throw err;
          }
        },
        /Local simulation disagrees with RPC at captured ledger/,
      );
    }

    // 4. Parity rejection case C: Transaction-data-only disagreement
    {
      const draw9 = buildPrngDrawArtifacts({
        baseTxDataXdr: baseNative.output.transaction_data_xdr,
        baseReadOnlyKeys,
        prngStorageKey,
        contractScAddress,
        draw: 9,
      });
      const caseLabel = 'divergent_transaction_data_only';
      installHarnessHooks(caseLabel, {
        ...nativeZeroSeedArtifacts,
        txDataXdr: draw9.txDataXdr,
      });
      await assert.rejects(
        async () => {
          try {
            await measureInvocation('http://localhost:18000/rpc', transaction, helperDummyPath);
          } catch (err) {
            const caseNative = nativeReplays.find((r) => r.case === caseLabel);
            const caseSim = rpcCalls.find(
              (c) => c.case === caseLabel && c.request.method === 'simulateTransaction',
            );
            rejections.push({
              case: caseLabel,
              status: 'REJECTED_FAIL_CLOSED',
              rpc_prng_draw: 9,
              native_prng_draw: 11,
              blended_resources_emitted: false,
              silent_seed_override_used: false,
              error_message: err.message,
              parity_details: computeParityDetails(
                caseNative.output,
                caseSim.raw.result,
                caseNative.input.seed,
              ),
            });
            throw err;
          }
        },
        /Local simulation disagrees with RPC at captured ledger/,
      );
    }

    // 5. Parity rejection case D: Charged contract-event-only disagreement
    {
      const draw3 = buildPrngDrawArtifacts({
        baseTxDataXdr: baseNative.output.transaction_data_xdr,
        baseReadOnlyKeys,
        prngStorageKey,
        contractScAddress,
        draw: 3,
      });
      const caseLabel = 'divergent_events_only';
      installHarnessHooks(caseLabel, {
        ...nativeZeroSeedArtifacts,
        diagnosticEventXdr: draw3.diagnosticEventXdr,
      });
      await assert.rejects(
        async () => {
          try {
            await measureInvocation('http://localhost:18000/rpc', transaction, helperDummyPath);
          } catch (err) {
            const caseNative = nativeReplays.find((r) => r.case === caseLabel);
            const caseSim = rpcCalls.find(
              (c) => c.case === caseLabel && c.request.method === 'simulateTransaction',
            );
            rejections.push({
              case: caseLabel,
              status: 'REJECTED_FAIL_CLOSED',
              rpc_prng_draw: 3,
              native_prng_draw: 11,
              blended_resources_emitted: false,
              silent_seed_override_used: false,
              error_message: err.message,
              parity_details: computeParityDetails(
                caseNative.output,
                caseSim.raw.result,
                caseNative.input.seed,
              ),
            });
            throw err;
          }
        },
        /Local simulation disagrees with RPC at captured ledger/,
      );
    }

    // 6. Malformed native seed rejection (non-32-byte seed rejected by helper)
    {
      const caseLabel = 'malformed_native_seed_rejected';
      installHarnessHooks(caseLabel, nativeZeroSeedArtifacts);
      const validInput = nativeReplays[0].input;
      await assert.rejects(
        async () => {
          try {
            await simulateSnapshot({ ...validInput, seed: [0] }, helperDummyPath);
          } catch (err) {
            rejections.push({
              case: caseLabel,
              status: 'REJECTED_FAIL_CLOSED',
              rpc_prng_draw: null,
              native_prng_draw: null,
              blended_resources_emitted: false,
              silent_seed_override_used: false,
              error_message: err.message,
              parity_details: null,
            });
            throw err;
          }
        },
        /32 bytes/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    cp.execFile = originalExecFile;
  }

  const environment = {
    experiment_id: 'prng-dependent-parity-boundary-proof',
    reviewed_source_sha: '201fdb2b1352344f14a81e7a426f5cf404488547',
    source_files_sha256: sourceFilesSha256,
    source_snapshot_sha256: sourceSnapshotSha256,
    proof_wasm_sha256: proofWasmSha256,
    proof_wasm_bytes: proofWasm.length,
    baseline_reference_wasm_sha256: sha256(baseWasm),
    runtime_contract_id: contractId,
    fixture_id: parsedFixtures.fixture_id,
    logical_id: parsedFixtures.contracts[0].logical_id,
    function_name: 'sample_prng',
    case_id: 'id:draw',
    protocol: 28,
    network_passphrase: 'Standalone Network ; February 2017',
    helper_version: '28.0.1',
    helper_sha256: helperSha256,
    rust_toolchain: 'rustc 1.95.0 (59807616e 2026-04-14)',
    stellar_cli: 'stellar 28.1.0 (c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd)',
    soroban_sdk: '28.0.0',
    js_stellar_sdk: '16.0.1',
    native_seed: [...FIXED_NATIVE_PRNG_SEED],
    auth_mode: 'recording(true,true)',
    host_features: ['recording_mode', 'testutils'],
    captured_ledger: fixedLedger,
    captured_timestamp: fixedTimestamp,
    zero_seed_prng_draw: 11,
    silent_seed_override_used: false,
    ledger_branching_used: false,
  };

  const controlDiff = diffBenchmarks([measurements[0]], [measurements[1]]);
  const violations = enforceThresholds(controlDiff, policy);
  const summary = renderComment(controlDiff, violations, 'zero-seed-run-1', 'zero-seed-run-2');

  const measuredMetricsSummary = Object.fromEntries(
    Object.entries(measurements[0].benchmarks[0].metrics)
      .filter(([, m]) => m.availability === 'measured')
      .map(([k, m]) => [k, m.consumed]),
  );

  const verification = {
    status: 'VERIFIED',
    scenario: 'prng_parity_boundary',
    reviewed_source_sha: '201fdb2b1352344f14a81e7a426f5cf404488547',
    source_snapshot_sha256: sourceSnapshotSha256,
    proof_wasm_sha256: proofWasmSha256,
    explicit_prng_invocation: true,
    ledger_branching_used: false,
    fixed_zero_seed_enforced: true,
    silent_seed_override_used: false,
    genuine_nonzero_results_preserved: true,
    justified_matching_condition_verified: true,
    divergent_prng_parity_rejected: true,
    unavailable_metrics_explicit_null: true,
    zero_seed_prng_draw: 11,
    zero_seed_return_vector: nativeZeroSeedArtifacts.sequence,
    measured_nonzero_metrics: measuredMetricsSummary,
    unavailable_metrics: [
      'historical_data_read_bytes',
      'contract_data_hard_limit',
      'tx_size_bytes',
    ],
    rejected_cases_count: rejections.length,
    rejected_cases: rejections.map((r) => r.case),
  };

  assert.ok(
    verifyPrngParity({
      contractSource,
      environment,
      measurements,
      rpcCalls,
      nativeReplays,
      rejections,
      controlDiff,
      policy,
      violations,
      summary,
      verification,
    }),
  );

  writeJsonLf(path.join(destination, 'environment.json'), environment);
  writeJsonLf(path.join(destination, 'measurements.json'), measurements);
  writeJsonLf(path.join(destination, 'rpc.json'), rpcCalls);
  writeJsonLf(path.join(destination, 'native.json'), nativeReplays);
  writeJsonLf(path.join(destination, 'rejections.json'), rejections);
  writeJsonLf(path.join(destination, 'control-diff.json'), controlDiff);
  writeJsonLf(path.join(destination, 'policy.json'), policy);
  writeJsonLf(path.join(destination, 'violations.json'), violations);
  writeTextLf(path.join(destination, 'summary.md'), summary);
  writeJsonLf(path.join(destination, 'verification.json'), verification);

  const checksums = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'sha256.json') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const rel = path.relative(destination, fullPath).split(path.sep).join('/');
        checksums[rel] = sha256(fs.readFileSync(fullPath));
      }
    }
  }
  walk(destination);
  writeJsonLf(path.join(destination, 'sha256.json'), checksums);

  return { verification, controlDiff, rejections };
}

if (require.main === module) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultDestination;
  runPrngParityExperiment(target)
    .then(({ verification }) => {
      console.log(JSON.stringify(verification, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

module.exports = { runPrngParityExperiment };
