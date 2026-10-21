const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

test("committed CycloneDX inventory matches the current locked inputs", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(root, "dist/dependency-inventory.js"), "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(output, /Dependency inventory verified/);
});

test("a clean packed consumer receives the inventory, bundles, native locks, and loadable API", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-packed-consumer-"));
  try {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        { cwd: root, encoding: "utf8" },
      ),
    )[0];
    const packagedPaths = new Set(packed.files.map(({ path: filePath }) => filePath));
    for (const filePath of [
      "docs/dependency-inventory.json",
      "docs/DEPENDENCY_SECURITY.md",
      "bundled/index.js",
      "bundled/comment-action.js",
      "native/simulation/Cargo.toml",
      "native/simulation/Cargo.lock",
    ]) {
      assert.ok(packagedPaths.has(filePath), `missing packed file ${filePath}`);
    }

    const consumer = path.join(temporary, "consumer");
    const tarball = path.join(temporary, packed.filename);
    // The consumer install prefers the npm cache but may fall back to the
    // registry: a cold CI cache holds the locked tarballs but not the
    // registry metadata npm resolves version ranges from.
    execFileSync(
      "npm",
      [
        "install",
        "--prefer-offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        consumer,
        tarball,
      ],
      { cwd: temporary, stdio: "pipe" },
    );
    execFileSync(process.execPath, ["-e", "require('weighin')"], {
      cwd: consumer,
      stdio: "pipe",
    });
    const installedInventory = JSON.parse(
      fs.readFileSync(
        path.join(consumer, "node_modules/weighin/docs/dependency-inventory.json"),
        "utf8",
      ),
    );
    const sourceInventory = JSON.parse(
      fs.readFileSync(path.join(root, "docs/dependency-inventory.json"), "utf8"),
    );
    assert.deepEqual(installedInventory, sourceInventory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("validateReusableDeployerKeyFile and runMeasurement reject symlink, non-regular, foreign-owned, and group/world-accessible key files before reading secrets or funding (#207)", async (t) => {
  const { Keypair } = require("@stellar/stellar-sdk");
  const {
    runMeasurement,
    validateReusableDeployerKeyFile,
  } = require("../dist/measurement");
  const accountMod = require("../dist/account");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-key-policy-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const wasmPath = path.join(tempDir, "contract.wasm");
  const fixturesPath = path.join(tempDir, "fixtures.json");
  fs.writeFileSync(wasmPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  fs.writeFileSync(
    fixturesPath,
    JSON.stringify({
      contracts: [
        {
          id: "greeting",
          wasm_path: "contract.wasm",
          invocations: [{ id: "world", function_name: "hello", args: [] }],
        },
      ],
    }),
  );

  let accountReadyCalls = 0;
  t.mock.method(accountMod, "ensureAccountReady", async () => {
    accountReadyCalls++;
  });

  // 1. Valid private key file (0600) passes validation and reaches ensureAccountReady
  const validKey = path.join(tempDir, "valid.key");
  fs.writeFileSync(validKey, Keypair.random().secret(), { mode: 0o600 });
  fs.chmodSync(validKey, 0o600);
  assert.doesNotThrow(() => validateReusableDeployerKeyFile(validKey));

  // 2. Symbolic link to a valid key is rejected before reading or funding
  const symlinkKey = path.join(tempDir, "symlink.key");
  fs.symlinkSync(validKey, symlinkKey);
  await assert.rejects(
    runMeasurement({
      fixturesPath,
      keyFile: symlinkKey,
      gitCommit: "test",
      sdkVersion: "16.0.1",
      rpcUrl: "http://controlled.invalid/rpc",
    }),
    /symbolic links are not permitted/,
  );
  assert.equal(accountReadyCalls, 0);

  // 3. Non-regular path (directory) is rejected before reading or funding
  const dirKey = path.join(tempDir, "dir.key");
  fs.mkdirSync(dirKey);
  await assert.rejects(
    runMeasurement({
      fixturesPath,
      keyFile: dirKey,
      gitCommit: "test",
      sdkVersion: "16.0.1",
      rpcUrl: "http://controlled.invalid/rpc",
    }),
    /must be a regular file/,
  );
  assert.equal(accountReadyCalls, 0);

  // 4. Group/world-readable key file (0644) containing non-key text is rejected
  // before Keypair.fromSecret or ensureAccountReady can run
  const insecureKey = path.join(tempDir, "insecure.key");
  fs.writeFileSync(insecureKey, "NOT_A_VALID_SECRET_SEED", { mode: 0o644 });
  fs.chmodSync(insecureKey, 0o644);
  await assert.rejects(
    runMeasurement({
      fixturesPath,
      keyFile: insecureKey,
      gitCommit: "test",
      sdkVersion: "16.0.1",
      rpcUrl: "http://controlled.invalid/rpc",
    }),
    /insecure permissions 0644/,
  );
  assert.equal(accountReadyCalls, 0);

  // 5. Foreign UID ownership is rejected on POSIX
  const validStats = fs.lstatSync(validKey);
  assert.throws(
    () =>
      validateReusableDeployerKeyFile(validKey, validStats, {
        platform: "linux",
        getuid: () => validStats.uid + 1000,
      }),
    /owner uid .* does not match current uid/,
  );
});
