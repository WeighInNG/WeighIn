const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Address, nativeToScVal, StrKey, xdr } = require("@stellar/stellar-sdk");
const { resolveBinding } = require("../../dist/setup-plan");
const { diffBenchmarks } = require("../../dist/diff");
const {
  enforceThresholds,
  loadConfigContent,
} = require("../../dist/threshold");

function bindAsset(receipt, expectedAddress) {
  assert.equal(receipt.status, "SUCCESS", "asset deployment must be committed");
  assert.ok(
    Number.isSafeInteger(receipt.ledger) && receipt.ledger > 0,
    "asset deployment must have an inclusion ledger",
  );
  const address = resolveBinding({ contract: "asset" }, "address", {
    logical_id: "id:asset",
    contract_id: expectedAddress,
    source: "created",
    return_xdr: receipt.returnValue?.toXDR("base64"),
  });
  assert.equal(
    Address.fromScVal(address).toString(),
    expectedAddress,
    "committed asset address must match the configured asset and network",
  );
  return address;
}

function transferFixture(wasm, asset, sender, recipient, amount) {
  return {
    id: "standard-token",
    contracts: [
      {
        id: "transfer-client",
        wasm_path: wasm,
        invocations: [
          {
            id: "funded-transfer",
            function_name: "transfer",
            args: [
              ...[Address.fromScVal(asset).toString(), sender, recipient].map(
                (value) => ({ type: "address", value }),
              ),
              { type: "i128", value: amount },
            ],
          },
        ],
      },
    ],
  };
}

const policy =
  '[thresholds.functions.transfer]\ncpu_instructions = "strict_zero_tolerance"\n';

function compare(base, head) {
  const diff = diffBenchmarks(base, head);
  const violations = enforceThresholds(
    diff,
    loadConfigContent(policy, "token-policy.toml"),
  );
  return { diff, violations, exit: violations.length ? 1 : 0 };
}

function transferOperation(record, asset, source, recipient, amount) {
  const invocation = record.rootInvocation();
  const transfer = [invocation, ...invocation.subInvocations()].find((item) => {
    const fn = item.function();
    return (
      fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn" &&
      fn.contractFn().functionName().toString() === "transfer" &&
      Address.fromScAddress(fn.contractFn().contractAddress()).toString() ===
        Address.fromScVal(asset).toString()
    );
  });
  assert.ok(transfer, "authorization must include the token transfer");
  const call = transfer.function().contractFn();
  assert.deepEqual(
    call.args().map((value) => value.toXDR("base64")),
    [
      new Address(source).toScVal(),
      new Address(recipient).toScVal(),
      nativeToScVal(BigInt(amount), { type: "i128" }),
    ].map((value) => value.toXDR("base64")),
  );
}

function verifyTransferReplay(replays, record, asset, sender, recipient) {
  const [benchmark] = record.benchmarks;
  assert.equal(benchmark.provenance.source_account, sender);
  const replay = replays.find(
    ({ input, output }) =>
      output &&
      createHash("sha256").update(JSON.stringify(input)).digest("hex") ===
        benchmark.provenance.input_sha256,
  );
  assert.ok(replay, "measurement must identify its successful native input");
  const invoke = xdr.HostFunction.fromXDR(
    replay.input.host_function_xdr,
    "base64",
  ).invokeContract();
  assert.equal(invoke.functionName().toString(), "transfer");
  assert.equal(
    Address.fromScAddress(invoke.contractAddress()).toString(),
    record.contract_id,
  );
  assert.equal(invoke.args()[0].toXDR("base64"), asset.toXDR("base64"));
  const holders = replay.output.read_write_keys
    .map((key) => xdr.LedgerKey.fromXDR(key, "base64"))
    .filter((key) => key.switch().name === "trustline")
    .map((key) =>
      StrKey.encodeEd25519PublicKey(key.trustLine().accountId().ed25519()),
    )
    .sort();
  assert.deepEqual(holders, [sender, recipient].sort());
  assert.ok(
    replay.output.contract_events_xdr
      .map((event) => xdr.ContractEvent.fromXDR(event, "base64"))
      .some(
        (event) =>
          event.contractId()?.equals(asset.address().contractId()) &&
          event.body().v0().topics()[0]?.sym().toString() === "transfer",
      ),
    "replay must emit the standard token transfer event",
  );
}

module.exports = {
  bindAsset,
  compare,
  policy,
  transferFixture,
  transferOperation,
  verifyTransferReplay,
};
