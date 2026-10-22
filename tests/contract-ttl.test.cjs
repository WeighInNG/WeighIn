const { test } = require("node:test");
const assert = require("node:assert/strict");
const { xdr, Address, StrKey } = require("@stellar/stellar-sdk");
const {
  ensureContractDeployed,
  DEFAULT_MIN_CONTRACT_TTL_LEDGERS: MIN,
} = require("../dist/measurement");

const LATEST = 1000;
const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
const wasmHash = Buffer.alloc(32, 9);
const scAddress = Address.fromString(contractId).toScAddress();
const instanceKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: scAddress,
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
  }),
);
const instanceData = xdr.LedgerEntryData.contractData(
  new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: scAddress,
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val: xdr.ScVal.scvBool(true),
  }),
);

function makeServer({
  instancePresent = true,
  codePresent = true,
  instanceLiveUntil,
  codeLiveUntil,
} = {}) {
  const calls = { reads: 0, mutations: 0 };
  const mutate = (name) => async () => {
    calls.mutations++;
    throw new Error(`${name} reached`);
  };
  const server = {
    getLedgerEntries: async (key) => {
      calls.reads++;
      if (key.switch().name === "contractCode") {
        return {
          latestLedger: LATEST,
          entries: codePresent
            ? [
                {
                  key: key.toXDR("base64"),
                  xdr: instanceData.toXDR("base64"),
                  liveUntilLedgerSeq: codeLiveUntil,
                },
              ]
            : [],
        };
      }
      return {
        latestLedger: LATEST,
        entries: instancePresent
          ? [
              {
                key: instanceKey.toXDR("base64"),
                xdr: instanceData.toXDR("base64"),
                liveUntilLedgerSeq: instanceLiveUntil,
              },
            ]
          : [],
      };
    },
    getAccount: mutate("getAccount"),
    prepareTransaction: mutate("prepareTransaction"),
    sendTransaction: mutate("sendTransaction"),
  };
  return { server, calls };
}

function run(server, extra = {}) {
  return ensureContractDeployed({
    server,
    deployer: { publicKey: () => "GDEPLOYER" },
    deployerAddress: scAddress,
    wasmBytes: Buffer.alloc(0),
    wasmHash,
    salt: Buffer.alloc(32),
    contractId,
    rpcUrl: "http://localhost:0",
    ...extra,
  });
}

const HEALTHY = LATEST + MIN; // exactly the minimum window remaining

test("reuse succeeds with exactly the minimum TTL window on instance and code", async () => {
  const { server, calls } = makeServer({
    instanceLiveUntil: HEALTHY,
    codeLiveUntil: HEALTHY,
  });
  await run(server);
  assert.equal(calls.reads, 2);
  assert.equal(calls.mutations, 0);
});

test("an instance below the minimum window fails before any submission", async () => {
  const { server, calls } = makeServer({
    instanceLiveUntil: HEALTHY - 1,
    codeLiveUntil: HEALTHY,
  });
  await assert.rejects(() => run(server), /instance expires too soon/);
  assert.equal(calls.mutations, 0);
});

test("contract code below the minimum window fails before any submission", async () => {
  const { server, calls } = makeServer({
    instanceLiveUntil: HEALTHY,
    codeLiveUntil: HEALTHY - 1,
  });
  await assert.rejects(() => run(server), /code expires too soon/);
  assert.equal(calls.mutations, 0);
});

test("a deployed instance whose code entry is gone fails without mutating", async () => {
  const { server, calls } = makeServer({
    instanceLiveUntil: HEALTHY,
    codePresent: false,
  });
  await assert.rejects(() => run(server), /found 0 contract code entries/);
  assert.equal(calls.mutations, 0);
});

test("missing TTL metadata fails closed", async () => {
  const { server, calls } = makeServer({ codeLiveUntil: HEALTHY });
  await assert.rejects(() => run(server), /no TTL metadata for the instance/);
  assert.equal(calls.mutations, 0);
});

test("minTtlLedgers is honored in both directions", async () => {
  const live = LATEST + 50;
  const { server } = makeServer({ instanceLiveUntil: live, codeLiveUntil: live });
  await run(server, { minTtlLedgers: 50 });
  await assert.rejects(
    () => run(server, { minTtlLedgers: 51 }),
    /expires too soon/,
  );
});

test("an invalid minimum window is rejected", async () => {
  const { server } = makeServer({
    instanceLiveUntil: HEALTHY,
    codeLiveUntil: HEALTHY,
  });
  await assert.rejects(
    () => run(server, { minTtlLedgers: -1 }),
    /Invalid minimum contract TTL window/,
  );
});

test("a fresh deploy skips the TTL check and proceeds to the deploy path", async () => {
  const { server, calls } = makeServer({ instancePresent: false });
  await assert.rejects(() => run(server), /getAccount reached/);
  assert.equal(calls.reads, 1);
});
