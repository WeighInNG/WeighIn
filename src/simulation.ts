import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { z } from "zod";

export const sha256 = (value: string | Buffer): string =>
  crypto.createHash("sha256").update(value).digest("hex");
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const encoded = z.string().min(1);
const outputSchema = z
  .object({
    schema_version: z.literal(1),
    source: z.literal("soroban-simulation"),
    source_version: z.literal("28.0.1"),
    protocol: z.literal(28),
    host_features: z.tuple([
      z.literal("recording_mode"),
      z.literal("testutils"),
    ]),
    auth_mode: z.literal("recording(true,true)"),
    cpu_instructions_consumed: integer,
    memory_bytes_consumed: integer,
    cpu_limit: integer.positive(),
    memory_limit: integer.positive(),
    instruction_budget: integer,
    disk_read_bytes: integer,
    write_bytes: integer,
    read_only_keys: z.array(encoded),
    read_write_keys: z.array(encoded),
    retval_xdr: encoded,
    transaction_data_xdr: encoded,
    contract_events_xdr: z.array(encoded),
    modified_entries: integer,
  })
  .strict();
export type SimulationOutput = z.infer<typeof outputSchema>;
export interface SnapshotEntry {
  key: string;
  xdr: string | null;
  extension_xdr?: string;
  last_modified?: number;
  live_until?: number | null;
}
export interface SimulationInput {
  schema_version: 1;
  header_xdr: string;
  network_passphrase: string;
  host_function_xdr: string;
  source_account_xdr: string;
  entries: SnapshotEntry[];
  instruction_leeway: number;
  seed: number[];
}
export interface ComputeProvenance {
  source: "soroban-simulation";
  source_version: "28.0.1";
  protocol: 28;
  helper_sha256: string;
  network_id: string;
  ledger: number;
  header_sha256: string;
  snapshot_sha256: string;
  config_sha256: string;
  compute_config_sha256: string;
  input_sha256: string;
  seed: number[];
  auth_mode: string;
  host_features: string[];
  /** Schema 4: audited resource caps only, excluding fee settings and metadata. */
  resource_limits_sha256?: string;
}

export interface ResourceLimits {
  cpu_instructions: number;
  memory_bytes: number;
  footprint_entries: number;
  disk_read_bytes: number;
  write_entries: number;
  write_bytes: number;
  events_and_return_bytes: number;
}

function execute(
  file: string,
  args: string[],
  input?: string,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        cwd,
        timeout: input === undefined ? 600_000 : 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(`Simulation helper failed: ${stderr || error.message}`),
          );
        else resolve(stdout);
      },
    );
    // Ignore EPIPE here: the exit callback reports a helper that rejects input.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

let provisioned: Promise<string> | undefined;
/** Linux x64 is the initial supported runtime. Cargo is never installed implicitly. */
export async function resolveSimulationHelper(
  explicitPath?: string,
): Promise<string> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Native simulation currently supports Linux x64 only");
  }
  const override = explicitPath ?? process.env.WEIGHIN_HELPER_PATH;
  if (override) {
    const file = path.resolve(override);
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      throw new Error(`Simulation helper missing or not executable: ${file}`);
    }
    return file;
  }
  if (!provisioned)
    provisioned = (async () => {
      const directory = path.resolve(__dirname, "../native/simulation");
      const manifest = path.join(directory, "Cargo.toml");
      if (!fs.existsSync(manifest))
        throw new Error(`Native simulation sources missing: ${manifest}`);
      console.log(
        "Building protocol-28 simulation helper (Rust 1.95.0, locked dependencies)...",
      );
      // Explicit target dir keeps Cargo environment overrides from moving the executable.
      await execute(
        "cargo",
        [
          "+1.95.0",
          "build",
          "--release",
          "--locked",
          "--manifest-path",
          manifest,
          "--target",
          "x86_64-unknown-linux-gnu",
          "--target-dir",
          path.join(directory, "target"),
        ],
        undefined,
        directory,
      );
      return path.join(
        directory,
        "target/x86_64-unknown-linux-gnu/release/weighin-simulation",
      );
    })();
  return provisioned;
}

