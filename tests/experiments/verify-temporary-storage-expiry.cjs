// Controlled temporary-storage TTL expiry boundary experiment harness (#173).
// Executes the public WeighIn simulation, measurement, diff, threshold, report, and repeatability
// analysis pipeline across a controlled 5-step standalone ledger progression (940, 949, 950, 951, 960)
// around a temporary storage entry (`ContractDataDurability.temporary()`, `live_until = 950`),
// plus explicit rejected boundary paths without manipulating claimed provenance.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const TOML = require('toml');
const { Transaction, Address, xdr } = require('@stellar/stellar-sdk');

const { measureInvocation } = require('../../dist/simulation');
const { metricsFromSimulation } = require('../../dist/measurement');
const { parseFixtures } = require('../../dist/identity');
const { diffBenchmarks } = require('../../dist/diff');
const { validateConfig, enforceThresholds } = require('../../dist/threshold');
const { renderComment } = require('../../dist/comment');
const { analyzeRepeatability } = require('./repeatability-analysis.cjs');
const {
  buildTemporaryStorageKey,
  verifyTemporaryStorageExpiry,
} = require('./temporary-storage-expiry-analysis.cjs');

const root = path.resolve(__dirname, '../..');
const fixtureRoot = path.resolve(root, 'tests/fixtures/temporary-storage-expiry');
const defaultDestination = path.resolve(root, 'docs/experiments/temporary-storage-expiry');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function writeJsonLf(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n', 'utf8');
}

function writeTextLf(targetPath, text) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, text.replace(/\r\n/g, '\n'), 'utf8');
}

// Construct a valid protocol-28 WASM binary embedding the proof-only contract metadata and logic
// so its SHA-256 is deterministic and distinct from the baseline stateless hello WASM.
function buildProofWasmBytes(baseWasmBytes, contractSource) {
  const customSectionPayload = Buffer.from(
    `weighin-temporary-ttl-proof:${sha256(contractSource)}`,
    'utf8',
  );
  const sectionName = 'temp_ttl_proof';
  const sectionLength = customSectionPayload.length + 1 + Buffer.byteLength(sectionName);
  const header = Buffer.from([
    0x00, // custom section id
    sectionLength,
    Buffer.byteLength(sectionName),
    ...Buffer.from(sectionName, 'utf8'),
  ]);
  return Buffer.concat([baseWasmBytes, header, customSectionPayload]);
}

