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
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /Ambiguous output configuration/);
  assert.equal(r1.stdout, "");

  // Case 2: --stdout and positional output
  const r2 = spawnSync(
    process.execPath,
    [bin, "fixtures.json", "positional.json", "--stdout"],
    { encoding: "utf8", timeout: 30000 },
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

const STUB_RESULTS = [{ contract_id: "stub-contract", benchmarks: [] }];

function writeOutputPreload(directory, root) {
  const preload = path.join(directory, "output-preload.cjs");
  fs.writeFileSync(
    preload,
    `
    const fs = require("fs");
    const actualWriteFileSync = fs.writeFileSync;
    const actualOpenSync = fs.openSync;
    const actualRenameSync = fs.renameSync;
    require(${JSON.stringify(path.join(root, "dist/measurement.js"))}).runMeasurement = async () => {
      if (process.env.WEIGHIN_TEST_MEASUREMENT_FAIL === "1") {
        throw new Error("stubbed measurement failure");
      }
      return ${JSON.stringify(STUB_RESULTS)};
    };
    fs.openSync = function (target, ...rest) {
      if (typeof target === "string" && target.endsWith(".tmp") && process.env.WEIGHIN_TEST_TEMP_LOG) {
        actualWriteFileSync(process.env.WEIGHIN_TEST_TEMP_LOG, target + "\\n", { flag: "a" });
      }
      return actualOpenSync.call(this, target, ...rest);
    };
    fs.writeFileSync = function (target, ...rest) {
      if (typeof target === "number" && process.env.WEIGHIN_TEST_WRITE_FAIL === "1") {
        actualWriteFileSync(target, '{"partial":');
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }
      return actualWriteFileSync.call(this, target, ...rest);
    };
    fs.renameSync = function (source, ...rest) {
      if (process.env.WEIGHIN_TEST_RENAME_FAIL === "1" && String(source).endsWith(".tmp")) {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
      }
      return actualRenameSync.call(this, source, ...rest);
    };
  `,
  );
  return preload;
}

function runCli(bin, preload, cwd, args, env = {}) {
  return spawnSync(process.execPath, ["--require", preload, bin, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      WEIGHIN_TEST_MEASUREMENT_FAIL: "0",
      WEIGHIN_TEST_WRITE_FAIL: "0",
      WEIGHIN_TEST_RENAME_FAIL: "0",
      ...env,
    },
  });
}

function temporaryFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".tmp"))
    .sort();
}

function loggedTemporaryFiles(log) {
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

test("CLI publishes complete JSON to a nested output path with missing parents", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-cli-nested-output-"),
  );
  try {
    const root = path.resolve(__dirname, "..");
    const bin = path.join(root, require("../package.json").bin.weighin);
    const preload = writeOutputPreload(temporary, root);
    const output = path.join(temporary, "reports", "2026", "results.json");

    const result = runCli(bin, preload, temporary, ["--output", output]);

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), STUB_RESULTS);
    assert.match(result.stdout, /Done\. Results written to/);
    assert.deepEqual(temporaryFiles(path.dirname(output)), []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI measurement failure leaves an existing result untouched", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-cli-measurement-failure-"),
  );
  try {
    const root = path.resolve(__dirname, "..");
    const bin = path.join(root, require("../package.json").bin.weighin);
    const preload = writeOutputPreload(temporary, root);
    const output = path.join(temporary, "results.json");
    const previous = '{"previous":true}';
    fs.writeFileSync(output, previous);

    const result = runCli(bin, preload, temporary, ["--output", output], {
      WEIGHIN_TEST_MEASUREMENT_FAIL: "1",
    });

    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Benchmarking failed/);
    assert.match(result.stderr, /stubbed measurement failure/);
    assert.equal(fs.readFileSync(output, "utf8"), previous);
    assert.deepEqual(temporaryFiles(temporary), []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI filesystem failures return nonzero, preserve the previous result and clean up only owned temporaries", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-cli-write-failure-"),
  );
  try {
    const root = path.resolve(__dirname, "..");
    const bin = path.join(root, require("../package.json").bin.weighin);
    const preload = writeOutputPreload(temporary, root);
    const output = path.join(temporary, "results.json");
    const previous = '{"previous":true}';
    const foreignTemporary = path.join(
      temporary,
      ".results.json.another-run.tmp",
    );
    const tempLog = path.join(temporary, "temporary-paths.log");
    fs.writeFileSync(output, previous);
    fs.writeFileSync(foreignTemporary, "another run's temporary file");

    const writeFailure = runCli(bin, preload, temporary, ["--output", output], {
      WEIGHIN_TEST_WRITE_FAIL: "1",
      WEIGHIN_TEST_TEMP_LOG: tempLog,
    });
    assert.ifError(writeFailure.error);
    assert.equal(writeFailure.status, 1);
    assert.match(writeFailure.stderr, /Failed to write CLI results to/);
    assert.match(writeFailure.stderr, new RegExp(path.basename(output)));
    assert.match(writeFailure.stderr, /ENOSPC/);
    assert.match(writeFailure.stderr, /^((?!Done\. Results written).)*$/s);

    const renameFailure = runCli(
      bin,
      preload,
      temporary,
      ["--output", output],
      {
        WEIGHIN_TEST_RENAME_FAIL: "1",
        WEIGHIN_TEST_TEMP_LOG: tempLog,
      },
    );
    assert.ifError(renameFailure.error);
    assert.equal(renameFailure.status, 1);
    assert.match(renameFailure.stderr, /Failed to write CLI results to/);
    assert.match(renameFailure.stderr, /EXDEV/);

    assert.equal(fs.readFileSync(output, "utf8"), previous);
    assert.equal(
      fs.readFileSync(foreignTemporary, "utf8"),
      "another run's temporary file",
    );
    assert.deepEqual(temporaryFiles(temporary), [
      path.basename(foreignTemporary),
    ]);

    const [writeTemporary, renameTemporary] = loggedTemporaryFiles(tempLog);
    assert.ok(writeTemporary, "write failure should create an owned temporary");
    assert.ok(
      renameTemporary,
      "rename failure should create an owned temporary",
    );
    assert.notEqual(writeTemporary, renameTemporary);
    assert.equal(path.dirname(writeTemporary), temporary);
    assert.equal(path.dirname(renameTemporary), temporary);
    assert.equal(fs.existsSync(writeTemporary), false);
    assert.equal(fs.existsSync(renameTemporary), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
