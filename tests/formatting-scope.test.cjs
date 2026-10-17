const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("yaml");

const root = path.resolve(__dirname, "..");
const prettierBin = path.join(
  root,
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs",
);

function runPrettier(args) {
  return spawnSync(process.execPath, [prettierBin, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function getConfiguredScopeArgs(scriptCommand, modeFlag) {
  const prefix = `prettier ${modeFlag} `;
  assert.ok(
    scriptCommand.startsWith(prefix),
    `Expected script "${scriptCommand}" to start with "${prefix}"`,
  );
  return scriptCommand.slice(prefix.length).trim().split(/\s+/);
}

test("package.json lint and format scripts cover identical maintained scopes and CI runs npm run lint", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const checkArgs = getConfiguredScopeArgs(pkg.scripts.lint, "--check");
  const writeArgs = getConfiguredScopeArgs(pkg.scripts.format, "--write");

  assert.deepEqual(
    checkArgs,
    writeArgs,
    "lint (--check) and format (--write) must target the exact same maintained scope",
  );

  for (const requiredTarget of [
    "src",
    "test",
    "tests/*.test.cjs",
    "tests/native",
    "tests/support",
    "tests/experiments",
  ]) {
    assert.ok(
      checkArgs.includes(requiredTarget),
      `Formatting scope must explicitly include ${requiredTarget}`,
    );
  }

  const ciWorkflow = yaml.parse(
    fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  const lintSteps = ciWorkflow.jobs["lint-and-test"].steps
    .map((s) => s.run)
    .filter(Boolean);
  assert.ok(
    lintSteps.includes("npm run lint"),
    "CI workflow must run npm run lint",
  );
});

test("documented formatting boundary excludes frozen evidence snapshots, fixtures, WASMs, and generated bundles", () => {
  const ignoreText = fs.readFileSync(
    path.join(root, ".prettierignore"),
    "utf8",
  );
  for (const pattern of [
    "docs/experiments/",
    "tests/fixtures/",
    "bundled/",
    "dist/",
    "*.wasm",
  ]) {
    assert.ok(
      ignoreText.includes(pattern),
      `.prettierignore must explicitly exclude ${pattern}`,
    );
  }

  const contributing = fs.readFileSync(
    path.join(root, "CONTRIBUTING.md"),
    "utf8",
  );
  assert.ok(contributing.includes(".prettierignore"));
  assert.ok(contributing.includes("docs/experiments/"));
  assert.ok(contributing.includes("tests/fixtures/"));

  for (const excludedFile of [
    "docs/experiments/repeatability/completed/runs.json",
    "docs/experiments/repeatability/completed/run-1-reference.wasm",
    "tests/fixtures/distinct-contracts/distinct-fixtures.json",
    "bundled/index.js",
  ]) {
    const info = runPrettier(["--file-info", excludedFile]);
    assert.equal(info.status, 0, info.stderr);
    const parsed = JSON.parse(info.stdout);
    assert.equal(
      parsed.ignored,
      true,
      `${excludedFile} must be ignored by Prettier`,
    );
  }

  for (const includedFile of [
    "tests/comparison-identity.test.cjs",
    "tests/native/simulation.test.cjs",
    "tests/support/action-unit-hook.cjs",
    "tests/experiments/repeatability-analysis.cjs",
  ]) {
    const info = runPrettier(["--file-info", includedFile]);
    assert.equal(info.status, 0, info.stderr);
    const parsed = JSON.parse(info.stdout);
    assert.equal(
      parsed.ignored,
      false,
      `${includedFile} must be included in Prettier scope`,
    );
  }
});

test("configured formatting gate rejects a deliberately malformed temporary maintained test file and accepts the restored tree", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const checkArgs = getConfiguredScopeArgs(pkg.scripts.lint, "--check");
  const tempFile = path.join(
    root,
    "tests",
    "temp-malformed-gate-proof.test.cjs",
  );

  try {
    fs.writeFileSync(
      tempFile,
      "const {test}=require('node:test');test('bad',()=>{const   x={a:1,b:2};return x;});\n",
      "utf8",
    );

    const rejected = runPrettier(["--check", ...checkArgs]);
    assert.equal(
      rejected.status,
      1,
      "Formatting gate must exit 1 when a maintained test file is malformed",
    );
    const combinedOutput = `${rejected.stdout}\n${rejected.stderr}`;
    assert.match(combinedOutput, /temp-malformed-gate-proof\.test\.cjs/);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }

  const restored = runPrettier(["--check", ...checkArgs]);
  assert.equal(
    restored.status,
    0,
    `Formatting gate must accept the restored tree: ${restored.stderr || restored.stdout}`,
  );
});
