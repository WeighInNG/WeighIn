import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { validateLargeInt } from "./config";
import {
  xdr,
  nativeToScVal,
  hash,
  StrKey,
  Address,
  TransactionBuilder,
  Operation,
  Keypair,
  rpc,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "http://localhost:8000/rpc";

export interface MetricValue {
  consumed: number;
  limit: number;
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
  metrics: Metrics;
  wasm_sha256: string;
}

export interface ContractBenchmark {
  contract_id: string;
  git_commit: string;
  soroban_sdk_version: string;
  timestamp: number;
  benchmarks: BenchmarkResult[];
}

import {
  InvocationArg,
  InvocationSpec,
  ContractSpec,
  FixturesSpec,
  FixturesSpecSchema,
  formatZodError,
} from "./config";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive the friendbot base URL from the RPC URL.
 *  Strips a trailing /rpc segment and appends /friendbot.
 *  e.g. http://localhost:8000/rpc -> http://localhost:8000/friendbot
 */
function friendbotUrl(rpcUrl: string, publicKey: string): string {
  const base = rpcUrl.replace(/\/rpc\/?$/, "");
  return `${base}/friendbot?addr=${encodeURIComponent(publicKey)}`;
}

// Convert native type/value to ScVal
export function toScVal(arg: InvocationArg): xdr.ScVal {
  const type = arg.type.toLowerCase();
  const val = arg.value;
  switch (type) {
    case "symbol":
      return xdr.ScVal.scvSymbol(val);
    case "string":
      return xdr.ScVal.scvString(val);
    case "u32":
      return xdr.ScVal.scvU32(val);
    case "i32":
      return xdr.ScVal.scvI32(val);
    case "bool":
      return xdr.ScVal.scvBool(val);
    case "u64":
    case "i64":
    case "u128":
    case "i128": {
      const err = validateLargeInt(type, val);
      if (err) throw new Error(err);
      try {
        return nativeToScVal(BigInt(val), { type });
      } catch (e: any) {
        throw new Error(`Invalid value for ${type}: ${e.message}`);
      }
    }
    case "address": {
      if (typeof val !== "string") {
        throw new Error(`Invalid value for address: must be string`);
      }
      try {
        return Address.fromString(val).toScVal();
      } catch (e: any) {
        throw new Error(`Invalid value for address: ${e.message}`);
      }
    }
    case "bytes": {
      if (typeof val !== "string") {
        throw new Error(`Invalid value for bytes: must be hex string`);
      }
      if (!/^[0-9a-fA-F]*$/.test(val)) {
        throw new Error(`Invalid value for bytes: must be valid hex string`);
      }
      if (val.length % 2 !== 0) {
        throw new Error(
          `Invalid value for bytes: hex string must have even length`,
        );
      }
      return xdr.ScVal.scvBytes(Buffer.from(val, "hex"));
    }
    case "vec": {
      if (!Array.isArray(val)) {
        throw new Error(`Invalid value for vec: must be array`);
      }
      return xdr.ScVal.scvVec(
        val.map((item: any, i) => {
          if (!item || typeof item.type !== "string" || !("value" in item)) {
            throw new Error(`Invalid vector element at index ${i}`);
          }
          return toScVal(item as InvocationArg);
        }),
      );
    }
    case "map": {
      if (!Array.isArray(val)) {
        throw new Error(
          `Invalid value for map: must be array of {key, value} objects`,
        );
      }
      const mapEntries = val.map((entry: any, i) => {
        if (!entry || !entry.key || !entry.value) {
          throw new Error(`Invalid map entry at index ${i}`);
        }
        return new xdr.ScMapEntry({
          key: toScVal(entry.key as InvocationArg),
          val: toScVal(entry.value as InvocationArg),
        });
      });
      return xdr.ScVal.scvMap(mapEntries);
    }
    default:
      throw new Error(`Unsupported argument type: ${arg.type}`);
  }
}

// Deterministically calculate contract ID
function calculateContractId(
  deployerAddress: string,
  salt: Buffer,
  networkPassphrase: string,
): string {
  const addressSc = Address.fromString(deployerAddress).toScAddress();
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: addressSc,
      salt: salt,
    }),
  );

  const networkId = hash(Buffer.from(networkPassphrase));
  const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: networkId,
      contractIdPreimage: preimage,
    }),
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
  server: rpc.Server,
  keyFile: string,
  rpcUrl: string,
): Promise<Keypair> {
  if (fs.existsSync(keyFile)) {
    const secret = fs.readFileSync(keyFile, "utf8").trim();
    return Keypair.fromSecret(secret);
  }

  const keypair = Keypair.random();
  fs.writeFileSync(keyFile, keypair.secret(), { mode: 0o600 });

  console.log(
    `Funding deployer account: ${keypair.publicKey()} via friendbot...`,
  );
  const url = friendbotUrl(rpcUrl, keypair.publicKey());
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Friendbot funding failed (${res.status}): ${res.statusText}`,
    );
  }
  // Wait for ledger inclusion
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return keypair;
}

// Poll transaction completion
async function waitForTransaction(
  server: rpc.Server,
  txHash: string,
): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    const tx = await server.getTransaction(txHash);
    if (tx.status !== "NOT_FOUND") {
      return tx;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Transaction ${txHash} not found after 30 seconds`);
}

