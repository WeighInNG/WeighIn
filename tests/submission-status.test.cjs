// Deterministic submission-status tests. The RPC transport is fully controlled
// here: no live network, deployment lookup or native helper is exercised. These
// tests verify how runMeasurement classifies sendTransaction before polling.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Account, Address, Keypair, rpc } = require("@stellar/stellar-sdk");
const {
  DEFAULT_DEPLOYMENT_TIMEOUT_SECONDS,
  parseDeploymentTimeoutSeconds,
  runMeasurement,
} = require("../dist/measurement");

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const TEST_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const FULL_ORDER = [
  "getLedgerEntries",
  "getAccount",
  "prepareTransaction",
  "sendTransaction",
  "getTransaction",
  "getAccount",
  "prepareTransaction",
  "sendTransaction",
  "getTransaction",
  "getAccount",
  "simulateTransaction",
];

// A send response is only ever a plain SDK-shaped object. The mocked
// sendTransaction never serializes a transaction, so no envelope is involved.
function send(status, hash) {
  return { status, hash, latestLedger: 1, latestLedgerCloseTime: 1 };
}

function scenario(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-submission-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "key"), Keypair.random().secret(), {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(dir, "contract.wasm"), TEST_WASM);
  fs.writeFileSync(
    path.join(dir, "fixtures.json"),
    JSON.stringify({
      contracts: [
        {
          id: "greeting",
          wasm_path: "contract.wasm",
          invocations: [
            {
              id: "world",
              function_name: "hello",
              args: [{ type: "Symbol", value: "world" }],
            },
          ],
        },
      ],
    }),
  );

  const order = [];
  const state = { send: 0, poll: 0 };
  let createAddress;

  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  if (options.fakeTimers) {
    let elapsedMs = 0;
    t.mock.method(Date, "now", () => elapsedMs);
    t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
      setImmediate(() => {
        elapsedMs += delay;
        callback(...args);
      }),
    );
    t.mock.method(globalThis, "clearTimeout", (timer) => clearImmediate(timer));
  }
  t.mock.method(
    require("../dist/account"),
    "ensureAccountReady",
    async () => {},
  );
  t.mock.method(rpc.Server.prototype, "getAccount", async (address) => {
    order.push("getAccount");
    return new Account(address, "1");
  });
  t.mock.method(rpc.Server.prototype, "getLedgerEntries", async (key) => {
    order.push("getLedgerEntries");
    createAddress = Address.fromScAddress(key.contractData().contract());
    return { entries: [] };
  });
  t.mock.method(rpc.Server.prototype, "prepareTransaction", async () => {
    order.push("prepareTransaction");
    return { sign() {} };
  });
  t.mock.method(rpc.Server.prototype, "sendTransaction", async () => {
    order.push("sendTransaction");
    if (options.sendThrows) throw options.sendThrows;
    return options.sends[state.send++];
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async (hash) => {
    order.push("getTransaction");
    state.poll++;
    const status = options.poll ? await options.poll(hash) : "SUCCESS";
    return {
      status,
      returnValue:
        status === "SUCCESS" && hash === H2
          ? createAddress.toScVal()
          : undefined,
    };
  });
  t.mock.method(
    require("../dist/simulation"),
    "resolveSimulationHelper",
    async () => "/fake/helper",
  );
  t.mock.method(
    require("../dist/simulation"),
    "measureInvocation",
    async () => {
      order.push("simulateTransaction");
      throw new Error("reached invocation");
    },
  );

  return {
    order,
    state,
    run: (deploymentTimeoutSeconds) =>
      runMeasurement({
        fixturesPath: path.join(dir, "fixtures.json"),
        fixtureId: "fixtures.json",
        keyFile: path.join(dir, "key"),
        gitCommit: "test-submission",
        sdkVersion: "16.0.1",
        rpcUrl: options.rpcUrl ?? "http://controlled.invalid/rpc",
        helperPath: path.join(dir, "missing-helper"),
        deploymentTimeoutSeconds,
      }),
  };
}

test("deployment timeout parser keeps the default and accepts bounded integers", () => {
  assert.equal(
    parseDeploymentTimeoutSeconds(""),
    DEFAULT_DEPLOYMENT_TIMEOUT_SECONDS,
  );
  assert.equal(parseDeploymentTimeoutSeconds("1"), 1);
  assert.equal(parseDeploymentTimeoutSeconds("600"), 600);
});

for (const raw of ["0", "601", "1.5", "-1", "nope"])
  test(`deployment timeout parser rejects ${raw}`, () => {
    assert.throws(
      () => parseDeploymentTimeoutSeconds(raw),
      /deployment-timeout-seconds must be an integer between 1 and 600 seconds/,
    );
  });

test("runMeasurement rejects invalid deployment deadlines before RPC work", async (t) => {
  const { order, run } = scenario(t, { sends: [] });
  for (const timeout of [0, 601, 1.5, Number.NaN]) {
    await assert.rejects(run(timeout), /between 1 and 600 seconds/);
  }
  assert.deepEqual(order, []);
});

test("upload PENDING with a valid hash confirms before continuing to create", async (t) => {
  const { order, state, run } = scenario(t, {
    sends: [send("PENDING", H1), send("PENDING", H2)],
    fakeTimers: true,
  });
  await assert.rejects(run(), /reached invocation/);
  assert.deepEqual(order, FULL_ORDER);
  assert.equal(state.send, 2);
  assert.equal(state.poll, 2);
});

