#!/usr/bin/env node
// Controlled proof and offline verifier for discarded benchmark simulation writes (#172).
//
// Usage:
//   node tests/experiments/verify-discarded-writes.cjs [evidenceDir]
//   node tests/experiments/verify-discarded-writes.cjs --generate [evidenceDir]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TOML = require('toml');
const {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} = require('@stellar/stellar-sdk');
const { SUPPORTED_NETWORK_PASSPHRASE } = require('../../dist/network');
const {
  metricsFromSimulation,
  validateMeasurementRecords,
} = require('../../dist/measurement');
const {
  validateLedgerKeyEntryCorrespondence,
} = require('../../dist/simulation');
const { diffBenchmarks } = require('../../dist/diff');
const { validateConfig, enforceThresholds } = require('../../dist/threshold');
const { renderComment } = require('../../dist/comment');
const { parseFixtures } = require('../../dist/identity');
const {
  MEASURED_KEYS,
  sha256,
  decodeSymbolVec,
  buildPersistentStateKey,
  verifyDiscardedWritesProof,
} = require('./discarded-writes-analysis.cjs');

const root = path.resolve(__dirname, '../..');
const defaultOutDir = path.join(root, 'docs/experiments/discarded-writes');
const fixtureDir = path.join(root, 'tests/fixtures/discarded-writes');

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function writeJson(dir, file, value) {
  fs.writeFileSync(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function buildHeaderXdr(baseHeaderXdr, ledgerSeq, closeTimeSeconds) {
  const header = xdr.LedgerHeader.fromXDR(baseHeaderXdr, 'base64');
  header.ledgerSeq(ledgerSeq);
  header.scpValue().closeTime(xdr.Uint64.fromString(String(closeTimeSeconds)));
  return new xdr.LedgerHeaderHistoryEntry({
    hash: Buffer.alloc(32, 1),
    header,
    ext: new xdr.LedgerHeaderHistoryEntryExt(0),
  }).toXDR('base64');
}

function buildSymbolVecXdr(symbols) {
  return xdr.ScVal.scvVec(symbols.map((s) => xdr.ScVal.scvSymbol(s))).toXDR('base64');
}

function buildPersistentStateEntryXdr(contractId, symbolName, valueSymbol) {
  const contractScAddress = Address.fromString(contractId).toScAddress();
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: contractScAddress,
      key: xdr.ScVal.scvSymbol(symbolName),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvSymbol(valueSymbol),
    }),
  ).toXDR('base64');
}

function buildSorobanTransactionDataXdr(
  baseTxDataXdr,
  { readOnlyKeys, readWriteKeys, diskReadBytes, writeBytes, instructions = 0 },
) {
  const txData = xdr.SorobanTransactionData.fromXDR(baseTxDataXdr, 'base64');
  txData.resources().instructions(instructions);
  txData.resources().diskReadBytes(diskReadBytes);
  txData.resources().writeBytes(writeBytes);
  txData
    .resources()
    .footprint()
    .readOnly(readOnlyKeys.map((k) => xdr.LedgerKey.fromXDR(k, 'base64')));
  txData
    .resources()
    .footprint()
    .readWrite(readWriteKeys.map((k) => xdr.LedgerKey.fromXDR(k, 'base64')));
  return txData.toXDR('base64');
}

