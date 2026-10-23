const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Keypair } = require("@stellar/stellar-sdk");
const { runMeasurement } = require("../dist/measurement");

test("API calls without keyFile create an owned temporary key directory and remove it on failure without leaving .weighin-temp-key beside fixtures (#219)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-key-lifecycle-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fixturesPath = path.join(dir, "fixtures.json");
  fs.writeFileSync(
    fixturesPath,
    JSON.stringify({
      contracts: [
        {
          id: "greeting",
          wasm_path: "missing.wasm",
          invocations: [{ id: "world", function_name: "hello", args: [] }],
        },
      ],
    }),
  );

  let observedTempDirs = [];
  t.mock.method(require("../dist/account"), "ensureAccountReady", async () => {
    observedTempDirs = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith("weighin-deployer-key-"))
      .map((name) => path.join(os.tmpdir(), name));
  });

  await assert.rejects(
    () =>
      runMeasurement({
        fixturesPath,
        gitCommit: "abc1234",
        sdkVersion: "16.0.1",
      }),
    /WASM not found/,
  );

  assert.ok(
    observedTempDirs.length >= 1,
    "Expected owned temporary directory to exist during runMeasurement",
  );
  assert.equal(
    fs.existsSync(path.join(dir, ".weighin-temp-key")),
    false,
    "Must not leave .weighin-temp-key beside fixtures",
  );
  for (const d of observedTempDirs) {
    assert.equal(
      fs.existsSync(d),
      false,
      "Owned temporary key directory must be deleted after runMeasurement finishes",
    );
  }
});

test("caller-supplied reusable keyFile is preserved across success and failure (#219)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-reusable-key-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const reusableKeyFile = path.join(dir, "shared-action.key");
  const kp = Keypair.random();
  fs.writeFileSync(reusableKeyFile, kp.secret(), { mode: 0o600 });

  const fixturesPath = path.join(dir, "fixtures.json");
  fs.writeFileSync(
    fixturesPath,
    JSON.stringify({
      contracts: [
        {
          id: "greeting",
          wasm_path: "missing.wasm",
          invocations: [{ id: "world", function_name: "hello", args: [] }],
        },
      ],
    }),
  );

  t.mock.method(
    require("../dist/account"),
    "ensureAccountReady",
    async () => {},
  );

  await assert.rejects(
    () =>
      runMeasurement({
        fixturesPath,
        gitCommit: "abc1234",
        sdkVersion: "16.0.1",
        keyFile: reusableKeyFile,
      }),
    /WASM not found/,
  );

  assert.equal(
    fs.existsSync(reusableKeyFile),
    true,
    "Supplied reusable keyFile must be preserved",
  );
  assert.equal(
    fs.readFileSync(reusableKeyFile, "utf8").trim(),
    kp.secret(),
    "Supplied reusable keyFile secret must remain unchanged",
  );
});