test("upload DUPLICATE with a valid hash still requires confirmed SUCCESS", async (t) => {
  const { order, state, run } = scenario(t, {
    sends: [send("DUPLICATE", H1), send("PENDING", H2)],
  });
  await assert.rejects(run(), /reached invocation/);
  assert.deepEqual(order, FULL_ORDER);
  assert.equal(state.poll, 2);
});

for (const [label, response] of [
  ["ERROR", send("ERROR", "")],
  ["TRY_AGAIN_LATER", send("TRY_AGAIN_LATER", H1)],
  ["PENDING with a missing hash", send("PENDING", "")],
  ["PENDING with an invalid hash", send("PENDING", "not-a-hash")],
  ["an unknown status", send("WEIRD", H1)],
]) {
  test(`upload ${label} fails before any confirmation poll and stops dependent work`, async (t) => {
    const { order, state, run } = scenario(t, { sends: [response] });
    await assert.rejects(run(), /WASM upload/);
    assert.ok(!order.includes("getTransaction"), "no confirmation poll");
    assert.ok(!order.includes("simulateTransaction"), "no dependent work");
    assert.equal(state.send, 1, "create was never submitted");
    assert.equal(state.poll, 0);
  });
}

test("upload ERROR names the phase and status without dumping the envelope", async (t) => {
  const { run } = scenario(t, { sends: [send("ERROR", H1)] });
  await assert.rejects(run(), (error) => {
    assert.match(error.message, /WASM upload/);
    assert.match(error.message, /status=ERROR/);
    assert.ok(!error.message.includes("envelopeXdr"));
    return true;
  });
});

test("upload TRY_AGAIN_LATER is an explicit temporary failure", async (t) => {
  const { order, run } = scenario(t, { sends: [send("TRY_AGAIN_LATER", H1)] });
  await assert.rejects(run(), /temporarily rejected/);
  assert.ok(!order.includes("getTransaction"));
});

test("upload PENDING that confirms as FAILED preserves the failure", async (t) => {
  const { order, state, run } = scenario(t, {
    sends: [send("PENDING", H1)],
    poll: () => "FAILED",
    fakeTimers: true,
  });
  await assert.rejects(run(), (error) => {
    assert.match(error.message, /WASM upload transaction/);
    assert.match(error.message, new RegExp(H1));
    assert.match(error.message, /did not succeed/);
    return true;
  });
  assert.equal(state.poll, 1);
  assert.ok(!order.includes("simulateTransaction"));
});

test("upload DUPLICATE that confirms as FAILED preserves the failure", async (t) => {
  const { state, run } = scenario(t, {
    sends: [send("DUPLICATE", H1)],
    poll: () => "FAILED",
  });
  await assert.rejects(run(), /did not succeed/);
  assert.equal(state.poll, 1);
});

for (const [label, response] of [
  ["ERROR", send("ERROR", "")],
  ["TRY_AGAIN_LATER", send("TRY_AGAIN_LATER", H2)],
  ["PENDING with a missing hash", send("PENDING", "")],
  ["PENDING with an invalid hash", send("PENDING", "nope")],
  ["an unknown status", send("UNRECOGNIZED", H2)],
]) {
  test(`create ${label} fails after upload confirms and never polls`, async (t) => {
    const { order, state, run } = scenario(t, {
      sends: [send("PENDING", H1), response],
      poll: () => "SUCCESS",
    });
    await assert.rejects(run(), /contract creation/);
    assert.equal(state.send, 2);
    assert.equal(state.poll, 1, "only the upload transaction was polled");
    assert.ok(!order.includes("simulateTransaction"));
  });
}

test("create PENDING that confirms as FAILED preserves the failure", async (t) => {
  const { order, state, run } = scenario(t, {
    sends: [send("PENDING", H1), send("PENDING", H2)],
    poll: (hash) => (hash === H2 ? "FAILED" : "SUCCESS"),
  });
  await assert.rejects(run(), /contract creation transaction/);
  assert.equal(state.poll, 2);
  assert.ok(!order.includes("simulateTransaction"));
});

test("an unanswered accepted transaction reports phase, hash and elapsed deadline", async (t) => {
  const { state, run } = scenario(t, {
    sends: [send("PENDING", H1)],
    poll: () => "NOT_FOUND",
    fakeTimers: true,
  });
  await assert.rejects(run(2), (error) => {
    assert.match(error.message, /deadline expired during WASM upload/);
    assert.match(error.message, new RegExp(`hash=${H1}`));
    assert.match(error.message, /elapsed=2\.0s/);
    assert.match(error.message, /timeout=2s/);
    return true;
  });
  assert.equal(state.poll, 2);
  assert.equal(state.send, 1);
});

test("a stalled RPC poll is bounded by the deployment deadline", async (t) => {
  const { state, run } = scenario(t, {
    sends: [send("PENDING", H1)],
    poll: () => new Promise(() => {}),
    fakeTimers: true,
  });
  await assert.rejects(run(1), (error) => {
    assert.match(error.message, /deadline expired during WASM upload/);
    assert.match(error.message, new RegExp(`hash=${H1}`));
    assert.match(error.message, /elapsed=1\.0s/);
    return true;
  });
  assert.equal(state.poll, 1);
});

test("submission transport errors are reported without endpoint credentials", async (t) => {
  const secretRpc = "http://user:secret@host:8000/rpc?token=abc";
  const { run } = scenario(t, {
    rpcUrl: secretRpc,
    sendThrows: new Error(`request to ${secretRpc} failed`),
  });
  await assert.rejects(run(), (error) => {
    assert.match(error.message, /WASM upload submission failed/);
    assert.match(error.message, /http:\/\/host:8000\/rpc/);
    assert.ok(!error.message.includes("secret"));
    assert.ok(!error.message.includes("token=abc"));
    return true;
  });
});
