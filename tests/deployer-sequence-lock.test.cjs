const { test } = require("node:test");
const assert = require("node:assert/strict");
const { withDeployerSequenceLock } = require("../dist/measurement");

test("withDeployerSequenceLock serializes concurrent sequence consumption for the same network and account (#222)", async () => {
  let seq = 100;
  const signedSequences = [];

  const worker = async (delayMs) =>
    withDeployerSequenceLock(
      "http://localhost:8000/rpc",
      "GSHAREDACCOUNT",
      async () => {
        const readSeq = seq;
        await new Promise((r) => setTimeout(r, delayMs));
        seq = readSeq + 1;
        signedSequences.push(seq);
        return seq;
      },
    );

  const [s1, s2, s3] = await Promise.all([worker(25), worker(5), worker(1)]);
  assert.deepEqual([s1, s2, s3], [101, 102, 103]);
  assert.deepEqual(signedSequences, [101, 102, 103]);
});

test("withDeployerSequenceLock releases lock ownership when a transaction fails or rejects (#222)", async () => {
  await assert.rejects(
    () =>
      withDeployerSequenceLock(
        "http://localhost:8000/rpc",
        "GSHAREDACCOUNT",
        async () => {
          throw new Error("Transaction rejected");
        },
      ),
    /Transaction rejected/,
  );

  const recovered = await withDeployerSequenceLock(
    "http://localhost:8000/rpc",
    "GSHAREDACCOUNT",
    async () => "next-caller-proceeded",
  );
  assert.equal(recovered, "next-caller-proceeded");
});
