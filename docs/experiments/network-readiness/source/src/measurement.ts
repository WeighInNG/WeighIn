import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseFixtures } from './identity';
import { ensureAccountReady } from './account';
import { measureInvocation, resolveSimulationHelper, ComputeProvenance, SimulationOutput, ResourceLimits } from './simulation';
import {
  xdr,
  hash,
  StrKey,
  Address,
  TransactionBuilder,
  Operation,
  Keypair,
  rpc,
} from '@stellar/stellar-sdk';

const DEFAULT_RPC_URL = 'http://localhost:8000/rpc';
const NETWORK_PASSPHRASE = 'Standalone Network ; February 2017';

/** Schema 4 adds audited consumption and per-metric limit provenance. */
export interface MetricValue {
  availability?: 'measured' | 'unavailable';
  consumed: number | null;
  limit: number | null;
  reason?: string;
  source?: string;
  limit_source?: string;
  limit_reason?: string;
}

export interface Metrics {
  cpu_instructions: MetricValue;
  memory_bytes: MetricValue;
  ledger_read_entries: MetricValue;
  ledger_read_bytes: MetricValue;
  ledger_write_entries: MetricValue;
  ledger_write_bytes: MetricValue;
  historical_data_read_bytes: MetricValue;
  contract_data_hard_limit: MetricValue;
  tx_size_bytes: MetricValue;
  events_count: MetricValue;
  event_data_bytes: MetricValue;
}

export interface BenchmarkResult {
  function_name: string;
  /** Stable configured case identity; absent only in legacy results. */
  case_id?: string;
  metrics: Metrics;
  wasm_sha256: string;
  provenance?: ComputeProvenance;
}

export interface ContractBenchmark {
  /** Versions 2–4 separate logical comparison identity from deployment identity. */
  schema_version?: 2 | 3 | 4;
  fixture_id?: string;
  logical_id?: string;
  /** Runtime address, never the comparison key for logical results. */
  contract_id: string;
  git_commit: string;
  soroban_sdk_version: string;
  timestamp: number;
  benchmarks: BenchmarkResult[];
}

export interface InvocationArg {
  type: string;
  value: any;
}

export interface InvocationSpec {
  id?: string;
  function_name: string;
  args: InvocationArg[];
}

export interface ContractSpec {
  id?: string;
  wasm_path: string;
  invocations: InvocationSpec[];
}

export interface FixturesSpec {
  id?: string;
  contracts: ContractSpec[];
}

/** Protocol-28 mapping, audited against the pinned host and RPC-matched helper.
 * IO byte adjustment is exactly identity in this helper's default configuration.
 * Footprint sizes are distinct access keys, not counts of host read/write calls.
 */
export function metricsFromSimulation(output: SimulationOutput, limits: ResourceLimits): Metrics {
  const measured = (consumed: number, limit: number, source: string, limit_source: string): MetricValue =>
    ({ availability: 'measured', consumed, limit, source, limit_source });
  const unavailable = (reason: string): MetricValue => ({ availability: 'unavailable', consumed: null, limit: null, reason });
  const io = 'ConfigSettingContractLedgerCostV0';
  const eventBytes = output.contract_events_xdr.reduce((sum, event) => sum + xdr.ContractEvent.fromXDR(event, 'base64').toXDR().length, 0)
    + xdr.ScVal.fromXDR(output.retval_xdr, 'base64').toXDR().length;
  return {
    cpu_instructions: measured(output.cpu_instructions_consumed, limits.cpu_instructions,
      'soroban-simulation.simulated_instructions', 'ConfigSettingContractComputeV0.txMaxInstructions'),
    memory_bytes: measured(output.memory_bytes_consumed, limits.memory_bytes,
      'soroban-simulation.simulated_memory', 'ConfigSettingContractComputeV0.txMemoryLimit'),
    ledger_read_entries: measured(output.read_only_keys.length + output.read_write_keys.length, limits.footprint_entries,
      'SorobanResources.footprint.readOnly.length + readWrite.length', 'ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries'),
    ledger_read_bytes: measured(output.disk_read_bytes, limits.disk_read_bytes,
      'SorobanResources.diskReadBytes (identity adjustment)', `${io}.txMaxDiskReadBytes`),
    ledger_write_entries: measured(output.read_write_keys.length, limits.write_entries,
      'SorobanResources.footprint.readWrite.length', `${io}.txMaxWriteLedgerEntries`),
    ledger_write_bytes: measured(output.write_bytes, limits.write_bytes,
      'SorobanResources.writeBytes (identity adjustment)', `${io}.txMaxWriteBytes`),
    historical_data_read_bytes: unavailable('Protocol 28 exposes historical-data fees, not a historical read consumption resource'),
    contract_data_hard_limit: unavailable('No verified instance-only post-invocation size and corresponding limit mapping'),
    tx_size_bytes: unavailable('Simulation estimates a maximum envelope; no signed benchmark transaction is submitted'),
    events_count: { availability: 'measured', consumed: output.contract_events_xdr.length, limit: null,
      source: 'successful non-diagnostic ContractEvents.length', limit_reason: 'Protocol 28 has no independent event-count cap' },
    event_data_bytes: measured(eventBytes, limits.events_and_return_bytes,
      'sum(successful non-diagnostic ContractEvent XDR bytes) + return ScVal XDR bytes',
      'ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes'),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Convert native type/value to ScVal
function toScVal(arg: InvocationArg): xdr.ScVal {
  const type = arg.type.toLowerCase();
  const val = arg.value;
  switch (type) {
    case 'symbol':
      return xdr.ScVal.scvSymbol(val);
    case 'string':
      return xdr.ScVal.scvString(val);
    case 'u32':
      return xdr.ScVal.scvU32(val);
    case 'i32':
      return xdr.ScVal.scvI32(val);
    case 'bool':
      return xdr.ScVal.scvBool(val);
    default:
      throw new Error(`Unsupported argument type: ${arg.type}`);
  }
}

// Deterministically calculate contract ID
function calculateContractId(deployerAddress: string, salt: Buffer): string {
  const addressSc = Address.fromString(deployerAddress).toScAddress();
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: addressSc,
      salt: salt,
    })
  );

  const networkId = hash(Buffer.from(NETWORK_PASSPHRASE));
  const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: networkId,
      contractIdPreimage: preimage,
    })
  );

  const contractIdBytes = hash(hashIdPreimage.toXDR());
  return StrKey.encodeContract(contractIdBytes);
}