// Check if contract is already deployed
async function isContractDeployed(
  server: rpc.Server,
  contractId: string,
): Promise<boolean> {
  try {
    const contractScAddress = Address.fromString(contractId).toScAddress();
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contractScAddress,
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const res = await server.getLedgerEntries(ledgerKey);
    return !!(res.entries && res.entries.length > 0);
  } catch {
    return false;
  }
}

// Measure instance size from stateChanges or fallback to getLedgerEntries
async function getInstanceSize(
  server: rpc.Server,
  contractId: string,
  stateChanges?: rpc.Api.LedgerEntryChange[],
): Promise<number> {
  if (stateChanges) {
    for (const change of stateChanges) {
      if (change.after) {
        const val = change.after.data();
        if (val.switch() === xdr.LedgerEntryType.contractData()) {
          const contractData = val.contractData();
          const contractAddressStr = Address.fromScAddress(
            contractData.contract(),
          ).toString();
          if (
            contractAddressStr === contractId &&
            contractData.key().switch() ===
              xdr.ScValType.scvLedgerKeyContractInstance()
          ) {
            return change.after.toXDR().length;
          }
        }
      }
    }
  }

  try {
    const contractScAddress = Address.fromString(contractId).toScAddress();
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contractScAddress,
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const res = await server.getLedgerEntries(ledgerKey);
    if (res.entries && res.entries.length > 0) {
      return res.entries[0].val.toXDR().length;
    }
  } catch {}

  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunMeasurementOptions {
  fixturesPath: string;
  gitCommit: string;
  sdkVersion: string;
  rpcUrl?: string;
  keyFile?: string;
  skipBuild?: boolean;
}

export async function runMeasurement(
  fixturesPathOrOptions: string | RunMeasurementOptions,
  gitCommit?: string,
  sdkVersion?: string,
  rpcUrl?: string,
): Promise<ContractBenchmark[]> {
  // Support both the old positional signature and the new options object
  let opts: RunMeasurementOptions;
  if (typeof fixturesPathOrOptions === "string") {
    opts = {
      fixturesPath: fixturesPathOrOptions,
      gitCommit: gitCommit ?? "unknown",
      sdkVersion: sdkVersion ?? "unknown",
      rpcUrl,
    };
  } else {
    opts = fixturesPathOrOptions;
  }

  const effectiveRpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  const fixturesDir = path.dirname(path.resolve(opts.fixturesPath));
  const keyFile = opts.keyFile ?? path.join(fixturesDir, ".weighin-temp-key");

  const server = new rpc.Server(effectiveRpcUrl, { allowHttp: true });
  let networkPassphrase = "";
  try {
    const net = await server.getNetwork();
    networkPassphrase = net.passphrase;
  } catch (err: any) {
    throw new Error(
      `Failed to fetch network info from RPC ${effectiveRpcUrl}: ${err.message}`,
    );
  }
  const deployer = await getOrInitAccount(server, keyFile, effectiveRpcUrl);
  const deployerAddress = Address.fromString(deployer.publicKey());

  const rawFixtures = fs.readFileSync(opts.fixturesPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawFixtures);
  } catch (e: any) {
    throw new Error(
      `Failed to parse JSON in ${opts.fixturesPath}: ${e.message}`,
    );
  }
  const result = FixturesSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatZodError(result.error, opts.fixturesPath));
  }
  const fixturesSpec: FixturesSpec = result.data;

  const results: ContractBenchmark[] = [];

  for (const contractSpec of fixturesSpec.contracts) {
    // Resolve wasm_path relative to the fixtures file's directory
    const wasmPath = path.resolve(fixturesDir, contractSpec.wasm_path);
    if (!fs.existsSync(wasmPath)) {
      if (opts.skipBuild) {
        throw new Error(
          `skip-build is enabled, but the expected precompiled WASM could not be found.\nCheck the WASM path referenced by the fixture configuration.\nExpected at: ${wasmPath}`,
        );
      }
      throw new Error(
        `WASM not found: ${wasmPath}\nBuild the contract before running measurements.`,
      );
    }

    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmHash = crypto.createHash("sha256").update(wasmBytes).digest();
    const wasmSha256 = wasmHash.toString("hex");

    console.log(`WASM: ${wasmPath}`);
    console.log(`WASM SHA256: ${wasmSha256}`);

    // Deterministic salt based on WASM hash — same WASM always gets same contract ID
    const salt = crypto.createHash("sha256").update(wasmHash).digest();
    const contractId = calculateContractId(
      deployer.publicKey(),
      salt,
      networkPassphrase,
    );

    console.log(`Contract ID: ${contractId}`);
    const deployed = await isContractDeployed(server, contractId);

    if (!deployed) {
      console.log(`Installing WASM...`);
      let account = await server.getAccount(deployer.publicKey());

      // 1. Upload WASM
      const uploadTx = new TransactionBuilder(account, {
        fee: "1000000",
        networkPassphrase,
      })
        .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
        .setTimeout(30)
        .build();

      const preparedUpload = await server.prepareTransaction(uploadTx);
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
        fee: "1000000",
        networkPassphrase,
      })
        .addOperation(
          Operation.createCustomContract({
            wasmHash,
            address: deployerAddress,
            salt,
          }),
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
        fee: "1000000",
        networkPassphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: invokeSpec.function_name,
            args: argsSc,
          }),
        )
        .setTimeout(30)
        .build();

      const simRes = await server.simulateTransaction(invokeTx);
      if (rpc.Api.isSimulationError(simRes)) {
        throw new Error(
          `Simulation failed for ${invokeSpec.function_name}: ${simRes.error}`,
        );
      }

      const simSuccess = simRes as any;

      const transactionData = simSuccess.transactionData;
      const parsedData = transactionData.build();
      const resources = parsedData.resources();
      const footprint = resources.footprint();

      const readEntries = footprint.readOnly().length;
      const writeEntries = footprint.readWrite().length;
      const readBytes = resources.diskReadBytes();
      const writeBytes = resources.writeBytes();

      const cpuConsumed = Number(simSuccess.cost.cpuInsns);
      const memConsumed = Number(simSuccess.cost.memBytes);

      const eventsCount = simSuccess.events.length;
      const eventBytes = simSuccess.events.reduce((acc: number, e: any) => {
        const event = e.event();
        if (event.type().name !== "contract") return acc;
        return acc + event.toXDR().length;
      }, simSuccess.result?.retval.toXDR().length || 0);

      // Transaction size: prepare to get the fully-assembled envelope
      const preparedTx = await server.prepareTransaction(invokeTx);
      const txSizeBytes = Buffer.from(preparedTx.toEnvelope().toXDR()).length;

      // Contract instance size
      const stateChanges = simSuccess.stateChanges || [];
      const contractDataHardLimit = await getInstanceSize(
        server,
        contractId,
        stateChanges,
      );

      // Historical read bytes: no size limit in protocol 25 config (fee-only)
      const historicalReadBytes = 0;

      // Limits sourced from live network config (protocol 25, standalone).
      // configSettingContractComputeV0:    txMaxInstructions=100_000_000, txMemoryLimit=41_943_040
      // configSettingContractLedgerCostV0: txMaxReadLedgerEntries=100, txMaxReadBytes=200_000,
      //                                    txMaxWriteLedgerEntries=50, txMaxWriteBytes=132_096
      // configSettingContractBandwidthV0:  txMaxSizeBytes=132_096
      // configSettingContractEventsV0:     txMaxContractEventsSizeBytes=16_384
      // configSettingContractDataEntrySizeBytes: 65_536
      const metrics: Metrics = {
        cpu_instructions: { consumed: cpuConsumed, limit: 100_000_000 },
        memory_bytes: { consumed: memConsumed, limit: 41_943_040 },
        ledger_read_entries: { consumed: readEntries, limit: 100 },
        ledger_read_bytes: { consumed: readBytes, limit: 200_000 },
        ledger_write_entries: { consumed: writeEntries, limit: 50 },
        ledger_write_bytes: { consumed: writeBytes, limit: 132_096 },
        historical_data_read_bytes: { consumed: historicalReadBytes, limit: 0 },
        contract_data_hard_limit: {
          consumed: contractDataHardLimit,
          limit: 65_536,
        },
        tx_size_bytes: { consumed: txSizeBytes, limit: 132_096 },
        events_count: { consumed: eventsCount, limit: 100 },
        event_data_bytes: { consumed: eventBytes, limit: 16_384 },
      };

      benchmarks.push({
        function_name: invokeSpec.function_name,
        metrics,
        wasm_sha256: wasmSha256,
      });
    }

    results.push({
      contract_id: contractId,
      git_commit: opts.gitCommit,
      soroban_sdk_version: opts.sdkVersion,
      timestamp: Math.floor(Date.now() / 1000),
      benchmarks,
    });
  }

  return results;
}
