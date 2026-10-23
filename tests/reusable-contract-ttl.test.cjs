const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StrKey } = require("@stellar/stellar-sdk");
const {
  isContractDeployed,
  MIN_REUSABLE_CONTRACT_TTL_LEDGERS,
} = require("../dist/measurement");

const SAMPLE_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 0x33));

test("isContractDeployed accepts a reusable contract whose liveUntilLedgerSeq satisfies the minimum TTL window (#221)", async () => {
  const fakeServer = {
    async getLedgerEntries() {
      return {
        latestLedger: 1000,
        entries: [
          {
            liveUntilLedgerSeq: 1000 + MIN_REUSABLE_CONTRACT_TTL_LEDGERS + 50,
          },
        ],
      };
    },
  };
  const ok = await isContractDeployed(fakeServer, SAMPLE_CONTRACT);
  assert.equal(ok, true);
});

test("isContractDeployed rejects a near-expiry reusable contract so runMeasurement redeploys safely (#221)", async () => {
  const fakeServer = {
    async getLedgerEntries() {
      return {
        latestLedger: 1000,
        entries: [
          {
            liveUntilLedgerSeq: 1000 + MIN_REUSABLE_CONTRACT_TTL_LEDGERS - 1,
          },
        ],
      };
    },
  };
  const ok = await isContractDeployed(fakeServer, SAMPLE_CONTRACT);
  assert.equal(ok, false);
});