/**
 * Load or generate a deployer keypair.
 *
 * @param keyFile  Absolute path to the key file. Shared between base and head
 *                 runs so both measurements use the same on-chain account.
 * @param rpcUrl   Used to derive the friendbot URL for initial funding.
 */
async function getOrInitAccount(
  keyFile: string,
  rpcUrl: string
): Promise<Keypair> {
  let keypair: Keypair;
  if (fs.existsSync(keyFile)) {
    const secret = fs.readFileSync(keyFile, 'utf8').trim();
    keypair = Keypair.fromSecret(secret);
  } else {
    keypair = Keypair.random();
    fs.writeFileSync(keyFile, keypair.secret(), { mode: 0o600 });
  }

  await ensureAccountReady(rpcUrl, keypair.publicKey());

  return keypair;
}

// Poll transaction completion
async function waitForTransaction(
  server: rpc.Server,
  txHash: string
): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    const tx = await server.getTransaction(txHash);
    if (tx.status !== 'NOT_FOUND') {
      return tx;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Transaction ${txHash} not found after 30 seconds`);
}

// Check if contract is already deployed
async function isContractDeployed(
  server: rpc.Server,
  contractId: string
): Promise<boolean> {
  try {
    const contractScAddress = Address.fromString(contractId).toScAddress();
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contractScAddress,
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );
    const res = await server.getLedgerEntries(ledgerKey);
    return !!(res.entries && res.entries.length > 0);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunMeasurementOptions {
  /** Absolute path to the fixtures JSON file. wasm_path entries are resolved
   *  relative to this file's directory. */
  fixturesPath: string;
  /** Stable workspace-relative fixture path, identical in BASE and HEAD.
   * Defaults to fixturesPath relative to the current working directory.
   * A configured top-level fixture id takes precedence.
   */
  fixtureId?: string;
  gitCommit: string;
  sdkVersion: string;
  /** Soroban RPC endpoint. Defaults to localhost:8000/rpc. */
  rpcUrl?: string;
  /**
   * Absolute path to a file used to persist the deployer keypair between
   * base and head runs so both use the same funded on-chain account.
   * Defaults to <fixturesDir>/.weighin-temp-key
   */
  keyFile?: string;
  /** Executable override; otherwise build the bundled pinned helper on Linux x64. */
  helperPath?: string;
}

export async function runMeasurement(
  fixturesPathOrOptions: string | RunMeasurementOptions,
  gitCommit?: string,
  sdkVersion?: string,
  rpcUrl?: string
): Promise<ContractBenchmark[]> {
  // Support both the old positional signature and the new options object
  let opts: RunMeasurementOptions;
  if (typeof fixturesPathOrOptions === 'string') {
    opts = {
      fixturesPath: fixturesPathOrOptions,
      gitCommit: gitCommit ?? 'unknown',
      sdkVersion: sdkVersion ?? 'unknown',
      rpcUrl,
    };
  } else {
    opts = fixturesPathOrOptions;
  }

  const effectiveRpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  const fixturesDir = path.dirname(path.resolve(opts.fixturesPath));
  const keyFile = opts.keyFile ?? path.join(fixturesDir, '.weighin-temp-key');

  const rawFixtures = fs.readFileSync(opts.fixturesPath, 'utf8');
  const fixturesSpec = parseFixtures(
    rawFixtures,
    opts.fixtureId ?? path.relative(process.cwd(), path.resolve(opts.fixturesPath))
  );

  const server = new rpc.Server(effectiveRpcUrl, { allowHttp: true });
  const deployer = await getOrInitAccount(keyFile, effectiveRpcUrl);
  const deployerAddress = Address.fromString(deployer.publicKey());

  const results: ContractBenchmark[] = [];

  for (const contractSpec of fixturesSpec.contracts) {
    let wasmPath = path.resolve(fixturesDir, contractSpec.wasm_path);
    if (!fs.existsSync(wasmPath)) {
      let altPath = '';
      if (wasmPath.includes('wasm32-unknown-unknown')) {
        altPath = wasmPath.replace('wasm32-unknown-unknown', 'wasm32v1-none');
      } else if (wasmPath.includes('wasm32v1-none')) {
        altPath = wasmPath.replace('wasm32v1-none', 'wasm32-unknown-unknown');
      }
      if (altPath && fs.existsSync(altPath)) {
        wasmPath = altPath;
      } else {
        throw new Error(`WASM not found: ${wasmPath}\nBuild the contract before running measurements.`);
      }
    }

    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmHash = crypto.createHash('sha256').update(wasmBytes).digest();
    const wasmSha256 = wasmHash.toString('hex');

    console.log(`WASM: ${wasmPath}`);
    console.log(`WASM SHA256: ${wasmSha256}`);

    // Deterministic salt based on WASM hash — same WASM always gets same contract ID
    const salt = crypto.createHash('sha256').update(wasmHash).digest();
    const contractId = calculateContractId(deployer.publicKey(), salt);

    console.log(`Contract ID: ${contractId}`);
    const deployed = await isContractDeployed(server, contractId);

    if (!deployed) {
      console.log(`Installing WASM...`);
      let account = await server.getAccount(deployer.publicKey());

      // 1. Upload WASM
      const uploadTx = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
        .setTimeout(30)
        .build();

      let preparedUpload;
      try {
        preparedUpload = await server.prepareTransaction(uploadTx);
      } catch (err: any) {
        console.error("DEBUG: Full prepareTransaction error:", err);
        console.dir(err, { depth: null });
        throw err;
      }
      preparedUpload.sign(deployer);
      const uploadSend = await server.sendTransaction(preparedUpload);
      const uploadRes = await waitForTransaction(server, uploadSend.hash);
      if (uploadRes.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`WASM upload failed: ${JSON.stringify(uploadRes)}`);
      }

      console.log(`WASM installed. Deploying contract instance...`);
      account = await server.getAccount(deployer.publicKey());

      // 2. Create contract instance
      const createTx = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.createCustomContract({
            wasmHash,
            address: deployerAddress,
            salt,
          })
        )
        .setTimeout(30)
        .build();

      const preparedCreate = await server.prepareTransaction(createTx);
      preparedCreate.sign(deployer);
      const createSend = await server.sendTransaction(preparedCreate);
      const createRes = await waitForTransaction(server, createSend.hash);
      if (createRes.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`Contract deploy failed: ${JSON.stringify(createRes)}`);
      }
      console.log(`Deployed at ${contractId}`);
    } else {
      console.log(`Already deployed at ${contractId}`);
    }

    const benchmarks: BenchmarkResult[] = [];

    // 3. Simulate invocations
    for (const invokeSpec of contractSpec.invocations) {
      console.log(`Simulating ${invokeSpec.function_name}...`);
      const account = await server.getAccount(deployer.publicKey());
      const argsSc = invokeSpec.args.map(toScVal);

      const invokeTx = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: invokeSpec.function_name,
            args: argsSc,
          })
        )
        .setTimeout(30)
        .build();

      const simRes = await server.simulateTransaction(invokeTx);
      if (rpc.Api.isSimulationError(simRes)) {
        throw new Error(`Simulation failed for ${invokeSpec.function_name}: ${simRes.error}`);
      }

      if (!rpc.Api.isSimulationSuccess(simRes)) {
        throw new Error(`Simulation did not return transaction data for ${invokeSpec.function_name}`);
      }
      const helperPath = await resolveSimulationHelper(opts.helperPath);
      const { output, provenance, limits } = await measureInvocation(effectiveRpcUrl, invokeTx, helperPath);
      const metrics = metricsFromSimulation(output, limits);

      benchmarks.push({
        function_name: invokeSpec.function_name,
        case_id: invokeSpec.case_id,
        metrics,
        provenance,
        wasm_sha256: wasmSha256,
      });
    }

    results.push({
      schema_version: 4,
      fixture_id: fixturesSpec.fixture_id,
      logical_id: contractSpec.logical_id,
      contract_id: contractId,
      git_commit: opts.gitCommit,
      soroban_sdk_version: opts.sdkVersion,
      timestamp: Math.floor(Date.now() / 1000),
      benchmarks,
    });
  }

  return results;
}
