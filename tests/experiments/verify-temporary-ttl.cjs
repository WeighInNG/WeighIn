const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const { spawnSync } = cp;
const { createHash } = require("node:crypto");
const {
  Keypair,
  Address,
  Operation,
  TransactionBuilder,
  xdr,
  rpc: SdkRpc,
} = require("@stellar/stellar-sdk");

const repository = path.resolve(__dirname, "../..");
const destination = path.resolve(
  process.argv[2] || path.join(repository, "docs/experiments/temporary-ttl"),
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-ttl-"));
const endpoint =
  process.env.WEIGHIN_EXPERIMENT_RPC_URL || "http://localhost:18000/rpc";
const passphrase = "Standalone Network ; February 2017";
const helper = path.join(
  repository,
  "native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const fixtureRoot = path.join(repository, "tests/fixtures/temporary-ttl");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const write = (name, value) => {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(
    path.join(destination, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
};

async function command(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(file, args, {
      cwd: options.cwd || repository,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function main() {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of [
    "contract/Cargo.toml",
    "contract/Cargo.lock",
    "contract/src/lib.rs",
    "rust-toolchain.toml",
  ]) {
    for (const base of [temporary, destination]) {
      const target = path.join(base, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(fixtureRoot, file), target);
    }
  }

  const build = await command("stellar", [
    "contract",
    "build",
    "--manifest-path",
    path.join(temporary, "contract/Cargo.toml"),
    "--package",
    "contract_test",
    "--locked",
    "--optimize=true",
    "--out-dir",
    path.join(temporary, "wasm"),
  ]);
  write("build-process.json", build);
  assert.equal(build.status, 0, build.stderr);
  const wasmPath = path.join(temporary, "wasm/contract_test.wasm");
  const wasm = fs.readFileSync(wasmPath);
  fs.copyFileSync(wasmPath, path.join(destination, "contract.wasm"));
  const wasmSha256 = sha256(wasm);

  const deployer = Keypair.random();
  const friendbot = await fetch(
    `${endpoint.replace(/\/rpc$/, "")}/friendbot?addr=${deployer.publicKey()}`,
  );
  assert.equal(friendbot.status, 200, "Friendbot funding must succeed");

  const { calculateContractId } = require("../../dist/measurement");
  const {
    measureInvocation,
    validateLedgerHeaderHash,
  } = require("../../dist/simulation");
  const server = new SdkRpc.Server(endpoint, { allowHttp: true });
  const wasmHash = sha256(wasm);
  const salt = createHash("sha256")
    .update("weighin-temporary-ttl-proof")
    .digest();
  const contractId = calculateContractId(deployer.publicKey(), salt);
  const scAddress = xdr.ScAddress.scAddressTypeContract(
    Address.fromString(contractId).toBuffer(),
  );
  const deploySteps = [];
  const submitAndConfirm = async (built, label) => {
    const prepared = await server.prepareTransaction(built);
    prepared.sign(deployer);
    const sent = await server.sendTransaction(prepared);
    assert.ok(
      ["PENDING", "DUPLICATE"].includes(sent.status),
      `${label}: ${JSON.stringify(sent)}`,
    );
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await server.getTransaction(sent.hash);
      if (status.status !== "NOT_FOUND") {
        assert.equal(
          status.status,
          "SUCCESS",
          `${label}: ${JSON.stringify(status)}`,
        );
        return { hash: sent.hash, status: status.status };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${label} confirmation timed out`);
  };
  const transactionFor = async (operation) => {
    const account = await server.getAccount(deployer.publicKey());
    return new TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: passphrase,
    })
      .addOperation(operation)
      .setTimeout(60)
      .build();
  };
  const invoke = (functionName, args = []) =>
    Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: scAddress,
          functionName,
          args,
        }),
      ),
      auth: [],
    });

  const upload = await transactionFor(Operation.uploadContractWasm({ wasm }));
  deploySteps.push({
    step: "upload",
    result: await submitAndConfirm(upload, "WASM upload"),
  });
  const create = await transactionFor(
    Operation.createCustomContract({
      wasmHash: Buffer.from(wasmHash, "hex"),
      address: Address.fromString(deployer.publicKey()),
      salt,
    }),
  );
  deploySteps.push({
    step: "create",
    result: await submitAndConfirm(create, "contract creation"),
  });
  write("deploy-process.json", {
    wasm_hash: wasmHash,
    contract_id: contractId,
    steps: deploySteps,
  });

  const captures = [];
  const replays = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (args[1]?.method === "POST") {
      captures.push({
        request: JSON.parse(args[1].body),
        raw: await response.clone().json(),
      });
      write("rpc-captures.json", captures);
    }
    return response;
  };
  const originalExecFile = cp.execFile;
  cp.execFile = function (file, args, options, callback) {
    if (file !== helper) return originalExecFile.apply(this, arguments);
    let input;
    const child = originalExecFile(
      file,
      args,
      options,
      (error, stdout, stderr) => {
        replays.push({
          case_id: "live",
          input,
          output: error ? null : JSON.parse(stdout),
          error: error ? stderr : null,
          status: error ? (error.code ?? 1) : 0,
        });
        write("native-replays.json", replays);
        callback(error, stdout, stderr);
      },
    );
    const end = child.stdin.end.bind(child.stdin);
    child.stdin.end = function (data, ...rest) {
      input = JSON.parse(data);
      return end(data, ...rest);
    };
    return child;
  };

  let liveResult;
  let writeHash;
  try {
    const writeTx = await transactionFor(
      invoke("write", [xdr.ScVal.scvU32(42)]),
    );
    writeHash = (await submitAndConfirm(writeTx, "temporary entry write")).hash;
    const readTx = await transactionFor(invoke("read"));
    liveResult = await measureInvocation(endpoint, readTx, helper, {
      caseId: "live",
    });
  } finally {
    globalThis.fetch = originalFetch;
    cp.execFile = originalExecFile;
  }

  const liveReplay = replays.find((row) => row.output);
  assert.ok(liveReplay, "Live native replay is required");
  const isTemporaryEntry = (row) => {
    if (!row.live_until) return false;
    const key = xdr.LedgerKey.fromXDR(row.key, "base64");
    return (
      key.switch().name === "contractData" &&
      key.contractData().key().switch().name === "scvSymbol" &&
      key.contractData().key().sym().toString() === "temp"
    );
  };
  const temporaryEntry = liveReplay.input.entries.find(isTemporaryEntry);
  assert.ok(
    temporaryEntry,
    "Live temporary entry is required in the captured footprint",
  );
  const liveUntil = temporaryEntry.live_until;
  const liveHeaderSeq = xdr.LedgerHeader.fromXDR(
    liveReplay.input.header_xdr,
    "base64",
  ).ledgerSeq();
  assert.ok(
    liveUntil > liveHeaderSeq,
    "Live entry must have future liveUntilLedgerSeq",
  );

  const rpcRaw = async (method, params) => {
    const response = await originalFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await response.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  };
  const observe = async (label) => {
    const latest = await rpcRaw("getLatestLedger", {});
    const entries = await rpcRaw("getLedgerEntries", {
      keys: [temporaryEntry.key],
    });
    const ledgers = await rpcRaw("getLedgers", {
      startLedger: latest.sequence,
      pagination: { limit: 1 },
    });
    return {
      label,
      latest_ledger: latest.sequence,
      entries,
      ledgers,
    };
  };
  const liveObservation = await observe("live");
  assert.equal(
    liveObservation.entries.entries[0]?.liveUntilLedgerSeq,
    liveUntil,
  );
  write("ledger-observations.json", { live: liveObservation });

  const waitStarted = Date.now();
  while (true) {
    const current = (await rpcRaw("getLatestLedger", {})).sequence;
    if (current > liveUntil) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const waitSeconds = (Date.now() - waitStarted) / 1000;
  const expiredObservation = await observe("expired");
  assert.equal(
    expiredObservation.entries.entries.length,
    0,
    "Natural expiry must remove the live entry",
  );
  assert.ok(expiredObservation.latest_ledger > liveUntil);
  write("ledger-observations.json", {
    live: liveObservation,
    expired: expiredObservation,
  });

  const headerRow = expiredObservation.ledgers.ledgers.find(
    (row) => row.sequence === expiredObservation.latest_ledger,
  );
  assert.ok(headerRow, "Current ledger header must be present");
  const historyEntry = xdr.LedgerHeaderHistoryEntry.fromXDR(
    headerRow.headerXdr,
    "base64",
  );
  const header = historyEntry.header();
  assert.equal(header.ledgerSeq(), expiredObservation.latest_ledger);
  validateLedgerHeaderHash(historyEntry, headerRow.hash);

  const expiredInput = structuredClone(liveReplay.input);
  expiredInput.header_xdr = header.toXDR("base64");
  assert.deepEqual(
    expiredInput.entries,
    liveReplay.input.entries,
    "No entry or TTL field may change",
  );
  const expiredHeaderSeq = xdr.LedgerHeader.fromXDR(
    expiredInput.header_xdr,
    "base64",
  ).ledgerSeq();
  assert.ok(expiredHeaderSeq > liveUntil);
  const expiredRun = spawnSync(helper, [], {
    input: JSON.stringify(expiredInput),
    encoding: "utf8",
  });
  assert.equal(expiredRun.status, 1, expiredRun.stderr);
  assert.match(expiredRun.stderr, /archived ledger state is unsupported/);
  replays.push({
    case_id: "expired-composed",
    input: expiredInput,
    output: null,
    error: expiredRun.stderr,
    status: expiredRun.status,
  });
  write("native-replays.json", replays);

  const invalidInput = structuredClone(liveReplay.input);
  invalidInput.header_xdr = "not-xdr";
  const invalidRun = spawnSync(helper, [], {
    input: JSON.stringify(invalidInput),
    encoding: "utf8",
  });
  assert.notEqual(invalidRun.status, 0, "Malformed header must be rejected");
  replays.push({
    case_id: "invalid-header",
    input: invalidInput,
    output: null,
    error: invalidRun.stderr,
    status: invalidRun.status,
  });
  write("native-replays.json", replays);

  const cases = {
    live: {
      accepted: true,
      cpu_instructions_consumed: liveResult.output.cpu_instructions_consumed,
      memory_bytes_consumed: liveResult.output.memory_bytes_consumed,
      retval_xdr: liveResult.output.retval_xdr,
      ledger: liveResult.provenance.ledger,
      input_sha256: liveResult.provenance.input_sha256,
    },
    natural_expiry: {
      live_until: liveUntil,
      observed_absent_at_ledger: expiredObservation.latest_ledger,
      entry_count: expiredObservation.entries.entries.length,
    },
    expired_composed: {
      rejected: true,
      exit_status: expiredRun.status,
      message: expiredRun.stderr.trim(),
      header_ledger: expiredHeaderSeq,
      entry_live_until: liveUntil,
    },
    invalid_header: {
      rejected: true,
      exit_status: invalidRun.status,
      message: invalidRun.stderr.trim(),
    },
  };
  write("cases.json", cases);

  const configKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
    }),
  ).toXDR("base64");
  const configEntries = await rpcRaw("getLedgerEntries", { keys: [configKey] });
  const archival = xdr.LedgerEntryData.fromXDR(
    configEntries.entries[0].xdr,
    "base64",
  )
    .configSetting()
    .stateArchivalSettings();

  write("composition.json", {
    status: "UNMODIFIED_RPC_FIELDS",
    live_input_sha256: sha256(JSON.stringify(liveReplay.input)),
    expired_input_sha256: sha256(JSON.stringify(expiredInput)),
    changed_fields: ["header_xdr"],
    unchanged_fields: [
      "schema_version",
      "network_passphrase",
      "host_function_xdr",
      "source_account_xdr",
      "entries",
      "instruction_leeway",
      "seed",
    ],
    live_header_ledger: liveHeaderSeq,
    expired_header_ledger: expiredHeaderSeq,
    temporary_live_until: liveUntil,
    live_entry_origin: "raw getLedgerEntries response at live observation",
    expired_header_origin: "raw getLedgers response after natural expiry",
    ttl_field_mutated: false,
  });
  write("environment.json", {
    experiment_id: "temporary-entry-ttl-liveness-and-archived-control",
    rpc_url: endpoint,
    network_passphrase: passphrase,
    protocol: 28,
    min_temporary_ttl: archival.minTemporaryTtl(),
    stellar_cli: (await command("stellar", ["--version"])).stdout
      .trim()
      .split("\n")[0],
    rust_toolchain: (await command("rustc", ["--version"])).stdout.trim(),
    helper_path:
      "native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
    helper_sha256: sha256(fs.readFileSync(helper)),
    wasm_sha256: wasmSha256,
    wasm_bytes: wasm.length,
    runtime_contract_id: contractId,
    deployer_public_key: deployer.publicKey(),
    temporary_write_transaction: writeHash,
    ledger_wait_seconds: Math.round(waitSeconds),
    native_seed: Array(32).fill(0),
    auth_mode: "recording(true,true)",
    source_revision: (
      await command("git", ["rev-parse", "HEAD"])
    ).stdout.trim(),
  });

  fs.writeFileSync(
    path.join(destination, "summary.md"),
    [
      "# Temporary-entry TTL proof",
      "",
      "A bounded contract wrote one temporary entry on a pinned protocol-28 standalone network. " +
        "The live snapshot was captured through the public `measureInvocation` path with raw RPC and native IO observers attached.",
      "",
      `- WASM SHA256: \`${wasmSha256}\``,
      `- Runtime contract id: \`${contractId}\``,
      `- Temporary write transaction: \`${writeHash}\``,
      `- Live header ledger: \`${liveHeaderSeq}\``,
      `- Genuine \`liveUntilLedgerSeq\`: \`${liveUntil}\``,
      `- Natural expiry observed absent at ledger: \`${expiredObservation.latest_ledger}\``,
      `- Archived control header ledger: \`${expiredHeaderSeq}\``,
      "",
      "The live case was accepted by native replay. After the ledger advanced past the genuine " +
        "`liveUntilLedgerSeq`, RPC returned no live entry; that observation is retained as the " +
        "unavailable natural-rejection outcome. The defensive archived-entry rejection was exercised " +
        "by pairing the unchanged live entry fields with a later genuine ledger header. No TTL or " +
        "entry field was edited; only `header_xdr` was advanced from a raw `getLedgers` response, " +
        "and the composed input is archived in full.",
      "",
      "The native helper exited `1` with `archived ledger state is unsupported` for the composed " +
        "expired input. A malformed-header control also exited nonzero, confirming the failure path " +
        "is explicit rather than an invented measurement.",
      "",
    ].join("\n"),
  );

  write("verification.json", {
    status: "VERIFIED",
    scenario: "temporary_entry_ttl_liveness_and_archived_control",
    harness_exit: 0,
    real_build_deployment_rpc_and_native: true,
    raw_io_observed_not_substituted: true,
    live_case: cases.live,
    natural_expiry: cases.natural_expiry,
    archived_control: {
      ...cases.expired_composed,
      input_sha256: sha256(JSON.stringify(expiredInput)),
    },
    invalid_input_control: {
      ...cases.invalid_header,
      input_sha256: sha256(JSON.stringify(invalidInput)),
    },
    ttl_field_mutated: false,
    header_advanced_from_genuine_rpc: true,
    wasm_sha256: wasmSha256,
    networks: 1,
  });

  const manifest = {
    schema_version: 1,
    generated_by: "tests/experiments/verify-temporary-ttl.cjs",
    files: {},
  };
  const collect = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory())
        collect(path.join(directory, entry.name), relative);
      else if (relative !== "sha256.json") {
        manifest.files[relative] = sha256(
          fs.readFileSync(path.join(directory, entry.name)),
        );
      }
    }
  };
  collect(destination);
  write("sha256.json", manifest);
  console.log(
    JSON.stringify(
      {
        status: "VERIFIED",
        contract_id: contractId,
        live_until: liveUntil,
        expired_header: expiredHeaderSeq,
        live_accepted: cases.live.accepted,
        archived_rejected: cases.expired_composed.rejected,
        invalid_rejected: cases.invalid_header.rejected,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