/** Execute the versioned helper transport; never accept missing/invalid meters. */
export async function simulateSnapshot(
  input: SimulationInput,
  helperPath: string,
): Promise<SimulationOutput> {
  const stdout = await execute(helperPath, [], JSON.stringify(input));
  let output: SimulationOutput;
  try {
    output = outputSchema.parse(JSON.parse(stdout));
  } catch (error) {
    throw new Error(
      `Invalid simulation helper output: ${error instanceof Error ? error.message : error}`,
    );
  }
  const data = xdr.SorobanTransactionData.fromXDR(
    output.transaction_data_xdr,
    "base64",
  );
  const resources = data.resources();
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);
  if (
    resources.instructions() !== output.instruction_budget ||
    resources.diskReadBytes() !== output.disk_read_bytes ||
    resources.writeBytes() !== output.write_bytes ||
    !same(
      resources
        .footprint()
        .readOnly()
        .map((k) => k.toXDR("base64")),
      output.read_only_keys,
    ) ||
    !same(
      resources
        .footprint()
        .readWrite()
        .map((k) => k.toXDR("base64")),
      output.read_write_keys,
    )
  ) {
    throw new Error(
      "Invalid simulation helper output: resource fields disagree with transaction-data XDR",
    );
  }
  xdr.ScVal.fromXDR(output.retval_xdr, "base64");
  for (const event of output.contract_events_xdr) {
    if (
      xdr.ContractEvent.fromXDR(event, "base64").type().name === "diagnostic"
    ) {
      throw new Error(
        "Invalid simulation helper output: diagnostic event is not a charged contract event",
      );
    }
  }
  return output;
}

const configNames = [
  "configSettingContractComputeV0",
  "configSettingContractLedgerCostV0",
  "configSettingContractLedgerCostExtV0",
  "configSettingContractHistoricalDataV0",
  "configSettingContractEventsV0",
  "configSettingContractBandwidthV0",
  "configSettingStateArchival",
  "configSettingContractCostParamsCpuInstructions",
  "configSettingContractCostParamsMemoryBytes",
  "configSettingLiveSorobanStateSizeWindow",
] as const;
const computeConfigNames = new Set([
  "configSettingContractComputeV0",
  "configSettingContractCostParamsCpuInstructions",
  "configSettingContractCostParamsMemoryBytes",
  "configSettingStateArchival",
]);
const configKeys = configNames.map((name) =>
  xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId[name](),
    }),
  ).toXDR("base64"),
);
const entriesSchema = z.object({
  latestLedger: integer.positive(),
  entries: z.array(
    z.object({
      key: encoded,
      xdr: encoded,
      extXdr: encoded,
      lastModifiedLedgerSeq: integer,
      liveUntilLedgerSeq: integer.optional(),
    }),
  ),
});
const simulationSchema = z.object({
  latestLedger: integer.positive(),
  transactionData: encoded,
  events: z.array(encoded),
  results: z.array(z.object({ xdr: encoded })).length(1),
});

function snapshotLimits(entries: SnapshotEntry[]): ResourceLimits {
  const settings = new Map(
    entries
      .filter((row) => configKeys.includes(row.key))
      .map((row) => {
        if (!row.xdr)
          throw new Error("Missing captured resource configuration");
        const setting = xdr.LedgerEntryData.fromXDR(
          row.xdr,
          "base64",
        ).configSetting();
        return [setting.switch().name, setting] as const;
      }),
  );
  const compute = settings
    .get("configSettingContractComputeV0")!
    .contractCompute();
  const io = settings
    .get("configSettingContractLedgerCostV0")!
    .contractLedgerCost();
  const footprint = settings
    .get("configSettingContractLedgerCostExtV0")!
    .contractLedgerCostExt();
  const events = settings
    .get("configSettingContractEventsV0")!
    .contractEvents();
  return z
    .object({
      cpu_instructions: integer.positive(),
      memory_bytes: integer.positive(),
      footprint_entries: integer,
      disk_read_bytes: integer,
      write_entries: integer,
      write_bytes: integer,
      events_and_return_bytes: integer,
    })
    .strict()
    .parse({
      cpu_instructions: Number(compute.txMaxInstructions().toString()),
      memory_bytes: compute.txMemoryLimit(),
      footprint_entries: footprint.txMaxFootprintEntries(),
      disk_read_bytes: io.txMaxDiskReadBytes(),
      write_entries: io.txMaxWriteLedgerEntries(),
      write_bytes: io.txMaxWriteBytes(),
      events_and_return_bytes: events.txMaxContractEventsSizeBytes(),
    });
}