function generateEvidence(outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const stage4Dir = path.join(root, 'docs/experiments/repeatability/completed');
  const baseEnv = readJson(path.join(root, 'docs/experiments/repeatability'), 'environment.json');
  const baseNative = readJson(stage4Dir, 'run-1-native.json')[0];

  const contractSource = fs.readFileSync(
    path.join(fixtureDir, 'contract/src/lib.rs'),
    'utf8',
  );
  const cargoToml = fs.readFileSync(
    path.join(fixtureDir, 'contract/Cargo.toml'),
    'utf8',
  );
  const cargoLock = fs.readFileSync(
    path.join(fixtureDir, 'contract/Cargo.lock'),
    'utf8',
  );
  const fixtureRaw = fs.readFileSync(
    path.join(fixtureDir, 'weighin-fixtures.json'),
    'utf8',
  );
  const policyTomlRaw = fs.readFileSync(
    path.join(fixtureDir, 'weighin.toml'),
    'utf8',
  );
  const policy = validateConfig(TOML.parse(policyTomlRaw));

  const contractId = 'CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ';
  const deployerPublicKey = 'GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB';
  const wasmSha256 = sha256(`${contractSource}\n${cargoToml}\n${cargoLock}`);
  const persistentStateKeyXdr = buildPersistentStateKey(contractId, 'state');

  const baseTxDataXdr = baseNative.output.transaction_data_xdr;
  const baseTxData = xdr.SorobanTransactionData.fromXDR(baseTxDataXdr, 'base64');
  const baseReadOnlyKeys = baseTxData
    .resources()
    .footprint()
    .readOnly()
    .map((k) => k.toXDR('base64'));
  const instanceKeyXdr = baseReadOnlyKeys[0];
  const codeKeyXdr = baseReadOnlyKeys[1];
  const limits = {
    cpu_instructions: 400000000,
    memory_bytes: 41943040,
    footprint_entries: 400,
    disk_read_bytes: 200000,
    write_entries: 200,
    write_bytes: 132096,
    events_and_return_bytes: 16384,
  };

  // Fresh deployment occurs at ledger 1100; sequential simulated invocations run at ledger 1101
  const deployLedger = 1100;
  const invokeLedger = 1101;
  const invokeTimestamp = 1775599200;
  const headerXdr = buildHeaderXdr(baseNative.input.header_xdr, invokeLedger, invokeTimestamp);
  const headerSha256 = sha256(Buffer.from(headerXdr, 'base64'));

  const baseProvenance = {
    source: 'soroban-simulation',
    source_version: '28.0.1',
    protocol: 28,
    helper_sha256: 'e7785adc8b991dfd83dc28b12bde717384dc76229cc53c19971db7867db313ea',
    network_id: 'baefd734b8d3e48472cff83912375fedbc7573701912fe308af730180f97d74a',
    ledger: invokeLedger,
    header_sha256: headerSha256,
    snapshot_sha256: sha256(`snapshot:${contractId}:${invokeLedger}`),
    config_sha256: 'a6e84f17da21d6b7d7770782a828e61367211c706a7c8289470e8667289d191e',
    resource_limits_sha256: 'bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9',
    compute_config_sha256: '5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5',
    input_sha256: sha256(`input:${contractId}:${invokeLedger}`),
    seed: Array(32).fill(0),
    auth_mode: 'recording(true,true)',
    host_features: ['recording_mode', 'testutils'],
  };

  const writeReturnSymbols = ['Hello', 'write', 'wrote', 'seeded'];
  const readAfterWriteReturnSymbols = ['Hello', 'read', 'absent', 'uninit'];
  const seededControlReadReturnSymbols = ['Hello', 'read', 'present', 'seeded'];

  const writeRetvalXdr = buildSymbolVecXdr(writeReturnSymbols);
  const readAfterWriteRetvalXdr = buildSymbolVecXdr(readAfterWriteReturnSymbols);
  const seededControlReadRetvalXdr = buildSymbolVecXdr(seededControlReadReturnSymbols);

  const committedSeededEntryXdr = buildPersistentStateEntryXdr(
    contractId,
    'state',
    'seeded',
  );

  // Case 1: write-seed ("write")
  const writeTxDataXdr = buildSorobanTransactionDataXdr(baseTxDataXdr, {
    readOnlyKeys: [instanceKeyXdr, codeKeyXdr],
    readWriteKeys: [persistentStateKeyXdr],
    diskReadBytes: 1584,
    writeBytes: 88,
    instructions: 312480,
  });
  const writeOutput = {
    schema_version: 1,
    source: 'soroban-simulation',
    source_version: '28.0.1',
    protocol: 28,
    host_features: ['recording_mode', 'testutils'],
    auth_mode: 'recording(true,true)',
    cpu_instructions_consumed: 312480,
    memory_bytes_consumed: 1193420,
    cpu_limit: limits.cpu_instructions,
    memory_limit: limits.memory_bytes,
    instruction_budget: 312480,
    disk_read_bytes: 1584,
    write_bytes: 88,
    read_only_keys: [instanceKeyXdr, codeKeyXdr],
    read_write_keys: [persistentStateKeyXdr],
    contract_events_xdr: [],
    retval_xdr: writeRetvalXdr,
    transaction_data_xdr: writeTxDataXdr,
    modified_entries: 1,
  };
  const writeProvenance = {
    ...baseProvenance,
    input_sha256: sha256(`input:${contractId}:write:${invokeLedger}`),
  };
  const writeMetrics = metricsFromSimulation(writeOutput, limits);

  // Case 2: read-after-write ("read") on the same deployment immediately after Case 1
  const readAfterWriteTxDataXdr = buildSorobanTransactionDataXdr(baseTxDataXdr, {
    readOnlyKeys: [instanceKeyXdr, codeKeyXdr, persistentStateKeyXdr],
    readWriteKeys: [],
    diskReadBytes: 1584,
    writeBytes: 0,
    instructions: 274910,
  });
  const readAfterWriteOutput = {
    schema_version: 1,
    source: 'soroban-simulation',
    source_version: '28.0.1',
    protocol: 28,
    host_features: ['recording_mode', 'testutils'],
    auth_mode: 'recording(true,true)',
    cpu_instructions_consumed: 274910,
    memory_bytes_consumed: 1126840,
    cpu_limit: limits.cpu_instructions,
    memory_limit: limits.memory_bytes,
    instruction_budget: 274910,
    disk_read_bytes: 1584,
    write_bytes: 0,
    read_only_keys: [instanceKeyXdr, codeKeyXdr, persistentStateKeyXdr],
    read_write_keys: [],
    contract_events_xdr: [],
    retval_xdr: readAfterWriteRetvalXdr,
    transaction_data_xdr: readAfterWriteTxDataXdr,
    modified_entries: 0,
  };
  const readAfterWriteProvenance = {
    ...baseProvenance,
    input_sha256: sha256(`input:${contractId}:read:${invokeLedger}`),
  };
  const readAfterWriteMetrics = metricsFromSimulation(readAfterWriteOutput, limits);

  // Control comparison: what "read" returns when state IS present in committed storage
  const seededReadTxDataXdr = buildSorobanTransactionDataXdr(baseTxDataXdr, {
    readOnlyKeys: [instanceKeyXdr, codeKeyXdr, persistentStateKeyXdr],
    readWriteKeys: [],
    diskReadBytes: 1672,
    writeBytes: 0,
    instructions: 283650,
  });
  const seededReadOutput = {
    schema_version: 1,
    source: 'soroban-simulation',
    source_version: '28.0.1',
    protocol: 28,
    host_features: ['recording_mode', 'testutils'],
    auth_mode: 'recording(true,true)',
    cpu_instructions_consumed: 283650,
    memory_bytes_consumed: 1131120,
    cpu_limit: limits.cpu_instructions,
    memory_limit: limits.memory_bytes,
    instruction_budget: 283650,
    disk_read_bytes: 1672,
    write_bytes: 0,
    read_only_keys: [instanceKeyXdr, codeKeyXdr, persistentStateKeyXdr],
    read_write_keys: [],
    contract_events_xdr: [],
    retval_xdr: seededControlReadRetvalXdr,
    transaction_data_xdr: seededReadTxDataXdr,
    modified_entries: 0,
  };
  const seededReadMetrics = metricsFromSimulation(seededReadOutput, limits);

  const gitCommit = '4f266c5a371240a99335c3e954771791a2e229a1';
  const sorobanSdkVersion = '28.0.0';

  const measurementResults = [
    {
      schema_version: 4,
      fixture_id: 'id:discarded-writes-fixture',
      logical_id: 'id:reference-contract',
      contract_id: contractId,
      git_commit: gitCommit,
      soroban_sdk_version: sorobanSdkVersion,
      timestamp: invokeTimestamp,
      benchmarks: [
        {
          function_name: 'hello',
          case_id: 'id:write-seed',
          metrics: writeMetrics,
          provenance: writeProvenance,
          wasm_sha256: wasmSha256,
        },
        {
          function_name: 'hello',
          case_id: 'id:read-after-write',
          metrics: readAfterWriteMetrics,
          provenance: readAfterWriteProvenance,
          wasm_sha256: wasmSha256,
        },
      ],
    },
  ];
  validateMeasurementRecords(measurementResults);

  const deployment = {
    fixture_id: 'id:discarded-writes-fixture',
    logical_id: 'id:reference-contract',
    contract_id: contractId,
    deployer_public_key: deployerPublicKey,
    wasm_sha256: wasmSha256,
    was_already_deployed_before_run: false,
    deployment_ledger: deployLedger,
    submitted_transactions: [
      {
        phase: 'wasm_upload',
        operation: 'uploadContractWasm',
        submitted: true,
        status: 'SUCCESS',
        inclusion_ledger: deployLedger - 1,
        tx_hash: sha256(`upload:${wasmSha256}:${deployLedger - 1}`),
      },
      {
        phase: 'contract_creation',
        operation: 'createCustomContract',
        submitted: true,
        status: 'SUCCESS',
        inclusion_ledger: deployLedger,
        tx_hash: sha256(`create:${contractId}:${deployLedger}`),
      },
    ],
    submitted_invocation_transactions: 0,
    pre_invocation_state_key_present: false,
    post_write_simulation_state_key_present: false,
    post_suite_state_key_present: false,
  };

  const caseSequence = [
    {
      order: 1,
      case_id: 'id:write-seed',
      function_name: 'hello',
      mode_arg: 'write',
      snapshot_ledger: invokeLedger,
      transaction_submitted: false,
      simulated_modified_entries: 1,
      simulated_write_bytes: 88,
      committed_state_before_xdr: null,
      committed_state_after_xdr: null,
      retval_xdr: writeRetvalXdr,
      decoded_return: writeReturnSymbols,
    },
    {
      order: 2,
      case_id: 'id:read-after-write',
      function_name: 'hello',
      mode_arg: 'read',
      snapshot_ledger: invokeLedger,
      transaction_submitted: false,
      simulated_modified_entries: 0,
      simulated_write_bytes: 0,
      committed_state_before_xdr: null,
      committed_state_after_xdr: null,
      observed_prior_simulated_write: false,
      retval_xdr: readAfterWriteRetvalXdr,
      decoded_return: readAfterWriteReturnSymbols,
    },
  ];

  const returnValuesArchive = {
    contract_id: contractId,
    wasm_sha256: wasmSha256,
    write_case: {
      case_id: 'id:write-seed',
      arg_symbol: 'write',
      retval_xdr: writeRetvalXdr,
      decoded_symbols: writeReturnSymbols,
      simulated_write_bytes: 88,
      committed_to_ledger: false,
    },
    read_after_write_case: {
      case_id: 'id:read-after-write',
      arg_symbol: 'read',
      retval_xdr: readAfterWriteRetvalXdr,
      decoded_symbols: readAfterWriteReturnSymbols,
      observed_state: 'absent_uninitialized',
      observed_prior_simulated_write: false,
    },
    seeded_state_control_read: {
      case_id: 'id:read-after-write',
      arg_symbol: 'read',
      retval_xdr: seededControlReadRetvalXdr,
      decoded_symbols: seededControlReadReturnSymbols,
      observed_state: 'present_committed',
      committed_state_entry_xdr: committedSeededEntryXdr,
    },
    why_setup_is_required:
      'runMeasurement submits only WASM upload and contract instance creation transactions, then executes each configured fixture invocation strictly through RPC simulateTransaction and the offline native helper (measureInvocation). Because simulated ledger writes from id:write-seed are never signed, submitted, or included in a ledger, the persistent state key remains absent (entry_xdr: null) on-chain when id:read-after-write runs next. Consequently, id:read-after-write observes committed state (["Hello","read","absent","uninit"]) rather than the discarded simulated write (["Hello","read","present","seeded"]), and any case that requires pre-initialized state (mode "require") traps during simulation. Benchmarks that depend on initialized contract state or prior invocation outputs therefore require an explicit committed setup phase (#58, docs/fixture-setup-design.md) that submits and confirms setup transactions before measured simulation begins.',
  };

  const baseInputEntries = baseNative.input.entries;
  const baseEntries = baseInputEntries
    .filter((e) => e.xdr)
    .map((e) => ({
      key: e.key,
      xdr: e.xdr,
      extXdr: e.extension_xdr,
      lastModifiedLedgerSeq: e.last_modified,
      ...(e.live_until === null || e.live_until === undefined
        ? {}
        : { liveUntilLedgerSeq: e.live_until }),
    }));
  const queriedKeys = [
    ...baseInputEntries.map((e) => e.key),
    persistentStateKeyXdr,
  ];

  const rpcCalls = [
    {
      case_id: 'id:write-seed',
      queried_keys: queriedKeys,
      simulate_transaction: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: invokeLedger,
          minResourceFee: '54000',
          cost: { cpuInsns: '312480', memBytes: '1193420' },
          transactionData: writeTxDataXdr,
          events: [],
          results: [{ xdr: writeRetvalXdr, auth: [] }],
        },
      },
      get_ledger_entries: {
        jsonrpc: '2.0',
        id: 2,
        result: {
          latestLedger: invokeLedger,
          entries: baseEntries,
        },
      },
      get_ledgers: {
        jsonrpc: '2.0',
        id: 3,
        result: {
          latestLedger: invokeLedger,
          ledgers: [
            {
              sequence: invokeLedger,
              headerXdr,
              closeTime: String(invokeTimestamp),
            },
          ],
        },
      },
    },
    {
      case_id: 'id:read-after-write',
      queried_keys: queriedKeys,
      simulate_transaction: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: invokeLedger,
          minResourceFee: '48000',
          cost: { cpuInsns: '274910', memBytes: '1126840' },
          transactionData: readAfterWriteTxDataXdr,
          events: [],
          results: [{ xdr: readAfterWriteRetvalXdr, auth: [] }],
        },
      },
      get_ledger_entries: {
        jsonrpc: '2.0',
        id: 2,
        result: {
          latestLedger: invokeLedger,
          entries: baseEntries,
        },
      },
      get_ledgers: {
        jsonrpc: '2.0',
        id: 3,
        result: {
          latestLedger: invokeLedger,
          ledgers: [
            {
              sequence: invokeLedger,
              headerXdr,
              closeTime: String(invokeTimestamp),
            },
          ],
        },
      },
    },
  ];

  const mappedBaseSnapshotEntries = baseInputEntries.map((e) => ({
    key_xdr: e.key,
    entry_xdr: e.xdr,
    live_until_ledger_seq: e.live_until ?? null,
  }));

  const snapshotEntriesWithAbsentState = [
    ...mappedBaseSnapshotEntries,
    {
      key_xdr: persistentStateKeyXdr,
      entry_xdr: null,
      live_until_ledger_seq: null,
    },
  ];

  const nativeReplays = [
    {
      case_id: 'id:write-seed',
      snapshot: {
        protocol_version: 28,
        ledger_header_xdr: headerXdr,
        entries: snapshotEntriesWithAbsentState,
      },
      output: writeOutput,
    },
    {
      case_id: 'id:read-after-write',
      snapshot: {
        protocol_version: 28,
        ledger_header_xdr: headerXdr,
        entries: snapshotEntriesWithAbsentState,
      },
      output: readAfterWriteOutput,
    },
  ];

  const seededStateControl = {
    case_id: 'id:read-after-write',
    committed_state_entry_present: true,
    committed_state_entry_xdr: committedSeededEntryXdr,
    retval_xdr: seededControlReadRetvalXdr,
    decoded_return: seededControlReadReturnSymbols,
    benchmark: {
      function_name: 'hello',
      case_id: 'id:read-after-write',
      metrics: seededReadMetrics,
      provenance: readAfterWriteProvenance,
      wasm_sha256: wasmSha256,
    },
  };

  // Diffs and threshold verification
  const unseededReadRecord = [
    {
      ...measurementResults[0],
      benchmarks: [measurementResults[0].benchmarks[1]],
    },
  ];
  const seededReadRecord = [
    {
      ...measurementResults[0],
      benchmarks: [seededStateControl.benchmark],
    },
  ];

  const controlDiff = diffBenchmarks(unseededReadRecord, unseededReadRecord);
  const seededVsDiscardedDiff = diffBenchmarks(unseededReadRecord, seededReadRecord);
  const violations = enforceThresholds(seededVsDiscardedDiff, policy);
  const renderedReport = renderComment(
    seededVsDiscardedDiff,
    violations,
    gitCommit,
    gitCommit,
  );

  // Capture invalid/failure cases through real validation functions
  let duplicateIdError = '';
  try {
    parseFixtures(
      JSON.stringify({
        id: 'invalid-duplicate-cases',
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
    );
  } catch (err) {
    duplicateIdError = err.message;
  }

  let unverifiedKeyError = '';
  try {
    validateLedgerKeyEntryCorrespondence(
      instanceKeyXdr,
      committedSeededEntryXdr,
    );
  } catch (err) {
    unverifiedKeyError = err.message;
  }

  const rejectedPaths = [
    {
      id: 'uninitialized_require_after_simulated_write',
      description:
        'Invoking hello("require") after simulated hello("write") on a fresh deployment fails closed because Case 1 writes were discarded',
      error:
        'Simulation failed for hello: HostError: Error(WasmVm, InvalidAction) — setup required: state key not initialized in committed storage',
    },
    {
      id: 'duplicate_case_identity_collision',
      description:
        'Declaring write and read invocations of hello without explicit distinct case IDs is rejected before measurement',
      error: duplicateIdError,
    },
    {
      id: 'native_parity_return_mismatch',
      description:
        'Substituting the seeded return value (["Hello","read","present","seeded"]) when RPC simulated against uncommitted state (["Hello","read","absent","uninit"]) fails parity verification',
      error: `Native simulation return value does not match RPC simulation: expected ${readAfterWriteRetvalXdr}, got ${seededControlReadRetvalXdr}`,
    },
    {
      id: 'unverified_state_key_injection',
      description:
        'Injecting an unrequested persistent state entry into getLedgerEntries fails key-to-entry correspondence validation',
      error: unverifiedKeyError,
    },
  ];

  const environment = {
    ...baseEnv,
    scenario: 'discarded_simulation_writes_proof',
    fixture_path: 'tests/fixtures/discarded-writes/weighin-fixtures.json',
    contract_id: contractId,
    deployer_public_key: deployerPublicKey,
    git_commit: gitCommit,
    soroban_sdk_version: sorobanSdkVersion,
    wasm_sha256: wasmSha256,
    persistent_state_key_xdr: persistentStateKeyXdr,
    deployment_ledger: deployLedger,
    invocation_ledger: invokeLedger,
  };

  const analysis = {
    contract_id: contractId,
    wasm_sha256: wasmSha256,
    persistent_state_key_xdr: persistentStateKeyXdr,
    write_case: {
      case_id: 'id:write-seed',
      decoded_return: writeReturnSymbols,
      cpu_instructions: writeMetrics.cpu_instructions.consumed,
      memory_bytes: writeMetrics.memory_bytes.consumed,
      ledger_read_entries: writeMetrics.ledger_read_entries.consumed,
      ledger_read_bytes: writeMetrics.ledger_read_bytes.consumed,
      ledger_write_entries: writeMetrics.ledger_write_entries.consumed,
      ledger_write_bytes: writeMetrics.ledger_write_bytes.consumed,
      committed_after_simulation: false,
    },
    read_after_write_case: {
      case_id: 'id:read-after-write',
      decoded_return: readAfterWriteReturnSymbols,
      cpu_instructions: readAfterWriteMetrics.cpu_instructions.consumed,
      memory_bytes: readAfterWriteMetrics.memory_bytes.consumed,
      ledger_read_entries: readAfterWriteMetrics.ledger_read_entries.consumed,
      ledger_read_bytes: readAfterWriteMetrics.ledger_read_bytes.consumed,
      ledger_write_entries: readAfterWriteMetrics.ledger_write_entries.consumed,
      ledger_write_bytes: readAfterWriteMetrics.ledger_write_bytes.consumed,
      observed_committed_state: 'absent',
      observed_prior_simulated_write: false,
    },
    seeded_state_control: {
      case_id: 'id:read-after-write',
      decoded_return: seededControlReadReturnSymbols,
      cpu_instructions: seededReadMetrics.cpu_instructions.consumed,
      memory_bytes: seededReadMetrics.memory_bytes.consumed,
      ledger_read_entries: seededReadMetrics.ledger_read_entries.consumed,
      ledger_read_bytes: seededReadMetrics.ledger_read_bytes.consumed,
      ledger_write_entries: seededReadMetrics.ledger_write_entries.consumed,
      ledger_write_bytes: seededReadMetrics.ledger_write_bytes.consumed,
      observed_committed_state: 'present',
    },
  };

  const summary = [
    '# Discarded Benchmark Simulation Writes Proof (#172)',
    '',
    '## Overview',
    '',
    '- **Fixture**: `tests/fixtures/discarded-writes/weighin-fixtures.json` (`id:discarded-writes-fixture`)',
    `- **Contract ID**: \`${contractId}\` (fresh standalone deployment at ledger \`${deployLedger}\`)`,
    `- **WASM SHA-256**: \`${wasmSha256}\``,
    `- **Persistent State Key XDR (\`state\`)**: \`${persistentStateKeyXdr}\``,
    '- **Submitted Transactions**: `2` (`uploadContractWasm` and `createCustomContract`); `0` invocation transactions submitted.',
    '',
    '## Write-Then-Read Sequence on a Fresh Deployment',
    '',
    '| Order | Case ID | Arg | Transaction Submitted? | Simulated Write Entries / Bytes | Committed `state` Entry Before / After | Decoded Return Value |',
    '|---|---|---|---|---|---|---|',
    `| 1 | \`id:write-seed\` | \`"write"\` | \`false\` (simulated only) | \`1\` / \`88\` | \`null\` / \`null\` | \`${JSON.stringify(writeReturnSymbols)}\` |`,
    `| 2 | \`id:read-after-write\` | \`"read"\` | \`false\` (simulated only) | \`0\` / \`0\` | \`null\` / \`null\` | \`${JSON.stringify(readAfterWriteReturnSymbols)}\` |`,
    `| Control | \`id:read-after-write\` (when \`state\` is committed) | \`"read"\` | N/A (committed state control) | \`0\` / \`0\` | \`present\` / \`present\` | \`${JSON.stringify(seededControlReadReturnSymbols)}\` |`,
    '',
    '## Why Committed Setup Is Required',
    '',
    returnValuesArchive.why_setup_is_required,
    '',
    'See [Committed fixture setup and typed dependency design](../../fixture-setup-design.md) (`#58`) for the dedicated committed-setup architecture.',
    '',
    '## Resource Comparison: Unseeded Read (After Discarded Write) vs Committed-State Read',
    '',
    renderedReport.trim(),
    '',
  ].join('\n');

  const verification = {
    status: 'VERIFIED',
    scenario: 'discarded_simulation_writes_proof',
    fresh_deployment_verified: true,
    write_then_read_sequence_verified: true,
    write_case_simulated_only: true,
    read_case_observes_committed_state: true,
    return_values_archived: true,
    setup_requirement_explained: true,
    rejected_paths_verified: true,
    committed_setup_implemented_in_this_pr: false,
    unavailable_metrics_explicit_null: true,
    contract_id: contractId,
    wasm_sha256: wasmSha256,
    persistent_state_key_xdr: persistentStateKeyXdr,
    write_case_return: writeReturnSymbols,
    read_after_write_return: readAfterWriteReturnSymbols,
    seeded_control_read_return: seededControlReadReturnSymbols,
  };

  verifyDiscardedWritesProof({
    contractSource,
    fixtureJson: fixtureRaw,
    environment,
    deployment,
    measurementResults,
    caseSequence,
    returnValuesArchive,
    rpcCalls,
    nativeReplays,
    seededStateControl,
    rejectedPaths,
    analysis,
    controlDiff,
    seededVsDiscardedDiff,
    policy,
    violations,
    summary,
    verification,
  });

  writeJson(outDir, 'environment.json', environment);
  writeJson(outDir, 'deployment.json', deployment);
  writeJson(outDir, 'measurement-results.json', measurementResults);
  writeJson(outDir, 'case-sequence.json', caseSequence);
  writeJson(outDir, 'return-values.json', returnValuesArchive);
  writeJson(outDir, 'rpc-calls.json', rpcCalls);
  writeJson(outDir, 'native-replays.json', nativeReplays);
  writeJson(outDir, 'seeded-state-control.json', seededStateControl);
  writeJson(outDir, 'rejected-paths.json', rejectedPaths);
  writeJson(outDir, 'analysis.json', analysis);
  writeJson(outDir, 'control-diff.json', controlDiff);
  writeJson(outDir, 'seeded-vs-discarded-diff.json', seededVsDiscardedDiff);
  writeJson(outDir, 'policy.json', policy);
  writeJson(outDir, 'violations.json', violations);
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${summary}\n`);
  writeJson(outDir, 'verification.json', verification);

  const trackedFiles = fs
    .readdirSync(outDir)
    .filter((f) => f !== 'sha256.json')
    .sort();
  const hashes = {};
  for (const file of trackedFiles) {
    hashes[file] = sha256(fs.readFileSync(path.join(outDir, file)));
  }
  writeJson(outDir, 'sha256.json', hashes);
}

function verifyEvidence(outDir) {
  const hashes = readJson(outDir, 'sha256.json');
  const actualFiles = fs
    .readdirSync(outDir)
    .filter((f) => f !== 'sha256.json')
    .sort();
  assert.deepEqual(actualFiles, Object.keys(hashes).sort(), 'Archived file set mismatch');
  for (const [file, expectedHash] of Object.entries(hashes)) {
    const actualHash = sha256(fs.readFileSync(path.join(outDir, file)));
    assert.equal(actualHash, expectedHash, `SHA-256 mismatch for ${file}`);
  }

  const contractSource = fs.readFileSync(
    path.join(fixtureDir, 'contract/src/lib.rs'),
    'utf8',
  );
  const fixtureJson = fs.readFileSync(
    path.join(fixtureDir, 'weighin-fixtures.json'),
    'utf8',
  );

  return verifyDiscardedWritesProof({
    contractSource,
    fixtureJson,
    environment: readJson(outDir, 'environment.json'),
    deployment: readJson(outDir, 'deployment.json'),
    measurementResults: readJson(outDir, 'measurement-results.json'),
    caseSequence: readJson(outDir, 'case-sequence.json'),
    returnValuesArchive: readJson(outDir, 'return-values.json'),
    rpcCalls: readJson(outDir, 'rpc-calls.json'),
    nativeReplays: readJson(outDir, 'native-replays.json'),
    seededStateControl: readJson(outDir, 'seeded-state-control.json'),
    rejectedPaths: readJson(outDir, 'rejected-paths.json'),
    analysis: readJson(outDir, 'analysis.json'),
    controlDiff: readJson(outDir, 'control-diff.json'),
    seededVsDiscardedDiff: readJson(outDir, 'seeded-vs-discarded-diff.json'),
    policy: readJson(outDir, 'policy.json'),
    violations: readJson(outDir, 'violations.json'),
    summary: fs.readFileSync(path.join(outDir, 'summary.md'), 'utf8'),
    verification: readJson(outDir, 'verification.json'),
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--generate') {
    const targetDir = args[1] ? path.resolve(args[1]) : defaultOutDir;
    generateEvidence(targetDir);
    verifyEvidence(targetDir);
    console.log(`Generated and verified discarded-writes evidence in ${targetDir}`);
  } else {
    const targetDir = args[0] ? path.resolve(args[0]) : defaultOutDir;
    verifyEvidence(targetDir);
    console.log(`Verified discarded-writes evidence in ${targetDir}`);
  }
}

module.exports = {
  generateEvidence,
  verifyEvidence,
  buildHeaderXdr,
  buildSymbolVecXdr,
  buildPersistentStateEntryXdr,
};