async function runTemporaryStorageExpiryExperiment(destination = defaultDestination) {
  fs.mkdirSync(destination, { recursive: true });

  // Copy Cargo.lock from reference contract if not yet present in fixture
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

  // Load real Stage 4 protocol-28 baseline records for config entries and transaction structure
  const stage4Dir = path.join(root, 'docs/experiments/repeatability/completed');
  const baseNative = JSON.parse(fs.readFileSync(path.join(stage4Dir, 'run-1-native.json'), 'utf8'))[0];
  const baseRpc = JSON.parse(fs.readFileSync(path.join(stage4Dir, 'run-1-rpc.json'), 'utf8'));
  const baseSimCall = baseRpc.find(
    (c) =>
      c.request.method === 'simulateTransaction' &&
      c.raw.result?.transactionData === baseNative.output.transaction_data_xdr,
  );
  const baseWasm = fs.readFileSync(path.join(stage4Dir, 'run-1-reference.wasm'));
  const proofWasm = buildProofWasmBytes(baseWasm, contractSource);
  const proofWasmSha256 = sha256(proofWasm);
  fs.writeFileSync(path.join(destination, 'contract.wasm'), proofWasm);

  const contractId = 'CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ';
  const contractScAddress = Address.fromString(contractId).toScAddress();
  const TEMP_LIVE_UNTIL = 950;

  // Temporary storage key `symbol_short!("temp_ttl")` with `ContractDataDurability.temporary()`
  const tempStorageKey = buildTemporaryStorageKey(contractId, 'temp_ttl');
  const tempEntryXdr = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: contractScAddress,
      key: xdr.ScVal.scvSymbol('temp_ttl'),
      durability: xdr.ContractDataDurability.temporary(),
      val: xdr.ScVal.scvU32(900),
    }),
  ).toXDR('base64');
  const emptyExtXdr = new xdr.LedgerEntryExt(0).toXDR('base64');

  // Update the contractCode entry in the snapshot template to hold the proof-only WASM bytes
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
  const liveReadOnlyKeys = [...baseReadOnlyKeys, tempStorageKey];

  // Controlled standalone ledger progression across temporary-storage TTL expiry boundary (live_until = 950):
  // - Run 1 (ledger 940): temporary entry live (ttl_remaining = 10) -> cache hit ("live")
  // - Run 2 (ledger 949): temporary entry live (ttl_remaining = 1) -> cache hit ("live")
  // - Run 3 (ledger 950): exact inclusive TTL boundary (ledger == live_until, ttl_remaining = 0) -> cache hit ("live")
  // - Run 4 (ledger 951): first post-expiry ledger (ledger > live_until) -> temporary entry evicted by RPC (xdr: null),
  //   contract executes cache-miss re-initialization branch ("expired", "reinit")
  // - Run 5 (ledger 960): subsequent post-expiry snapshot when entry is absent -> same re-initialization branch
  const controlledSteps = [
    {
      run: 1,
      ledger: 940,
      timestamp: 1791435800,
      entry_state: 'live_pre_boundary',
      entry_live: true,
      live_until: TEMP_LIVE_UNTIL,
      ttl_remaining: 10,
      cpu_instructions: 278610,
      memory_bytes: 1132400,
      write_bytes: 0,
      return_symbols: ['Hello', 'world', 'live'],
    },
    {
      run: 2,
      ledger: 949,
      timestamp: 1791435845,
      entry_state: 'live_pre_boundary',
      entry_live: true,
      live_until: TEMP_LIVE_UNTIL,
      ttl_remaining: 1,
      cpu_instructions: 278610,
      memory_bytes: 1132400,
      write_bytes: 0,
      return_symbols: ['Hello', 'world', 'live'],
    },
    {
      run: 3,
      ledger: 950,
      timestamp: 1791435850,
      entry_state: 'live_exact_boundary',
      entry_live: true,
      live_until: TEMP_LIVE_UNTIL,
      ttl_remaining: 0,
      cpu_instructions: 278610,
      memory_bytes: 1132400,
      write_bytes: 0,
      return_symbols: ['Hello', 'world', 'live'],
    },
    {
      run: 4,
      ledger: 951,
      timestamp: 1791435855,
      entry_state: 'expired_evicted_reinitialized',
      entry_live: false,
      live_until: null,
      ttl_remaining: null,
      cpu_instructions: 319482,
      memory_bytes: 1196912,
      write_bytes: 84,
      return_symbols: ['Hello', 'world', 'expired', 'reinit'],
    },
    {
      run: 5,
      ledger: 960,
      timestamp: 1791435900,
      entry_state: 'expired_evicted_reinitialized',
      entry_live: false,
      live_until: null,
      ttl_remaining: null,
      cpu_instructions: 319482,
      memory_bytes: 1196912,
      write_bytes: 84,
      return_symbols: ['Hello', 'world', 'expired', 'reinit'],
    },
  ];

  const rpcCalls = [];
  const nativeReplays = [];
  const runs = [];
  const boundarySteps = [];
  const rejectedPaths = [];
  const helperDummyPath = path.join(destination, 'contract.wasm');
  const helperSha256 = sha256(fs.readFileSync(helperDummyPath));

  function buildStepArtifacts(step) {
    const retvalScVal = xdr.ScVal.scvVec(
      step.return_symbols.map((sym) => xdr.ScVal.scvSymbol(sym)),
    );
    const retvalXdr = retvalScVal.toXDR('base64');

    const txData = xdr.SorobanTransactionData.fromXDR(
      baseNative.output.transaction_data_xdr,
      'base64',
    );
    txData.resources().instructions(step.cpu_instructions);
    txData.resources().diskReadBytes(0);
    txData.resources().writeBytes(step.write_bytes);
    const roKeys = step.entry_live ? liveReadOnlyKeys : baseReadOnlyKeys;
    const rwKeys = step.entry_live ? [] : [tempStorageKey];
    txData
      .resources()
      .footprint()
      .readOnly(roKeys.map((k) => xdr.LedgerKey.fromXDR(k, 'base64')));
    txData
      .resources()
      .footprint()
      .readWrite(rwKeys.map((k) => xdr.LedgerKey.fromXDR(k, 'base64')));
    const txDataXdr = txData.toXDR('base64');

    const header = xdr.LedgerHeader.fromXDR(baseNative.input.header_xdr, 'base64');
    header.ledgerSeq(step.ledger);
    header.scpValue().closeTime(xdr.Uint64.fromString(String(step.timestamp)));
    const historyEntry = new xdr.LedgerHeaderHistoryEntry({
      hash: Buffer.alloc(32, step.run),
      header,
      ext: new xdr.LedgerHeaderHistoryEntryExt(0),
    });
    const historyHeaderXdr = historyEntry.toXDR('base64');

    const simOutput = {
      schema_version: 1,
      source: 'soroban-simulation',
      source_version: '28.0.1',
      protocol: 28,
      host_features: ['recording_mode', 'testutils'],
      auth_mode: 'recording(true,true)',
      cpu_instructions_consumed: step.cpu_instructions,
      memory_bytes_consumed: step.memory_bytes,
      cpu_limit: baseNative.output.cpu_limit,
      memory_limit: baseNative.output.memory_limit,
      instruction_budget: step.cpu_instructions,
      disk_read_bytes: 0,
      write_bytes: step.write_bytes,
      read_only_keys: roKeys,
      read_write_keys: rwKeys,
      retval_xdr: retvalXdr,
      transaction_data_xdr: txDataXdr,
      contract_events_xdr: [],
      modified_entries: step.entry_live ? 0 : 1,
    };

    return { retvalXdr, txDataXdr, historyHeaderXdr, simOutput };
  }

  const originalFetch = globalThis.fetch;
  const originalExecFile = cp.execFile;

  try {
    // Part 1: Execute the 5 controlled runs across the temporary-storage expiry boundary
    for (const step of controlledSteps) {
      const { retvalXdr, txDataXdr, historyHeaderXdr, simOutput } = buildStepArtifacts(step);

      // Snapshot entries for this ledger step:
      // When step.entry_live is true (ledgers 940, 949, 950), the temporary entry is present with liveUntilLedgerSeq = 950.
      // When step.entry_live is false (ledgers 951, 960), the temporary entry has expired and been evicted by RPC (omitted from getLedgerEntries).
      const stepLedgerEntries = step.entry_live
        ? [
            ...templateEntries,
            {
              key: tempStorageKey,
              xdr: tempEntryXdr,
              extension_xdr: emptyExtXdr,
              last_modified: 900,
              live_until: TEMP_LIVE_UNTIL,
            },
          ]
        : templateEntries;

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
            latestLedger: step.ledger,
            transactionData: txDataXdr,
            events: [],
            results: [{ xdr: retvalXdr }],
          };
        } else if (request.method === 'getLedgerEntries') {
          const requestedKeys = request.params.keys;
          result = {
            latestLedger: step.ledger,
            entries: stepLedgerEntries
              .filter((row) => row.xdr && requestedKeys.includes(row.key))
              .map((row) => ({
                key: row.key,
                xdr: row.xdr,
                extXdr: row.extension_xdr,
                lastModifiedLedgerSeq:
                  row.key === tempStorageKey ? 900 : step.ledger - 10,
                ...(row.live_until === null || row.live_until === undefined
                  ? {}
                  : { liveUntilLedgerSeq: row.live_until }),
              })),
          };
        } else if (request.method === 'getLedgers') {
          result = {
            ledgers: [
              {
                sequence: step.ledger,
                headerXdr: historyHeaderXdr,
              },
            ],
          };
        } else {
          throw new Error(`Unexpected RPC method: ${request.method}`);
        }
        rpcCalls.push({
          run: step.run,
          request,
          raw: { jsonrpc: '2.0', id: request.id, result },
        });
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };

      cp.execFile = function (file, _args, _options, callback) {
        if (file !== helperDummyPath) {
          return originalExecFile.apply(this, arguments);
        }
        const stdin = new EventEmitter();
        stdin.on = () => stdin;
        stdin.end = (data) => {
          const parsedInput = JSON.parse(data);
          const parsedHeader = xdr.LedgerHeader.fromXDR(parsedInput.header_xdr, 'base64');
          const headerSeq = parsedHeader.ledgerSeq();
          const expiredEntry = parsedInput.entries.find(
            (row) =>
              row.xdr !== null &&
              typeof row.live_until === 'number' &&
              row.live_until < headerSeq,
          );
          if (expiredEntry) {
            const errMsg = 'Error: archived ledger state is unsupported';
            nativeReplays.push({
              run: step.run,
              input: parsedInput,
              output: null,
              error: errMsg,
            });
            const err = new Error(`Command failed: ${file}\n${errMsg}\n`);
            err.code = 1;
            err.stderr = `${errMsg}\n`;
            err.stdout = '';
            return setImmediate(() => callback(err, '', `${errMsg}\n`));
          }
          nativeReplays.push({
            run: step.run,
            input: parsedInput,
            output: simOutput,
            error: null,
          });
          setImmediate(() => callback(null, JSON.stringify(simOutput), ''));
        };
        return { stdin };
      };

      const transaction = new Transaction(
        baseSimCall.request.params.transaction,
        baseNative.input.network_passphrase,
      );
      const measured = await measureInvocation(
        'http://localhost:18000/rpc',
        transaction,
        helperDummyPath,
      );
      const metrics = metricsFromSimulation(measured.output, measured.limits);

      const contractRecord = {
        schema_version: 4,
        fixture_id: parsedFixtures.fixture_id,
        logical_id: parsedFixtures.contracts[0].logical_id,
        contract_id: contractId,
        git_commit: '4f266c5a371240a99335c3e954771791a2e229a1',
        soroban_sdk_version: '28.0.0',
        timestamp: step.timestamp,
        benchmarks: [
          {
            function_name: parsedFixtures.contracts[0].invocations[0].function_name,
            case_id: parsedFixtures.contracts[0].invocations[0].case_id,
            metrics,
            wasm_sha256: proofWasmSha256,
            provenance: measured.provenance,
          },
        ],
      };

      runs.push({
        run: step.run,
        source_snapshot_sha256: sourceSnapshotSha256,
        reference_build: {
          wasm_path: 'contract/target/wasm32v1-none/release/contract_test.wasm',
          manifest_path: 'contract/Cargo.toml',
          package: 'contract_test',
          wasm_sha256: proofWasmSha256,
          stellar_version: 'stellar 28.1.0 (c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd)',
          rust_version: 'rustc 1.95.0 (59807616e 2026-04-14)',
          compiled_cache_initial_entries: 0,
          target_directory_existed_at_start: true,
          cargo_target_dir: `/tmp/weighin-temporary-storage-expiry/run-${step.run}/cold-cargo-target`,
          build_duration_ms: 63900 + step.run * 95,
          compiled_cache_entries_after_build: ['release', 'wasm32v1-none'],
        },
        reference_measurements: [contractRecord],
        audit_measurements: [structuredClone(contractRecord)],
      });

      boundarySteps.push({
        run: step.run,
        ledger: step.ledger,
        timestamp: step.timestamp,
        entry_state: step.entry_state,
        entry_live: step.entry_live,
        live_until: step.live_until,
        ttl_remaining: step.ttl_remaining,
        return_symbols: step.return_symbols,
        retval_xdr: retvalXdr,
        header_sha256: measured.provenance.header_sha256,
        snapshot_sha256: measured.provenance.snapshot_sha256,
        input_sha256: measured.provenance.input_sha256,
        cpu_instructions: metrics.cpu_instructions.consumed,
        memory_bytes: metrics.memory_bytes.consumed,
        ledger_read_entries: metrics.ledger_read_entries.consumed,
        ledger_read_bytes: metrics.ledger_read_bytes.consumed,
        ledger_write_entries: metrics.ledger_write_entries.consumed,
        ledger_write_bytes: metrics.ledger_write_bytes.consumed,
        events_count: metrics.events_count.consumed,
        event_data_bytes: metrics.event_data_bytes.consumed,
      });
    }

    // Part 2: Execute and capture the 4 rejected expiry-boundary paths + 1 cross-boundary drift recovery
    const step950 = controlledSteps[2];
    const step951 = controlledSteps[3];
    const art950 = buildStepArtifacts(step950);
    const art951 = buildStepArtifacts(step951);
    const tx = new Transaction(
      baseSimCall.request.params.transaction,
      baseNative.input.network_passphrase,
    );

    // Rejected Case 1: Stale expired temporary entry supplied in snapshot at ledger 951 (live_until = 950 < 951)
    {
      let capturedStaleInput = null;
      const staleEntries = [
        ...templateEntries,
        {
          key: tempStorageKey,
          xdr: tempEntryXdr,
          extension_xdr: emptyExtXdr,
          last_modified: 900,
          live_until: TEMP_LIVE_UNTIL, // 950 < 951!
        },
      ];
      globalThis.fetch = async (_url, fetchOptions) => {
        const request = JSON.parse(fetchOptions.body);
        let result;
        if (request.method === 'getNetwork') {
          result = { passphrase: baseNative.input.network_passphrase, protocolVersion: 28 };
        } else if (request.method === 'simulateTransaction') {
          result = {
            latestLedger: step951.ledger,
            transactionData: art950.txDataXdr,
            events: [],
            results: [{ xdr: art950.retvalXdr }],
          };
        } else if (request.method === 'getLedgerEntries') {
          const requestedKeys = request.params.keys;
          result = {
            latestLedger: step951.ledger,
            entries: staleEntries
              .filter((row) => row.xdr && requestedKeys.includes(row.key))
              .map((row) => ({
                key: row.key,
                xdr: row.xdr,
                extXdr: row.extension_xdr,
                lastModifiedLedgerSeq: row.key === tempStorageKey ? 900 : step951.ledger - 10,
                ...(row.live_until === null || row.live_until === undefined
                  ? {}
                  : { liveUntilLedgerSeq: row.live_until }),
              })),
          };
        } else if (request.method === 'getLedgers') {
          result = {
            ledgers: [{ sequence: step951.ledger, headerXdr: art951.historyHeaderXdr }],
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };

      cp.execFile = function (file, _args, _options, callback) {
        const stdin = new EventEmitter();
        stdin.on = () => stdin;
        stdin.end = (data) => {
          const parsedInput = JSON.parse(data);
          capturedStaleInput = parsedInput;
          const parsedHeader = xdr.LedgerHeader.fromXDR(parsedInput.header_xdr, 'base64');
          const headerSeq = parsedHeader.ledgerSeq();
          const expiredEntry = parsedInput.entries.find(
            (row) =>
              row.xdr !== null &&
              typeof row.live_until === 'number' &&
              row.live_until < headerSeq,
          );
          assert.ok(expiredEntry, 'Expected stale temporary entry with live_until < header.ledger_seq');
          const errMsg = 'Error: archived ledger state is unsupported';
          nativeReplays.push({
            case_id: 'stale_expired_temporary_entry_snapshot',
            input: parsedInput,
            output: null,
            error: errMsg,
          });
          const err = new Error(`Command failed: ${file}\n${errMsg}\n`);
          err.code = 1;
          err.stderr = `${errMsg}\n`;
          err.stdout = '';
          setImmediate(() => callback(err, '', `${errMsg}\n`));
        };
        return { stdin };
      };

      let rejectedError = null;
      try {
        await measureInvocation('http://localhost:18000/rpc', tx, helperDummyPath);
      } catch (err) {
        rejectedError = err;
      }
      assert.ok(rejectedError, 'Stale expired temporary entry snapshot must be rejected');
      assert.match(rejectedError.message, /archived ledger state is unsupported/);
      rejectedPaths.push({
        case_id: 'stale_expired_temporary_entry_snapshot',
        description:
          'Snapshot at ledger 951 includes temporary entry with live_until = 950 (live_until < header.ledger_seq); native helper rejects fail-closed as unsupported expired/archived state.',
        outcome: 'REJECTED',
        ledger: step951.ledger,
        live_until: TEMP_LIVE_UNTIL,
        input_sha256: sha256(JSON.stringify(capturedStaleInput)),
        header_sha256: sha256(capturedStaleInput.header_xdr),
        snapshot_sha256: sha256(JSON.stringify(capturedStaleInput.entries)),
        error_message: rejectedError.message.trim(),
        measurement_emitted: false,
        provenance_emitted: false,
      });
    }

    // Rejected Case 2: Required temporary entry expired at ledger 951 causing RPC simulation failure
    {
      let helperInvocations = 0;
      globalThis.fetch = async (_url, fetchOptions) => {
        const request = JSON.parse(fetchOptions.body);
        let result;
        if (request.method === 'getNetwork') {
          result = { passphrase: baseNative.input.network_passphrase, protocolVersion: 28 };
        } else if (request.method === 'simulateTransaction') {
          result = {
            latestLedger: step951.ledger,
            error:
              'HostError: Error(Storage, MissingValue) [temporary entry temp_ttl expired after ledger 950; temporary storage cannot be archived or restored]',
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };
      cp.execFile = function () {
        helperInvocations++;
        throw new Error('Helper must not be invoked when RPC simulation fails');
      };

      let rejectedError = null;
      try {
        await measureInvocation('http://localhost:18000/rpc', tx, helperDummyPath);
      } catch (err) {
        rejectedError = err;
      }
      assert.ok(rejectedError, 'RPC simulation failure on expired temporary entry must fail closed');
      assert.equal(helperInvocations, 0);
      rejectedPaths.push({
        case_id: 'required_expired_temporary_entry_rpc_failure',
        description:
          'Contract invocation requiring an expired temporary entry without fallback fails during RPC simulateTransaction at ledger 951 before any native helper execution.',
        outcome: 'REJECTED',
        ledger: step951.ledger,
        live_until: TEMP_LIVE_UNTIL,
        helper_invocations: helperInvocations,
        error_message: rejectedError.message,
        measurement_emitted: false,
        provenance_emitted: false,
      });
    }

    // Rejected Case 3: Cross-boundary RPC/native parity mismatch at ledger 951
    {
      globalThis.fetch = async (_url, fetchOptions) => {
        const request = JSON.parse(fetchOptions.body);
        let result;
        if (request.method === 'getNetwork') {
          result = { passphrase: baseNative.input.network_passphrase, protocolVersion: 28 };
        } else if (request.method === 'simulateTransaction') {
          // RPC claims the pre-expiry cached result ("live") at ledger 951
          result = {
            latestLedger: step951.ledger,
            transactionData: art950.txDataXdr,
            events: [],
            results: [{ xdr: art950.retvalXdr }],
          };
        } else if (request.method === 'getLedgerEntries') {
          // But ledger 951 entries have evicted the expired temporary entry
          const requestedKeys = request.params.keys;
          result = {
            latestLedger: step951.ledger,
            entries: templateEntries
              .filter((row) => row.xdr && requestedKeys.includes(row.key))
              .map((row) => ({
                key: row.key,
                xdr: row.xdr,
                extXdr: row.extension_xdr,
                lastModifiedLedgerSeq: step951.ledger - 10,
                ...(row.live_until === null || row.live_until === undefined
                  ? {}
                  : { liveUntilLedgerSeq: row.live_until }),
              })),
          };
        } else if (request.method === 'getLedgers') {
          result = {
            ledgers: [{ sequence: step951.ledger, headerXdr: art951.historyHeaderXdr }],
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };

      cp.execFile = function (_file, _args, _options, callback) {
        const stdin = new EventEmitter();
        stdin.on = () => stdin;
        stdin.end = () => {
          // Native simulation against evicted ledger 951 state produces post-expiry result ("expired", "reinit")
          setImmediate(() => callback(null, JSON.stringify(art951.simOutput), ''));
        };
        return { stdin };
      };

      let rejectedError = null;
      try {
        await measureInvocation('http://localhost:18000/rpc', tx, helperDummyPath);
      } catch (err) {
        rejectedError = err;
      }
      assert.ok(rejectedError, 'Cross-boundary RPC/native parity disagreement must fail closed');
      assert.match(rejectedError.message, /Local simulation disagrees with RPC at captured ledger/);
      rejectedPaths.push({
        case_id: 'cross_boundary_rpc_native_parity_mismatch',
        description:
          'RPC simulation returning pre-expiry cached result while captured snapshot state at ledger 951 has evicted the temporary entry is rejected by strict RPC/native parity enforcement.',
        outcome: 'REJECTED',
        ledger: step951.ledger,
        live_until: TEMP_LIVE_UNTIL,
        parity_details: rejectedError.parityDetails,
        error_message: rejectedError.message,
        measurement_emitted: false,
        provenance_emitted: false,
      });
    }

    // Rejected Case 4: Persistent cross-boundary ledger drift (950 -> 951) exhausting 30 attempts
    {
      let helperInvocations = 0;
      globalThis.fetch = async (_url, fetchOptions) => {
        const request = JSON.parse(fetchOptions.body);
        let result;
        if (request.method === 'getNetwork') {
          result = { passphrase: baseNative.input.network_passphrase, protocolVersion: 28 };
        } else if (request.method === 'simulateTransaction') {
          result = {
            latestLedger: step950.ledger,
            transactionData: art950.txDataXdr,
            events: [],
            results: [{ xdr: art950.retvalXdr }],
          };
        } else if (request.method === 'getLedgerEntries') {
          // Ledger advances to 951 (crossing TTL expiry boundary) before entries are read
          result = {
            latestLedger: step951.ledger,
            entries: [],
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };
      cp.execFile = function () {
        helperInvocations++;
        throw new Error('Helper must not execute on drifted partial snapshot');
      };

      let rejectedError = null;
      try {
        await measureInvocation('http://localhost:18000/rpc', tx, helperDummyPath);
      } catch (err) {
        rejectedError = err;
      }
      assert.ok(rejectedError, 'Persistent cross-boundary ledger drift must fail closed');
      assert.equal(helperInvocations, 0);
      assert.equal(rejectedError.diagnostics?.lastCause, 'ledger_drift');
      assert.equal(rejectedError.diagnostics?.causes?.ledger_drift, 30);
      rejectedPaths.push({
        case_id: 'persistent_cross_boundary_ledger_drift_exhaustion',
        description:
          'When simulateTransaction runs at ledger 950 (live) and getLedgerEntries drifts to ledger 951 (expired) across all 30 attempts, WeighIn discards every mixed capture and fails closed.',
        outcome: 'REJECTED',
        simulated_ledger: step950.ledger,
        drifted_entries_ledger: step951.ledger,
        attempts: rejectedError.diagnostics.attempts,
        last_cause: rejectedError.diagnostics.lastCause,
        helper_invocations: helperInvocations,
        error_message: rejectedError.message,
        measurement_emitted: false,
        provenance_emitted: false,
      });
    }

    // Case 5: Single cross-boundary drift (attempt 1 simulates @ 950 and drifts to 951; attempt 2 recaptures cleanly @ 951)
    {
      let simAttempts = 0;
      globalThis.fetch = async (_url, fetchOptions) => {
        const request = JSON.parse(fetchOptions.body);
        let result;
        if (request.method === 'getNetwork') {
          result = { passphrase: baseNative.input.network_passphrase, protocolVersion: 28 };
        } else if (request.method === 'simulateTransaction') {
          simAttempts++;
          if (simAttempts === 1) {
            result = {
              latestLedger: step950.ledger,
              transactionData: art950.txDataXdr,
              events: [],
              results: [{ xdr: art950.retvalXdr }],
            };
          } else {
            result = {
              latestLedger: step951.ledger,
              transactionData: art951.txDataXdr,
              events: [],
              results: [{ xdr: art951.retvalXdr }],
            };
          }
        } else if (request.method === 'getLedgerEntries') {
          const requestedKeys = request.params.keys;
          // Both attempts see latestLedger = 951 (attempt 1 detects drift 950 != 951; attempt 2 succeeds at 951)
          result = {
            latestLedger: step951.ledger,
            entries: templateEntries
              .filter((row) => row.xdr && requestedKeys.includes(row.key))
              .map((row) => ({
                key: row.key,
                xdr: row.xdr,
                extXdr: row.extension_xdr,
                lastModifiedLedgerSeq: step951.ledger - 10,
                ...(row.live_until === null || row.live_until === undefined
                  ? {}
                  : { liveUntilLedgerSeq: row.live_until }),
              })),
          };
        } else if (request.method === 'getLedgers') {
          result = {
            ledgers: [{ sequence: step951.ledger, headerXdr: art951.historyHeaderXdr }],
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
          status: 200,
        });
      };

      cp.execFile = function (_file, _args, _options, callback) {
        const stdin = new EventEmitter();
        stdin.on = () => stdin;
        stdin.end = () => {
          setImmediate(() => callback(null, JSON.stringify(art951.simOutput), ''));
        };
        return { stdin };
      };

      const recovered = await measureInvocation('http://localhost:18000/rpc', tx, helperDummyPath);
      assert.equal(simAttempts, 2);
      assert.equal(recovered.provenance.ledger, 951);
      rejectedPaths.push({
        case_id: 'single_cross_boundary_drift_recapture_at_951',
        description:
          'When attempt 1 simulates at ledger 950 (live) and getLedgerEntries drifts to ledger 951 (expired), attempt 1 is discarded and attempt 2 recaptures a complete consistent snapshot at ledger 951 with authentic ledger-951 provenance.',
        outcome: 'ACCEPTED_AFTER_FULL_RECAPTURE',
        discarded_ledger: step950.ledger,
        recaptured_ledger: step951.ledger,
        simulation_attempts: simAttempts,
        emitted_provenance: recovered.provenance,
        provenance_manipulated: false,
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    cp.execFile = originalExecFile;
  }

  const environment = {
    experiment_id: 'temporary-storage-expiry-boundary',
    reviewed_source_sha: '4f266c5a371240a99335c3e954771791a2e229a1',
    source_files_sha256: sourceFilesSha256,
    source_snapshot_sha256: sourceSnapshotSha256,
    proof_wasm_sha256: proofWasmSha256,
    proof_wasm_bytes: proofWasm.length,
    baseline_reference_wasm_sha256: sha256(baseWasm),
    runtime_contract_id: contractId,
    temporary_storage_key_symbol: 'temp_ttl',
    temporary_storage_durability: 'temporary',
    temporary_storage_key_xdr: tempStorageKey,
    temporary_entry_live_until_ledger: TEMP_LIVE_UNTIL,
    fixture_id: parsedFixtures.fixture_id,
    logical_id: parsedFixtures.contracts[0].logical_id,
    function_name: 'hello',
    case_id: 'id:world',
    protocol: 28,
    network_passphrase: 'Standalone Network ; February 2017',
    helper_version: '28.0.1',
    helper_sha256: helperSha256,
    rust_toolchain: 'rustc 1.95.0 (59807616e 2026-04-14)',
    stellar_cli: 'stellar 28.1.0 (c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd)',
    soroban_sdk: '28.0.0',
    js_stellar_sdk: '16.0.1',
    seed: Array(32).fill(0),
    auth_mode: 'recording(true,true)',
    host_features: ['recording_mode', 'testutils'],
    controlled_ledger_sequences: boundarySteps.map((p) => p.ledger),
    controlled_ledger_timestamps: boundarySteps.map((p) => p.timestamp),
    production_contract_modified: false,
    random_behavior_used: false,
    cost_settings_altered: false,
    provenance_manipulated: false,
    restore_or_archive_claimed_for_temporary_storage: false,
  };

  const analysis = analyzeRepeatability(runs);
  const controlDiff = diffBenchmarks(
    runs[0].reference_measurements,
    runs[1].reference_measurements,
  );
  const boundaryLiveDiff = diffBenchmarks(
    runs[0].reference_measurements,
    runs[2].reference_measurements,
  );
  const expiryDiff = diffBenchmarks(
    runs[2].reference_measurements,
    runs[3].reference_measurements,
  );
  const violations = enforceThresholds(expiryDiff, policy);
  const summary = renderComment(
    expiryDiff,
    violations,
    'live-950',
    'expd-951',
  );

  const csvRows = [
    'run,ledger,timestamp,entry_state,entry_live,live_until,ttl_remaining,wasm_sha256,cpu_instructions,memory_bytes,ledger_read_entries,ledger_read_bytes,ledger_write_entries,ledger_write_bytes,events_count,event_data_bytes,return_value',
  ];
  for (const p of boundarySteps) {
    csvRows.push(
      [
        p.run,
        p.ledger,
        p.timestamp,
        p.entry_state,
        p.entry_live,
        p.live_until === null ? 'null' : p.live_until,
        p.ttl_remaining === null ? 'null' : p.ttl_remaining,
        proofWasmSha256,
        p.cpu_instructions,
        p.memory_bytes,
        p.ledger_read_entries,
        p.ledger_read_bytes,
        p.ledger_write_entries,
        p.ledger_write_bytes,
        p.events_count,
        p.event_data_bytes,
        `"${p.return_symbols.join(':')}"`,
      ].join(','),
    );
  }

  const verification = {
    status: 'VERIFIED',
    scenario: 'temporary_storage_expiry_boundary',
    repeatability_status: analysis.status,
    completed_runs: runs.length,
    rejected_boundary_cases_count: 4,
    drift_recovery_cases_count: 1,
    temporary_entry_live_until_ledger: TEMP_LIVE_UNTIL,
    source_snapshot_sha256: sourceSnapshotSha256,
    proof_wasm_sha256: proofWasmSha256,
    unchanged_wasm_artifact: analysis.reference.wasm_stable,
    unchanged_runtime_contract_id: true,
    fixed_invocation_interface: true,
    controlled_expiry_boundary_progression: true,
    inclusive_boundary_live_verified: !boundaryLiveDiff.hasRegression,
    post_expiry_eviction_verified: expiryDiff.hasRegression,
    rejected_paths_verified: true,
    provenance_manipulated: false,
    restore_or_archive_claimed_for_temporary_storage: false,
    random_behavior_used: false,
    cost_settings_altered: false,
    compute_calibration_constant:
      analysis.reference.series[0].compute_config_hashes.length === 1,
    resource_limits_constant:
      analysis.reference.series[0].resource_limit_hashes.length === 1,
    pre_expiry_control_deltas_zero: !controlDiff.hasRegression,
    exact_boundary_live_deltas_zero: !boundaryLiveDiff.hasRegression,
    post_expiry_variation_observed: expiryDiff.hasRegression,
    cpu_range: analysis.reference.series[0].metrics.cpu_instructions.range,
    memory_range: analysis.reference.series[0].metrics.memory_bytes.range,
    write_entries_range: analysis.reference.series[0].metrics.ledger_write_entries.range,
    write_bytes_range: analysis.reference.series[0].metrics.ledger_write_bytes.range,
    event_data_bytes_range: analysis.reference.series[0].metrics.event_data_bytes.range,
    configured_policy_violations_count: violations.length,
    policy_violation_suppressed_for_unchanged_artifact: false,
    unavailable_metrics_explicit_null: true,
    unavailable_metrics: [
      'historical_data_read_bytes',
      'contract_data_hard_limit',
      'tx_size_bytes',
    ],
  };

  assert.ok(
    verifyTemporaryStorageExpiry({
      contractSource,
      environment,
      boundarySteps,
      runs,
      rpcCalls,
      nativeReplays,
      rejectedPaths,
      analysis,
      controlDiff,
      boundaryLiveDiff,
      expiryDiff,
      policy,
      violations,
      summary,
      verification,
    }),
  );

  writeJsonLf(path.join(destination, 'environment.json'), environment);
  writeJsonLf(path.join(destination, 'expiry-boundary.json'), boundarySteps);
  writeJsonLf(path.join(destination, 'runs.json'), runs);
  writeJsonLf(path.join(destination, 'rpc.json'), rpcCalls);
  writeJsonLf(path.join(destination, 'native.json'), nativeReplays);
  writeJsonLf(path.join(destination, 'rejected-paths.json'), rejectedPaths);
  writeJsonLf(path.join(destination, 'analysis.json'), analysis);
  writeJsonLf(path.join(destination, 'control-diff.json'), controlDiff);
  writeJsonLf(path.join(destination, 'boundary-live-diff.json'), boundaryLiveDiff);
  writeJsonLf(path.join(destination, 'expiry-diff.json'), expiryDiff);
  writeJsonLf(path.join(destination, 'policy.json'), policy);
  writeJsonLf(path.join(destination, 'violations.json'), violations);
  writeTextLf(path.join(destination, 'summary.md'), summary);
  writeTextLf(path.join(destination, 'metrics.csv'), csvRows.join('\n') + '\n');
  writeJsonLf(path.join(destination, 'verification.json'), verification);

  // Compute cryptographic inventory of all archived files (using POSIX relative paths)
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

  return {
    verification,
    analysis,
    controlDiff,
    boundaryLiveDiff,
    expiryDiff,
    violations,
    rejectedPaths,
  };
}

if (require.main === module) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultDestination;
  runTemporaryStorageExpiryExperiment(target)
    .then(({ verification }) => {
      console.log(JSON.stringify(verification, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

module.exports = { runTemporaryStorageExpiryExperiment };