class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly rpcError: unknown,
  ) {
    super(`RPC ${method} failed: ${JSON.stringify(rpcError)}`);
  }
}

// Only the error actually observed during live snapshot reads is retryable.
// HTTP failures, other RPC errors and simulation/helper failures remain fatal.
function isTransientLedgerRead(failure: unknown): boolean {
  if (!(failure instanceof RpcError) || failure.method !== "getLedgerEntries")
    return false;
  const error = failure.rpcError as {
    code?: unknown;
    message?: unknown;
  } | null;
  return (
    error?.code === -32603 &&
    error?.message ===
      "could not query captive core: http request failed with non-200 status code (404)"
  );
}

async function callRpc(
  url: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`RPC ${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (body.error || body.result === undefined)
    throw new RpcError(method, body.error);
  return body.result;
}

/** Capture all discovered keys/config at one ledger; retry the entire capture on drift.
 * RPC and helper must agree on transaction data and return value at that ledger.
 * The fixed seed makes random-dependent RPC parity an explicit unsupported case.
 */
export async function measureInvocation(
  rpcUrl: string,
  transaction: Transaction,
  helperPath: string,
): Promise<{
  output: SimulationOutput;
  provenance: ComputeProvenance;
  limits: ResourceLimits;
}> {
  const network = z
    .object({ passphrase: encoded, protocolVersion: integer })
    .parse(await callRpc(rpcUrl, "getNetwork", {}));
  if (network.protocolVersion !== 28)
    throw new Error(
      `Unsupported protocol ${network.protocolVersion}: simulation helper supports 28`,
    );
  const keys = new Set(configKeys);
  let transientReadFailures = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const raw = await callRpc(rpcUrl, "simulateTransaction", {
      transaction: transaction.toXDR(),
    });
    const error = (raw as { error?: string }).error;
    if (error) throw new Error(`RPC simulation failed: ${error}`);
    const simulation = simulationSchema.parse(raw);
    const resources = xdr.SorobanTransactionData.fromXDR(
      simulation.transactionData,
      "base64",
    ).resources();
    for (const key of [
      ...resources.footprint().readOnly(),
      ...resources.footprint().readWrite(),
    ])
      keys.add(key.toXDR("base64"));
    const requested = [...keys].sort();
    const rows = new Map<
      string,
      z.infer<typeof entriesSchema>["entries"][number]
    >();
    let drift = false;
    for (let offset = 0; offset < requested.length; offset += 200) {
      const batch = requested.slice(offset, offset + 200);
      let rawEntries: unknown;
      try {
        rawEntries = await callRpc(rpcUrl, "getLedgerEntries", { keys: batch });
      } catch (failure) {
        if (!isTransientLedgerRead(failure)) throw failure;
        transientReadFailures++;
        if (transientReadFailures > 3 || attempt === 29) {
          throw new Error(
            `Snapshot ledger-read retry limit exhausted: ${failure instanceof Error ? failure.message : failure}`,
          );
        }
        const delay = 250 * 2 ** (transientReadFailures - 1);
        console.warn(
          `Transient captive-core ledger-read failure; discarding snapshot and retrying capture (${transientReadFailures}/3, ${delay}ms): ${failure instanceof Error ? failure.message : failure}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        drift = true;
        break;
      }
      const result = entriesSchema.parse(rawEntries);
      if (result.latestLedger !== simulation.latestLedger) {
        drift = true;
        break;
      }
      for (const row of result.entries) {
        if (!batch.includes(row.key) || rows.has(row.key))
          throw new Error(
            "Invalid/duplicate ledger entry in snapshot response",
          );
        rows.set(row.key, row);
      }
    }
    if (drift) continue;
    const headers = z
      .object({
        ledgers: z.array(z.object({ sequence: integer, headerXdr: encoded })),
      })
      .parse(
        await callRpc(rpcUrl, "getLedgers", {
          startLedger: simulation.latestLedger,
          pagination: { limit: 1 },
        }),
      );
    const row = headers.ledgers.find(
      (item) => item.sequence === simulation.latestLedger,
    );
    if (!row) throw new Error("Snapshot ledger header unavailable");
    const header = xdr.LedgerHeaderHistoryEntry.fromXDR(
      row.headerXdr,
      "base64",
    ).header();
    if (
      header.ledgerSeq() !== simulation.latestLedger ||
      header.ledgerVersion() !== network.protocolVersion
    ) {
      throw new Error("Snapshot header ledger/protocol mismatch");
    }
    const entries: SnapshotEntry[] = requested.map((key) => {
      const entry = rows.get(key);
      return entry
        ? {
            key,
            xdr: entry.xdr,
            extension_xdr: entry.extXdr,
            last_modified: entry.lastModifiedLedgerSeq,
            live_until: entry.liveUntilLedgerSeq ?? null,
          }
        : { key, xdr: null };
    });
    const operation = transaction.toEnvelope().v1().tx().operations();
    if (
      operation.length !== 1 ||
      operation[0].body().switch().name !== "invokeHostFunction"
    )
      throw new Error("Expected exactly one host invocation");
    const input: SimulationInput = {
      schema_version: 1,
      header_xdr: header.toXDR("base64"),
      network_passphrase: network.passphrase,
      host_function_xdr: operation[0]
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .toXDR("base64"),
      source_account_xdr: Keypair.fromPublicKey(transaction.source)
        .xdrPublicKey()
        .toXDR("base64"),
      entries,
      instruction_leeway: 0,
      seed: Array(32).fill(0),
    };
    let output: SimulationOutput;
    try {
      output = await simulateSnapshot(input, helperPath);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      const missing = [
        ...message.matchAll(/UNCAPTURED_KEY:([A-Za-z0-9+/=]+)/g),
      ].map((match) => match[1]);
      const additional = missing.filter((key) => !keys.has(key));
      if (!additional.length) throw failure;
      for (const key of additional) {
        xdr.LedgerKey.fromXDR(key, "base64");
        keys.add(key);
      }
      continue; // Recapture all state, including newly discovered keys, at one ledger.
    }
    // RPC events are DiagnosticEvent wrappers. Only successful non-diagnostic
    // ContractEvents contribute to this charged resource; preserve their order.
    const rpcEvents = simulation.events
      .map((event) => xdr.DiagnosticEvent.fromXDR(event, "base64"))
      .filter(
        (event) =>
          event.inSuccessfulContractCall() &&
          event.event().type().name !== "diagnostic",
      )
      .map((event) => event.event().toXDR("base64"));
    if (
      output.transaction_data_xdr !== simulation.transactionData ||
      output.retval_xdr !== simulation.results[0].xdr ||
      JSON.stringify(output.contract_events_xdr) !== JSON.stringify(rpcEvents)
    ) {
      throw new Error(
        "Local simulation disagrees with RPC at captured ledger; auth/random/state-dependent invocation is unsupported",
      );
    }
    const limits = snapshotLimits(entries);
    if (
      output.cpu_limit !== limits.cpu_instructions ||
      output.memory_limit !== limits.memory_bytes
    ) {
      throw new Error(
        "Native compute limits disagree with captured configuration",
      );
    }
    return {
      output,
      limits,
      provenance: {
        source: output.source,
        source_version: output.source_version,
        protocol: output.protocol,
        helper_sha256: sha256(fs.readFileSync(helperPath)),
        network_id: sha256(network.passphrase),
        ledger: simulation.latestLedger,
        header_sha256: sha256(input.header_xdr),
        snapshot_sha256: sha256(JSON.stringify(entries)),
        config_sha256: sha256(
          JSON.stringify(
            entries.filter((entry) => configKeys.includes(entry.key)),
          ),
        ),
        resource_limits_sha256: sha256(JSON.stringify(limits)),
        // Cost model/limits/TTL values determine comparable compute. Fee-only live
        // state-size windows and last-modified metadata remain full provenance.
        compute_config_sha256: sha256(
          JSON.stringify(
            entries
              .filter((entry) => {
                const key = xdr.LedgerKey.fromXDR(entry.key, "base64");
                return (
                  key.switch().name === "configSetting" &&
                  computeConfigNames.has(
                    key.configSetting().configSettingId().name,
                  )
                );
              })
              .map((entry) => ({ key: entry.key, xdr: entry.xdr })),
          ),
        ),
        input_sha256: sha256(JSON.stringify(input)),
        seed: input.seed,
        auth_mode: output.auth_mode,
        host_features: output.host_features,
      },
    };
  }
  throw new Error(
    "Unable to capture a complete consistent snapshot after 30 attempts",
  );
}
