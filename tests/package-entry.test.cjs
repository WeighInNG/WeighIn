const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
test("package main loads the existing measurement API", () => {
  const api = require("..");
  assert.equal(typeof api.runMeasurement, "function");
  assert.equal(typeof api.metricsFromSimulation, "function");
});
test("declared CLI entry runs and fails clearly without producing results for missing fixtures", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-package-entry-"),
  );
  try {
    const pkg = require("../package.json"),
      output = path.join(temporary, "results.json");
    const r = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "..", pkg.bin.weighin),
        path.join(temporary, "missing.json"),
        "--output",
        output,
      ],
      { cwd: temporary, encoding: "utf8", timeout: 10000 },
    );
    assert.ifError(r.error);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Benchmarking failed/);
    assert.match(r.stderr, /ENOENT/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI rejects ambiguous combination of stdout mode and explicit output file", () => {
  const pkg = require("../package.json");
  const bin = path.resolve(__dirname, "..", pkg.bin.weighin);

  // Case 1: --json-stdout and --output file.json
  const r1 = spawnSync(
    process.execPath,
    [bin, "fixtures.json", "--json-stdout", "--output", "out.json"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /Ambiguous output configuration/);
  assert.equal(r1.stdout, "");

  // Case 2: --stdout and positional output
  const r2 = spawnSync(
    process.execPath,
    [bin, "fixtures.json", "positional.json", "--stdout"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /Ambiguous output configuration/);
  assert.equal(r2.stdout, "");
});

test("CLI stdout failure emits error on stderr and nothing on stdout", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-stdout-fail-"),
  );
  try {
    const pkg = require("../package.json");
    const bin = path.resolve(__dirname, "..", pkg.bin.weighin);
    const r = spawnSync(
      process.execPath,
      [bin, path.join(temporary, "nonexistent.json"), "--json-stdout"],
      { cwd: temporary, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Benchmarking failed/);
    assert.equal(r.stdout, "");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI rejects a missing helper flag value before measurement", () => {
  const bin = path.resolve(
    __dirname,
    "..",
    require("../package.json").bin.weighin,
  );
  for (const args of [[], [""], ["   "], ["--json-stdout"]]) {
    const result = spawnSync(
      process.execPath,
      [bin, "--helper-path", ...args],
      {
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /--helper-path requires a path to an executable/,
    );
    assert.equal(result.stdout, "");
  }
});

test("CLI helper override uses the existing resolver and fails closed", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-cli-helper-"),
  );
  try {
    const root = path.resolve(__dirname, "..");
    const bin = path.join(root, require("../package.json").bin.weighin);
    const preload = path.join(temporary, "resolve-only.cjs");
    // Exercise the real CLI and helper resolver without funding or deploying a fixture.
    fs.writeFileSync(
      preload,
      `
      const { resolveSimulationHelper } = require(${JSON.stringify(path.join(root, "dist/simulation.js"))});
      require(${JSON.stringify(path.join(root, "dist/measurement.js"))}).runMeasurement = async ({ helperPath }) => {
        const resolved = await resolveSimulationHelper(helperPath, async () => {
          throw new Error('Unexpected fallback build');
        });
        return { resolved };
      };
    `,
    );
    const helper = "custom helper";
    const environmentHelper = path.join(temporary, "environment-helper");
    fs.writeFileSync(path.join(temporary, helper), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    fs.writeFileSync(environmentHelper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    fs.writeFileSync(path.join(temporary, "nonexecutable"), "not executable", {
      mode: 0o600,
    });
    function run(...args) {
      const result = spawnSync(
        process.execPath,
        ["--require", preload, bin, "--json-stdout", ...args],
        {
          cwd: temporary,
          encoding: "utf8",
          timeout: 10000,
          env: { ...process.env, WEIGHIN_HELPER_PATH: environmentHelper },
        },
      );
      assert.ifError(result.error);
      return result;
    }
    const explicit = run("--helper-path", helper);
    if (process.platform !== "linux" || process.arch !== "x64") {
      assert.equal(explicit.status, 1);
      assert.match(explicit.stderr, /supports Linux x64 only/);
      assert.equal(explicit.stdout, "");
      return;
    }
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(JSON.parse(explicit.stdout), {
      resolved: path.join(temporary, helper),
    });
    const inherited = run();
    assert.equal(inherited.status, 0, inherited.stderr);
    assert.deepEqual(JSON.parse(inherited.stdout), {
      resolved: environmentHelper,
    });
    for (const invalid of ["missing", "nonexecutable"]) {
      const result = run("--helper-path", invalid);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /Simulation helper missing or not executable/,
      );
      assert.ok(result.stderr.includes(path.join(temporary, invalid)));
      assert.equal(result.stdout, "");
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
