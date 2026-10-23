const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Address, Keypair, StrKey, hash } = require("@stellar/stellar-sdk");
const { verifyCreatedContractReceipt } = require("../dist/measurement");

function makeContractAddress(seedByte) {
  return StrKey.encodeContract(Buffer.alloc(32, seedByte));
}

test("verifyCreatedContractReceipt accepts a receipt whose decoded returnValue matches expectedContractId (#220)", () => {
  const expected = makeContractAddress(0x11);
  const returnValue = Address.fromString(expected).toScVal();
  assert.doesNotThrow(() =>
    verifyCreatedContractReceipt({ status: "SUCCESS", returnValue }, expected),
  );
});

test("verifyCreatedContractReceipt rejects an unexpected contract address and retains both expected and observed IDs (#220)", () => {
  const expected = makeContractAddress(0x11);
  const observed = makeContractAddress(0x22);
  const returnValue = Address.fromString(observed).toScVal();
  assert.throws(
    () =>
      verifyCreatedContractReceipt(
        { status: "SUCCESS", returnValue },
        expected,
      ),
    (err) =>
      err instanceof Error &&
      err.message.includes(`expected=${expected}`) &&
      err.message.includes(`observed=${observed}`),
  );
});
