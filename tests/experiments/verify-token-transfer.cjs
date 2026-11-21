// Run against a fresh, disposable protocol-28 standalone network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  Asset,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} = require("@stellar/stellar-sdk");
const {
  bindAsset,
  compare,
  policy,
  transferFixture,
  transferOperation,
  verifyTransferReplay,
} = require("./token-transfer-cases.cjs");
const { verifyBundledAction } = require("./token-transfer-action.cjs");
const { runMeasurement } = require("../../dist/measurement");
const { ensureAccountReady } = require("../../dist/account");

const [destination, helper, baseWasm, regressionWasm] = process.argv
  .slice(2)
  .map((file) => path.resolve(file));
const endpoint =
  process.env.WEIGHIN_EXPERIMENT_RPC_URL || "http://localhost:18000/rpc";
const passphrase = "Standalone Network ; February 2017";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const amount = "25000000";
const startingBalances = [1000000000n, 100000000n];
const seed = (label) =>
  Keypair.fromRawEd25519Seed(
    createHash("sha256")
      .update(`WeighIn #234 disposable standalone fixture: ${label}`)
      .digest(),
  );

async function main() {
  assert.ok(
    destination && helper && baseWasm && regressionWasm,
    "Usage: node verify-token-transfer.cjs OUTPUT HELPER BASE_WASM REGRESSION_WASM",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname),
  );
  fs.mkdirSync(destination);
  process.env.WEIGHIN_HELPER_PATH = helper;
  process.env.WEIGHIN_MIGRATION_EVIDENCE = destination;
  require("../support/record-network-io.cjs");
  const write = (file, value) =>
    fs.writeFileSync(
      path.join(destination, file),
      JSON.stringify(value, null, 2) + "\n",
    );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-token-"));
  const server = new rpc.Server(endpoint, { allowHttp: true });
  const issuer = seed("issuer");
  const sender = seed("sender");
  const recipient = seed("recipient");
  const asset = new Asset("WEIGHIN", issuer.publicKey());
  const token = new Contract(asset.contractId(passphrase));
  const setup = [];

  const transaction = (account, ...operations) => {
    const builder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: passphrase,
    });
    for (const operation of operations) builder.addOperation(operation);
    return builder.setTimeout(120).build();
  };

  async function commit(label, signer, tx) {
    tx.sign(signer);
    const submitted = await server.sendTransaction(tx);
    assert.equal(submitted.status, "PENDING", label);
    const receipt = await server.pollTransaction(submitted.hash, {
      attempts: 30,
      sleepStrategy: () => 1000,
    });
    assert.equal(receipt.status, "SUCCESS", label);
    assert.ok(receipt.ledger > 0, label);
    setup.push({
      label,
      hash: submitted.hash,
      ledger: receipt.ledger,
      status: receipt.status,
      return_xdr: receipt.returnValue?.toXDR("base64") ?? null,
    });
    write("receipts.json", setup);
    return receipt;
  }

  async function balances() {
    const account = await server.getAccount(issuer.publicKey());
    return Promise.all(
      [sender, recipient].map(async (holder) => {
        const result = await server.simulateTransaction(
          transaction(
            account,
            token.call(
              "balance",
              nativeToScVal(holder.publicKey(), { type: "address" }),
            ),
          ),
        );
        assert.ok(rpc.Api.isSimulationSuccess(result), "balance simulation");
        return scValToNative(result.result.retval);
      }),
    );
  }

  async function measure(
    label,
    wasm,
    boundAsset,
    quantity = amount,
    source = sender.publicKey(),
  ) {
    const wasmName = `${label}.wasm`;
    fs.copyFileSync(wasm, path.join(temporary, wasmName));
    const fixture = transferFixture(
      wasmName,
      boundAsset,
      sender.publicKey(),
      recipient.publicKey(),
      quantity,
    );
    write(`${label}-fixture.json`, fixture);
    const fixturePath = path.join(temporary, "fixture.json");
    writeFile(fixturePath, fixture);
    return runMeasurement({
      fixturesPath: fixturePath,
      keyFile: path.join(temporary, "deployer.key"),
      rpcUrl: endpoint,
      helperPath: helper,
      invocationSourceAccount: source,
      gitCommit: label,
      sdkVersion: "28.0.0",
    });
  }

  function writeFile(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  }

  async function reject(label, call, expected) {
    await assert.rejects(call, (error) => {
      write(`${label}.json`, { message: error.message, rejected: true });
      assert.match(error.message, expected);
      return true;
    });
  }

  try {
    const network = await server.getNetwork();
    assert.equal(network.passphrase, passphrase);
    assert.equal(network.protocolVersion, 28);
    const environment = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      endpoint,
      network,
      helper_sha256: sha256(fs.readFileSync(helper)),
      stellar_sdk: require("../../package-lock.json").packages[
        "node_modules/@stellar/stellar-sdk"
      ].version,
      checkout_sha: cp
        .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
        .trim(),
      github_run:
        process.env.GITHUB_ACTIONS === "true"
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
      image: process.env.WEIGHIN_EXPERIMENT_IMAGE ?? null,
      identities: {
        issuer: issuer.publicKey(),
        sender: sender.publicKey(),
        recipient: recipient.publicKey(),
      },
    };
    for (const [name, artifact] of [
      ["baseline", baseWasm],
      ["regression", regressionWasm],
    ]) {
      fs.copyFileSync(artifact, path.join(destination, `${name}.wasm`));
      environment[`${name}_wasm_sha256`] = sha256(fs.readFileSync(artifact));
    }
    assert.notEqual(
      environment.baseline_wasm_sha256,
      environment.regression_wasm_sha256,
    );
    write("environment.json", environment);
    for (const account of [issuer, sender, recipient]) {
      await ensureAccountReady(endpoint, account.publicKey());
    }
    for (const signer of [sender, recipient]) {
      await commit(
        "trustline",
        signer,
        transaction(
          await server.getAccount(signer.publicKey()),
          Operation.changeTrust({ asset }),
        ),
      );
    }
    await commit(
      "fund-token-balances",
      issuer,
      transaction(
        await server.getAccount(issuer.publicKey()),
        Operation.payment({
          destination: sender.publicKey(),
          asset,
          amount: "100",
        }),
        Operation.payment({
          destination: recipient.publicKey(),
          asset,
          amount: "10",
        }),
      ),
    );
    const receipt = await commit(
      "deploy-asset",
      issuer,
      await server.prepareTransaction(
        transaction(
          await server.getAccount(issuer.publicKey()),
          Operation.createStellarAssetContract({ asset }),
        ),
      ),
    );
    const bound = bindAsset(receipt, token.contractId());
    const before = await balances();
    assert.deepEqual(before, startingBalances);
    fs.writeFileSync(path.join(temporary, "deployer.key"), issuer.secret(), {
      mode: 0o600,
    });
    const baseline = await measure("baseline", baseWasm, bound);
    const control = await measure("control", baseWasm, bound);
    const regression = await measure("regression", regressionWasm, bound);
    write("records.json", { baseline, control, regression });
    const replays = JSON.parse(
      fs.readFileSync(path.join(destination, "native.json"), "utf8"),
    );
    for (const [record] of [baseline, control, regression]) {
      verifyTransferReplay(
        replays,
        record,
        bound,
        sender.publicKey(),
        recipient.publicKey(),
      );
    }
    assert.equal(baseline[0].contract_id, control[0].contract_id);
    assert.notEqual(baseline[0].contract_id, regression[0].contract_id);
    assert.deepEqual(
      control[0].benchmarks[0].metrics,
      baseline[0].benchmarks[0].metrics,
    );
    const controlPolicy = compare(baseline, control);
    const regressionPolicy = compare(baseline, regression);
    fs.writeFileSync(path.join(destination, "policy.toml"), policy);
    write("policy-results.json", {
      control: controlPolicy,
      regression: regressionPolicy,
    });
    assert.equal(controlPolicy.exit, 0);
    assert.equal(regressionPolicy.exit, 1);
    assert.deepEqual(
      regressionPolicy.violations.map((item) => item.metric),
      ["cpu_instructions"],
    );
    assert.ok(
      regression[0].benchmarks[0].metrics.cpu_instructions.consumed >
        baseline[0].benchmarks[0].metrics.cpu_instructions.consumed,
    );
    await reject(
      "overdraw",
      () => measure("overdraw", baseWasm, bound, "1000000001"),
      /(?:Contract|Error).*Balance|Error\(Contract, #10\)/i,
    );
    await reject(
      "missing-account",
      () =>
        measure(
          "missing-account",
          baseWasm,
          bound,
          amount,
          seed("never-funded").publicKey(),
        ),
      /Invocation source account is not available on the network/,
    );

    const signer = path.join(temporary, "funded-sender.key");
    fs.writeFileSync(signer, sender.secret(), { mode: 0o600 });
    verifyBundledAction({
      temporary,
      destination,
      endpoint,
      helper,
      signer,
      policy,
      baseline: baseWasm,
      regression: regressionWasm,
      fixture: transferFixture(
        "transfer.wasm",
        bound,
        sender.publicKey(),
        recipient.publicKey(),
        amount,
      ),
    });
    assert.deepEqual(
      await balances(),
      startingBalances,
      "simulation must discard transfer writes",
    );

    const signedProbe = transaction(
      await server.getAccount(sender.publicKey()),
      new Contract(baseline[0].contract_id).call(
        "transfer",
        bound,
        nativeToScVal(sender.publicKey(), { type: "address" }),
        nativeToScVal(recipient.publicKey(), { type: "address" }),
        nativeToScVal(BigInt(amount), { type: "i128" }),
      ),
    );
    const simulated = await server.simulateTransaction(signedProbe);
    assert.ok(rpc.Api.isSimulationSuccess(simulated));
    assert.equal(simulated.result.auth.length, 1);
    const auth = simulated.result.auth[0];
    assert.equal(
      auth.credentials().switch(),
      xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(),
    );
    transferOperation(
      auth,
      bound,
      sender.publicKey(),
      recipient.publicKey(),
      amount,
    );
    await commit(
      "signed-transfer",
      sender,
      rpc.assembleTransaction(signedProbe, simulated).build(),
    );
    const after = await balances();
    assert.deepEqual(after, [
      before[0] - BigInt(amount),
      before[1] + BigInt(amount),
    ]);
    write("verification.json", {
      status: "PASS",
      exit: 0,
      bound_address_xdr: bound.toXDR("base64"),
      amount,
      balances_before: before.map(String),
      balances_after: after.map(String),
      authorization_xdr: auth.toXDR("base64"),
    });
  } catch (error) {
    write("verification.json", {
      status: "FAILED",
      exit: 1,
      message: error.message,
    });
    throw error;
  } finally {
    write(
      "sha256.json",
      Object.fromEntries(
        fs
          .readdirSync(destination)
          .sort()
          .filter((file) => file !== "sha256.json")
          .map((file) => [
            file,
            sha256(fs.readFileSync(path.join(destination, file))),
          ]),
      ),
    );
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
