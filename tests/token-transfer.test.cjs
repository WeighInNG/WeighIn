const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  Address,
  Asset,
  Keypair,
  nativeToScVal,
  xdr,
} = require("@stellar/stellar-sdk");
const {
  bindAsset,
  compare,
  policy,
  transferFixture,
  transferOperation,
  verifyTransferReplay,
} = require("./experiments/token-transfer-cases.cjs");
const { FixturesSpecSchema } = require("../dist/config");
const { toScVal } = require("../dist/measurement");
const { loadConfigContent } = require("../dist/threshold");

const network = "Standalone Network ; February 2017";
const account = (byte) =>
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte)).publicKey();
const asset = new Asset("WEIGHIN", account(1)).contractId(network);
const address = Address.fromString(asset).toScVal();
const receipt = { status: "SUCCESS", ledger: 42, returnValue: address };

test("transfer policy applies strict CPU tolerance to the measured function", () => {
  assert.equal(
    loadConfigContent(policy, "policy.toml").thresholds.functions.transfer
      .cpu_instructions,
    "strict_zero_tolerance",
  );
});

test("committed standard asset address and exact i128 amount reach the transfer fixture", () => {
  const bound = bindAsset(receipt, asset);
  const fixture = transferFixture(
    "transfer.wasm",
    bound,
    account(2),
    account(3),
    "25000000",
  );
  const [contract] = FixturesSpecSchema.parse(fixture).contracts;
  const [invocation] = contract.invocations;
  assert.equal(invocation.function_name, "transfer");
  assert.deepEqual(
    invocation.args.map((arg) => toScVal(arg).toXDR("base64")),
    [
      address,
      Address.fromString(account(2)).toScVal(),
      Address.fromString(account(3)).toScVal(),
      nativeToScVal(25000000n, { type: "i128" }),
    ].map((value) => value.toXDR("base64")),
  );
});

test("asset binding fails closed for missing, uncommitted, malformed or unrelated receipts", () => {
  assert.throws(
    () => bindAsset({ ...receipt, status: "FAILED" }, asset),
    /must be committed/,
  );
  assert.throws(
    () => bindAsset({ ...receipt, ledger: 0 }, asset),
    /inclusion ledger/,
  );
  assert.throws(
    () => bindAsset({ ...receipt, returnValue: undefined }, asset),
    /returned no value/,
  );
  assert.throws(
    () => bindAsset({ ...receipt, returnValue: nativeToScVal(42) }, asset),
    /address/,
  );
  const otherAsset = new Asset("OTHER", account(1)).contractId(network);
  assert.throws(
    () => bindAsset(receipt, otherAsset),
    /must match the configured asset/,
  );
});

test("archived live transfer preserves receipts, native replay and policy outcomes", () => {
  const directory = path.join(__dirname, "../docs/experiments/token-transfer");
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  const checksum = (file) =>
    createHash("sha256")
      .update(fs.readFileSync(path.join(directory, file)))
      .digest("hex");
  const checksums = read("sha256.json");
  assert.deepEqual(
    Object.keys(checksums).sort(),
    fs
      .readdirSync(directory)
      .filter((file) => ![".gitattributes", "sha256.json"].includes(file))
      .sort(),
  );
  for (const [file, hash] of Object.entries(checksums))
    assert.equal(checksum(file), hash, file);

  const result = read("verification.json");
  assert.equal(result.status, "PASS");
  assert.equal(result.exit, 0);
  const { network, identities } = read("environment.json");
  assert.equal(network.protocolVersion, 28);
  const receipts = read("receipts.json");
  const deployed = receipts.find((item) => item.label === "deploy-asset");
  const bound = bindAsset(
    {
      ...deployed,
      returnValue: xdr.ScVal.fromXDR(deployed.return_xdr, "base64"),
    },
    new Asset("WEIGHIN", identities.issuer).contractId(network.passphrase),
  );
  assert.equal(bound.toXDR("base64"), result.bound_address_xdr);
  assert.ok(receipts.every((item) => item.status === "SUCCESS"));
  assert.equal(receipts.at(-1).label, "signed-transfer");
  assert.deepEqual(result.balances_before, ["1000000000", "100000000"]);
  assert.deepEqual(result.balances_after, ["975000000", "125000000"]);
  transferOperation(
    xdr.SorobanAuthorizationEntry.fromXDR(result.authorization_xdr, "base64"),
    bound,
    identities.sender,
    identities.recipient,
    result.amount,
  );

  const records = read("records.json");
  const replays = read("native.json");
  for (const [record] of Object.values(records)) {
    verifyTransferReplay(
      replays,
      record,
      bound,
      identities.sender,
      identities.recipient,
    );
  }
  assert.equal(compare(records.baseline, records.control).exit, 0);
  assert.deepEqual(
    compare(records.baseline, records.regression).violations.map(
      (item) => item.metric,
    ),
    ["cpu_instructions"],
  );
  assert.equal(read("bundled-control-process.json").exit, 0);
  assert.equal(read("bundled-regression-process.json").exit, 1);
  assert.match(read("overdraw.json").message, /Error\(Contract, #10\)/);
  assert.match(
    read("missing-account.json").message,
    /Invocation source account is not available/,
  );
});
