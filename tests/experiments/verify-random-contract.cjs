// Bounded PRNG-dependent contract proof: real build, real deployment, real RPC
// simulation and real native replay through the public measureInvocation path.
// The harness records raw IO without substituting values, then asserts that the
// fixed zero-seed native replay is rejected against the genuine RPC seed while
// a deterministic control in the same contract still reaches parity.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  Keypair,
  TransactionBuilder,
  Operation,
  xdr,
} = require("@stellar/stellar-sdk");

const repository = path.resolve(__dirname, "../..");
const destination = path.resolve(
  process.argv[2] || path.join(repository, "docs/experiments/random-contract"),
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-random-"));
const endpoint =
  process.env.WEIGHIN_EXPERIMENT_RPC_URL || "http://localhost:18000/rpc";
const passphrase = "Standalone Network ; February 2017";
const helper = path.join(
  repository,
  "native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const fixtureRoot = path.join(repository, "tests/fixtures/random-contract");
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
  fs.mkdirSync(path.join(temporary, "src"), { recursive: true });
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
  const keyFile = path.join(temporary, "deployer.key");
  fs.writeFileSync(keyFile, deployer.secret(), { mode: 0o600 });
  const friendbot = await fetch(
    `${endpoint.replace(/\/rpc$/, "")}/friendbot?addr=${deployer.publicKey()}`,
  );
  assert.equal(friendbot.status, 200, "Friendbot funding must succeed");

  const {
    Account,
    Address,
    Operation: SdkOperation,
    TransactionBuilder: SdkTransactionBuilder,
    rpc: SdkRpc,
  } = require("@stellar/stellar-sdk");
  const { calculateContractId } = require("../../dist/measurement");
  const { measureInvocation } = require("../../dist/simulation");
  const submitAndConfirm = async (server, prepared, phase) => {
    const sent = await server.sendTransaction(prepared);
    assert.ok(
      ["PENDING", "DUPLICATE"].includes(sent.status),
      `${phase}: ${JSON.stringify(sent)}`,
    );
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await server.getTransaction(sent.hash);
      if (status.status !== "NOT_FOUND") {
        assert.equal(
          status.status,
          "SUCCESS",
          `${phase}: ${JSON.stringify(status)}`,
        );
        return { hash: sent.hash, status: status.status };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${phase} confirmation timed out`);
  };
  const server = new SdkRpc.Server(endpoint, { allowHttp: true });
  const wasmHash = sha256(wasm);
  const salt = createHash("sha256")
    .update("weighin-random-contract-proof")
    .digest();
  const contractId = calculateContractId(deployer.publicKey(), salt);
  const deploySteps = [];
  let account = await server.getAccount(deployer.publicKey());
  const uploadTx = new SdkTransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: passphrase,
  })
    .addOperation(SdkOperation.uploadContractWasm({ wasm }))
    .setTimeout(30)
    .build();
  const preparedUpload = await server.prepareTransaction(uploadTx);
  preparedUpload.sign(deployer);
  deploySteps.push({
    step: "upload",
    result: await submitAndConfirm(
      server,
      preparedUpload,
      "WASM upload",
      endpoint,
    ),
  });
  account = await server.getAccount(deployer.publicKey());
  const createTx = new SdkTransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: passphrase,
  })
    .addOperation(
      SdkOperation.createCustomContract({
        wasmHash: Buffer.from(wasmHash, "hex"),
        address: Address.fromString(deployer.publicKey()),
        salt,
      }),
    )
    .setTimeout(30)
    .build();
  const preparedCreate = await server.prepareTransaction(createTx);
  preparedCreate.sign(deployer);
  deploySteps.push({
    step: "create",
    result: await submitAndConfirm(
      server,
      preparedCreate,
      "contract creation",
      endpoint,
    ),
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
          input,
          output: error ? null : JSON.parse(stdout),
          error: error ? stderr : null,
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

  const address = Address.fromString(contractId);
  const scAddress = xdr.ScAddress.scAddressTypeContract(address.toBuffer());

  const transactionFor = async (functionName, args) => {
    const account = await server.getAccount(deployer.publicKey());
    const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: scAddress,
        functionName,
        args,
      }),
    );
    return new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({ func: hostFunction, auth: [] }),
      )
      .setTimeout(60)
      .build();
  };

  const cases = {};
  const errors = {};
  try {
    const drawsTx = await transactionFor("draws", [xdr.ScVal.scvU32(4)]);
    try {
      const measured = await measureInvocation(endpoint, drawsTx, helper, {
        caseId: "draws",
      });
      errors.draws = { rejected: false, measured };
    } catch (error) {
      errors.draws = {
        rejected: true,
        message: error.message,
        parityDetails: error.parityDetails || null,
      };
    }

    const constantTx = await transactionFor("constant", []);
    try {
      const measured = await measureInvocation(endpoint, constantTx, helper, {
        caseId: "constant",
      });
      cases.constant = {
        accepted: true,
        retval_xdr: measured.output.retval_xdr,
        cpu_instructions_consumed: measured.output.cpu_instructions_consumed,
        memory_bytes_consumed: measured.output.memory_bytes_consumed,
        seed: measured.provenance.seed,
        ledger: measured.provenance.ledger,
        input_sha256: measured.provenance.input_sha256,
      };
    } catch (error) {
      cases.constant = { accepted: false, message: error.message };
    }
  } finally {
    globalThis.fetch = originalFetch;
    cp.execFile = originalExecFile;
  }

  write("cases.json", cases);
  write("errors.json", errors);
  write("environment.json", {
    experiment_id: "bounded-prng-contract-parity",
    rpc_url: endpoint,
    network_passphrase: passphrase,
    protocol: 28,
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
    native_seed: Array(32).fill(0),
    auth_mode: "recording(true,true)",
    source_revision: (
      await command("git", ["rev-parse", "HEAD"])
    ).stdout.trim(),
  });

  const drawsRejection = errors.draws;
  assert.equal(
    drawsRejection.rejected,
    true,
    "PRNG case must be rejected by parity",
  );
  assert.deepEqual(drawsRejection.parityDetails, {
    transactionData: false,
    returnValue: true,
    contractEvents: false,
  });
  assert.match(
    drawsRejection.message,
    /auth\/random\/state-dependent invocation is unsupported/,
  );
  assert.equal(
    cases.constant.accepted,
    true,
    "Deterministic control must reach parity",
  );
  assert.deepEqual(cases.constant.seed, Array(32).fill(0));

  const drawsCapture = captures.find(
    (call) =>
      call.request.method === "simulateTransaction" &&
      call.raw.result?.results?.[0]?.xdr &&
      xdr.TransactionEnvelope.fromXDR(call.request.params.transaction, "base64")
        .v1()
        .tx()
        .operations()[0]
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract()
        .functionName()
        .toString() === "draws",
  );
  assert.ok(
    drawsCapture,
    "Raw RPC simulateTransaction capture for draws is required",
  );
  const rpcRetval = drawsCapture.raw.result.results[0].xdr;
  const rpcValues = xdr.ScVal.fromXDR(rpcRetval, "base64")
    .vec()
    .map((value) => value.u64().toString());
  assert.equal(rpcValues.length, 4);
  assert.ok(
    rpcValues.some((value) => value !== "0"),
    "Genuine RPC PRNG values must be nonzero",
  );

  const drawsReplay = replays.find(
    (row) =>
      row.output &&
      row.input.host_function_xdr ===
        xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: scAddress,
            functionName: "draws",
            args: [xdr.ScVal.scvU32(4)],
          }),
        ).toXDR("base64"),
  );
  assert.ok(drawsReplay, "Native replay for draws is required");
  assert.deepEqual(
    drawsReplay.input.seed,
    Array(32).fill(0),
    "Native seed must stay fixed zero",
  );
  const nativeValues = xdr.ScVal.fromXDR(
    drawsReplay.output.retval_xdr,
    "base64",
  )
    .vec()
    .map((value) => value.u64().toString());
  assert.equal(nativeValues.length, 4);
  assert.ok(
    nativeValues.some((value) => value !== "0"),
    "Genuine zero-seed PRNG values must be nonzero",
  );
  assert.notDeepEqual(
    nativeValues,
    rpcValues,
    "The two genuine seeds must produce distinct values",
  );
  assert.equal(
    drawsReplay.output.transaction_data_xdr,
    drawsCapture.raw.result.transactionData,
  );
  assert.deepEqual(drawsReplay.output.contract_events_xdr, []);

  fs.writeFileSync(
    path.join(destination, "summary.md"),
    [
      "# Bounded PRNG contract parity proof",
      "",
      `The fixture contract \`draws(env, u32)\` draws at most ${4} u64 values from ` +
        "`env.prng()`. It was genuinely built, uploaded and deployed on a pinned " +
        "protocol-28 standalone network, then invoked through the public " +
        "`measureInvocation` path with raw IO observers attached.",
      "",
      "- WASM SHA256: `" + wasmSha256 + "`",
      "- Runtime contract id: `" + contractId + "`",
      "- Native seed: 32 zero bytes (product default, unchanged)",
      "- RPC seed: the network consensus seed; its observed values are genuine",
      "- RPC PRNG values: " +
        rpcValues.map((value) => "`" + value + "`").join(", "),
      "- Native zero-seed values: " +
        nativeValues.map((value) => "`" + value + "`").join(", "),
      "- Parity result: rejected, return-value only (" +
        JSON.stringify(drawsRejection.parityDetails) +
        ")",
      "- Deterministic `constant()` control: accepted with the same fixed zero seed",
      "",
      "Both sides produced nonzero, distinct PRNG values. The product seed was " +
        "not changed to make the proof pass; the rejection is the expected result " +
        "for a random-dependent invocation.",
      "",
    ].join("\n"),
  );

  write("verification.json", {
    status: "VERIFIED",
    scenario: "bounded_prng_contract_parity",
    harness_exit: 0,
    real_build_deployment_rpc_and_native: true,
    raw_io_observed_not_substituted: true,
    parity_rejection: drawsRejection,
    justified_matching_control: cases.constant,
    rpc_prng_values: rpcValues,
    native_zero_seed_prng_values: nativeValues,
    distinct_genuine_seeds: true,
    product_seed_forced: false,
    parity_failure_became_success: false,
    wasm_sha256: wasmSha256,
    networks: 1,
    bounded_draws: 4,
  });
  const manifest = {
    schema_version: 1,
    generated_by: "tests/experiments/verify-random-contract.cjs",
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
        rpc_values: rpcValues,
        zero_seed_values: nativeValues,
        parity_details: drawsRejection.parityDetails,
        control_accepted: cases.constant.accepted,
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
