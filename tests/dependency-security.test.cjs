const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("policy parser rejects scalar prototype traversal without polluting the process", () => {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const TOML = require('toml');
    for (const payload of [
      '[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__]\\nweighin_polluted = "yes"',
      'aa = 1\\n[[a]]\\n[aa.__proto__.__proto__]\\nweighin_polluted = "yes"'
    ]) {
      assert.throws(() => TOML.parse(payload));
      assert.equal(({}).weighin_polluted, undefined);
    }
  `,
    ],
    { cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
});

test("policy parser accepts supported named, decimal and absolute cap configurations", () => {
  const TOML = require("toml");
  const { validateConfig } = require("../dist/threshold");
  const config = TOML.parse(
    '[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\nmemory_bytes="allow_2.5_percent_increase"\n[limits.functions.hello]\ncpu_instructions=350000',
  );
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(config.limits.functions.hello.cpu_instructions, 350000);
  assert.equal(
    config.thresholds.functions.hello.memory_bytes,
    "allow_2.5_percent_increase",
  );
});

test("reproducible dependency inventory matches locked npm/Cargo inputs and reconciles clean packed consumer artifacts", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const {
    DEPENDENCY_INVENTORY_DISCLAIMER,
    generateDependencyInventory,
    verifyDependencyInventory,
  } = require("../dist/dependency-inventory");

  const committed = JSON.parse(
    fs.readFileSync(path.join(root, "docs/dependency-inventory.json"), "utf8"),
  );
  assert.doesNotThrow(() =>
    verifyDependencyInventory(committed, { rootDir: root }),
  );
  assert.equal(committed.disclaimer, DEPENDENCY_INVENTORY_DISCLAIMER);
  assert.match(committed.disclaimer, /not vulnerability clearance/i);
  assert.match(committed.disclaimer, /license\/legal certification/i);
  assert.equal(
    committed.packageDistribution.actionBundle.unreconciledPackages.length,
    0,
  );
  assert.equal(
    committed.packageDistribution.commentBundle.unreconciledPackages.length,
    0,
  );

  // Verify a clean packed consumer workspace reconstructed from package.json files
  // and locked manifests reproduces the identical inventory.
  const cleanConsumer = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-packed-consumer-"),
  );
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    for (const rel of [
      "package.json",
      "package-lock.json",
      "bundled/index.js",
      "bundled/comment-action.js",
      "native/simulation/Cargo.toml",
      "native/simulation/Cargo.lock",
      "dist/dependency-inventory.js",
    ]) {
      const dest = path.join(cleanConsumer, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, rel), dest);
    }
    for (const requiredEntry of committed.packageDistribution
      .requiredShippedPaths) {
      assert.ok(
        pkgJson.files.includes(requiredEntry),
        `package.json files must include ${requiredEntry}`,
      );
      assert.ok(
        fs.existsSync(path.join(root, requiredEntry)),
        `Shipped path must exist: ${requiredEntry}`,
      );
    }
    const consumerInventory = generateDependencyInventory({
      rootDir: cleanConsumer,
    });
    assert.deepEqual(consumerInventory, committed);
  } finally {
    fs.rmSync(cleanConsumer, { recursive: true, force: true });
  }
});
