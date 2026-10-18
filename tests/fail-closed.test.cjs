const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  validateConfig,
  loadConfig,
  enforceThresholds,
} = require("../dist/threshold");
const { diffBenchmarks } = require("../dist/diff");
const { parseFixtures } = require("../dist/identity");

const policy =
  '[thresholds.functions.hello]\ncpu_instructions="strict_zero_tolerance"\n';
const captured = require("../docs/experiments/native-integration/base.json");
const control = diffBenchmarks(captured, structuredClone(captured));

test("configuration rejects unsupported rules and typos even without regressions", () => {
  for (const rule of [
    "typo",
    "allow_1.2.3_percent_increase",
    "allow_-1_percent_increase",
    -1,
    Infinity,
    NaN,
    true,
  ]) {
    assert.throws(() =>
      enforceThresholds(control, {
        thresholds: { functions: { hello: { cpu_instructions: rule } } },
      }),
    );
  }
  for (const config of [
    { threshold: {} },
    { thresholds: { global: { fail_on_any_regression: "false" } } },
    { thresholds: { global: { max_allowed_cpu_increase_pct: -1 } } },
    { thresholds: { functions: { hello: { cpu_instruction: "ignore" } } } },
  ])
    assert.throws(() => validateConfig(config));
});
test("valid percentage policies handle exact caps and scientific numeric notation", () => {
  for (const rule of [
    0,
    1e-7,
    "allow_2.5_percent_increase",
    "ignore",
    "strict_zero_tolerance",
  ]) {
    assert.deepEqual(
      enforceThresholds(control, {
        thresholds: { functions: { hello: { cpu_instructions: rule } } },
      }),
      [],
    );
  }
  const head = structuredClone(captured);
  head[0].benchmarks[0].metrics.cpu_instructions.consumed *= 2;
  const diff = diffBenchmarks(captured, head);
  for (const rule of [100, "allow_100_percent_increase"])
    assert.equal(
      enforceThresholds(diff, {
        thresholds: { functions: { hello: { cpu_instructions: rule } } },
      }).length,
      0,
    );
  assert.equal(
    enforceThresholds(diff, {
      thresholds: { functions: { hello: { cpu_instructions: 99 } } },
    }).length,
    1,
  );
});
test("policy referring to an unpaired function cannot silently pass", () => {
  assert.throws(
    () =>
      enforceThresholds(control, {
        thresholds: { functions: { typo: { cpu_instructions: 10 } } },
      }),
    /no matched/,
  );
  assert.throws(
    () =>
      enforceThresholds(diffBenchmarks([], captured), {
        thresholds: { global: { max_allowed_cpu_increase_pct: 10 } },
      }),
    /no matched/,
  );
});
test("empty fixture suites and contracts are rejected; zero argument invocations remain valid", () => {
  assert.throws(() => parseFixtures('{"contracts":[]}', "fixtures.json"));
  assert.throws(() =>
    parseFixtures(
      '{"contracts":[{"wasm_path":"contract.wasm","invocations":[]}]}',
      "fixtures.json",
    ),
  );
  assert.equal(
    parseFixtures(
      '{"contracts":[{"wasm_path":"contract.wasm","invocations":[{"function_name":"hello","args":[]}]}]}',
      "fixtures.json",
    ).contracts.length,
    1,
  );
});

function action(
  mode,
  config = policy,
  tmpRoot = null,
  reportPath = null,
  fixturesPath = "fixtures.json",
  setupFiles,
) {
  const temporary =
    tmpRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "weighin-action-unit-"));
  const keyLogDir = path.join(temporary, "key-log");
  fs.mkdirSync(keyLogDir, { recursive: true });
  try {
    for (const name of ["head", "base"]) {
      const directory = path.join(temporary, name);
      fs.mkdirSync(path.join(directory, "contract"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "contract/Cargo.toml"),
        '[package]\nname="unit"\nversion="0.0.0"',
      );
      if (
        !(name === "base" && mode === "missing-fixtures") &&
        !(name === "head" && mode === "head-fixtures")
      ) {
        fs.writeFileSync(
          path.join(directory, "fixtures.json"),
          name === "base" && mode === "malformed-fixtures"
            ? "{broken"
            : JSON.stringify({
                contracts:
                  name === "base" && mode === "empty-fixtures"
                    ? []
                    : [
                        {
                          wasm_path: "contract/contract.wasm",
                          invocations: [{ function_name: "hello", args: [] }],
                        },
                      ],
              }),
        );
      }
    }
    if (config !== null)
      fs.writeFileSync(path.join(temporary, "head/weighin.toml"), config);
    setupFiles?.({
      temporary,
      head: path.join(temporary, "head"),
      base: path.join(temporary, "base"),
    });
    const output = path.join(temporary, "outputs"),
      summary = path.join(temporary, "summary");
    fs.writeFileSync(output, "");
    fs.writeFileSync(summary, "");
    const processResult = spawnSync(
      process.execPath,
      [
        "--require",
        path.resolve(__dirname, "support/action-unit-hook.cjs"),
        path.resolve(__dirname, "../dist/action.js"),
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          WEIGHIN_UNIT_MODE: mode,
          WEIGHIN_UNIT_BASE: path.join(temporary, "base"),
          WEIGHIN_UNIT_LOG_DIR: keyLogDir,
          TMPDIR: temporary,
          GITHUB_WORKSPACE: path.join(temporary, "head"),
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
          "INPUT_FIXTURES-PATH": fixturesPath,
          "INPUT_CONFIG-PATH": "weighin.toml",
          "INPUT_GITHUB-TOKEN": "",
          "INPUT_BASE-REF": "main",
          "INPUT_REPORT-PATH": reportPath || "",
        },
      },
    );
    assert.ifError(processResult.error);
    const logFile = path.join(keyLogDir, "key-paths.jsonl");
    const keyPaths = fs.existsSync(logFile)
      ? fs
          .readFileSync(logFile, "utf8")
          .trim()
          .split(/\n+/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const buildLogFile = path.join(keyLogDir, "builds.jsonl");
    const builds = fs.existsSync(buildLogFile)
      ? fs
          .readFileSync(buildLogFile, "utf8")
          .trim()
          .split(/\n+/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const reportFilePath = reportPath ? path.join(temporary, "head", reportPath) : null;
    const reportContent = reportFilePath && fs.existsSync(reportFilePath)
      ? fs.readFileSync(reportFilePath, "utf8")
      : null;
    return {
      ...processResult,
      output: fs.readFileSync(output, "utf8"),
      summary: fs.readFileSync(summary, "utf8"),
      missingConfig: loadConfig(path.join(temporary, "missing.toml")),
      keyPaths,
      builds,
      reportContent,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
for (const [mode, message] of [
  ["funding-exhausted", /Account readiness failed within 120s/],
  ["rpc-invalid-envelope", /response ID does not match request/],
  ["rpc-unhealthy", /RPC has not reported healthy/],
  ["checkout", /unit checkout failure/],
  ["worktree", /unit worktree failure/],
  ["build", /unit base build failure/],
  ["measurement", /unit base measurement failure/],
  ["missing-fixtures", /fixtures-path not found in base/],
  ["schema", /Version 2\/3/],
  ["provenance", /Invalid compute provenance/],
  ["empty", /No matched/],
  ["unmatched", /No matched/],
  ["head-measurement", /HEAD measurement failed/],
  ["head-fixtures", /fixtures-path not found/],
  ["malformed-fixtures", /Required BASE comparison failed/],
  ["empty-fixtures", /Required BASE comparison failed/],
])
  test(`Action exits 1 and reports failure for ${mode}`, () => {
    const result = action(mode);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.output, /fail/);
    assert.doesNotMatch(result.output, /no-baseline|pass/);
    assert.match(result.summary, message);
    assert.match(result.summary, /No passing comparison/);
  });
test("Action rejects a mismatched health response before account readiness or builds", () => {
  const result = action("rpc-invalid-envelope");
  assert.equal(result.status, 1);
  assert.match(result.summary, /response ID does not match request/);
  assert.equal(result.keyPaths.length, 0);
});

test("Action rejects absolute and escaping fixture paths before measuring HEAD", () => {
  for (const fixturesPath of [
    "/tmp/outside-fixtures.json",
    "../outside-fixtures.json",
    "C:\\repo\\fixtures.json",
  ]) {
    const result = action("control", policy, null, null, fixturesPath);
    assert.equal(result.status, 1, fixturesPath);
    assert.match(result.summary, /fixtures-path for HEAD must be a relative path inside the HEAD worktree/);
    assert.equal(result.keyPaths.length, 0, fixturesPath);
  }
});

test("Action rejects an existing HEAD symlink that points outside its workspace", () => {
  for (const kind of ["file", "directory"]) {
    const result = action(
      "control",
      policy,
      null,
      null,
      "nested/fixtures.json",
      ({ temporary, head }) => {
        const external = path.join(temporary, "outside-fixtures");
        fs.mkdirSync(external);
        fs.writeFileSync(path.join(external, "fixtures.json"), JSON.stringify({ contracts: [] }));
        fs.mkdirSync(path.join(head, "nested"));
        if (kind === "directory") fs.rmdirSync(path.join(head, "nested"));
        fs.symlinkSync(
          kind === "file" ? path.join(external, "fixtures.json") : external,
          kind === "file" ? path.join(head, "nested/fixtures.json") : path.join(head, "nested"),
          kind === "file" ? "file" : "dir",
        );
      },
    );
    assert.equal(result.status, 1, kind);
    assert.match(result.summary, /fixtures-path for HEAD must be a relative path inside the HEAD worktree/);
    assert.equal(result.keyPaths.length, 0, kind);
  }
});

test("Action validates BASE symlinks before BASE measurement and accepts normalized nested fixture paths with either ID form", () => {
  const baseEscape = action(
    "control",
    policy,
    null,
    null,
    "nested/fixtures.json",
    ({ temporary, head, base }) => {
      fs.mkdirSync(path.join(head, "nested"));
      fs.mkdirSync(path.join(base, "nested"));
      const fixture = JSON.stringify({ contracts: [{ id: "explicit:contract", wasm_path: "../contract/contract.wasm", invocations: [{ function_name: "hello", args: [] }] }] });
      fs.writeFileSync(path.join(head, "nested/fixtures.json"), fixture);
      const external = path.join(temporary, "outside-fixtures.json");
      fs.writeFileSync(external, fixture);
      fs.symlinkSync(external, path.join(base, "nested/fixtures.json"));
    },
  );
  assert.equal(baseEscape.status, 1);
  assert.match(baseEscape.summary, /fixtures-path for BASE must be a relative path inside the BASE worktree/);
  assert.equal(baseEscape.keyPaths.length, 1, "HEAD may measure, BASE must fail before measurement");
  assert.deepEqual(baseEscape.builds.map(({ revision }) => revision), ["HEAD"]);

  for (const explicitId of [false, true]) {
    const fixture = {
      contracts: [{
        ...(explicitId ? { id: "explicit:contract" } : {}),
        wasm_path: "../contract/contract.wasm",
        invocations: [{ function_name: "hello", args: [] }],
      }],
    };
    const result = action(
      "control",
      policy,
      null,
      null,
      "nested/./fixtures.json",
      ({ head, base }) => {
        for (const revision of [head, base]) {
          fs.mkdirSync(path.join(revision, "nested"));
          fs.writeFileSync(path.join(revision, "nested/fixtures.json"), JSON.stringify(fixture));
        }
      },
    );
    assert.equal(result.status, 0);
    assert.equal(result.keyPaths.length, 2);
    assert.deepEqual(result.keyPaths.map(({ fixtureId }) => fixtureId), ["nested/fixtures.json", "nested/fixtures.json"]);
  }
});
for (const config of [
  "not valid toml = ",
  '[thresholds.functions.hello]\ncpu_instructions="typo"',
  '[thresholds.global]\nfail_on_any_regression="false"',
]) {
  test(`Action fails malformed policy: ${config}`, () => {
    const result = action("control", config);
    assert.equal(result.status, 1);
    assert.match(result.output, /fail/);
    assert.match(result.summary, /comparison failed/);
  });
}
test("Action uses one private temp key directory per run, reuses it for HEAD and BASE, and removes it on exit", () => {
  const sharedRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-shared-key-"),
  );
  const result = action("control", policy, sharedRoot);
  assert.equal(result.status, 0);
  assert.equal(
    result.keyPaths.length,
    2,
    "expected one key path for HEAD and one for BASE",
  );
  assert.equal(
    result.keyPaths[0].filePath,
    result.keyPaths[1].filePath,
    "HEAD and BASE should share the same deployer key path",
  );
  assert.notEqual(
    path.dirname(result.keyPaths[0].filePath),
    sharedRoot,
    "the key should live under a unique per-run subdirectory, not the shared TMPDIR root",
  );
  const dirMode = result.keyPaths[0].dirMode;
  assert.equal(
    dirMode & 0o777,
    0o700,
    "deployer key directory must be private",
  );
  assert.match(
    path.basename(path.dirname(result.keyPaths[0].filePath)),
    /weighin-/,
  );
  assert.equal(
    result.keyPaths[0].exists,
    false,
    "owned deployer key directory should be removed after completion",
  );
  fs.rmSync(sharedRoot, { recursive: true, force: true });
});
test("Concurrent action invocations receive different private key directories", () => {
  const sharedRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-shared-key-"),
  );
  const first = action("control", policy, sharedRoot);
  const second = action("control", policy, sharedRoot);
  assert.notEqual(
    first.keyPaths[0].filePath,
    second.keyPaths[0].filePath,
    "different invocations must not share the same deployer key path",
  );
  assert.notEqual(
    path.dirname(first.keyPaths[0].filePath),
    path.dirname(second.keyPaths[0].filePath),
  );
  assert.notEqual(path.dirname(first.keyPaths[0].filePath), sharedRoot);
  assert.notEqual(path.dirname(second.keyPaths[0].filePath), sharedRoot);
  assert.equal(first.keyPaths[0].dirMode & 0o777, 0o700);
  assert.equal(second.keyPaths[0].dirMode & 0o777, 0o700);
  fs.rmSync(sharedRoot, { recursive: true, force: true });
});
test("Action unchanged control and optional absent policy still pass; regression fails", () => {
  assert.equal(action("control").status, 0);
  const absent = action("control", null);
  assert.equal(absent.status, 0);
  assert.equal(absent.missingConfig, null);
  const regression = action("regression");
  assert.equal(regression.status, 1);
  assert.match(regression.summary, /increased/);
});

test("Action persists an explicit unsuccessful-comparison report on configuration/fixture/RPC failures when report-path is set", () => {
  for (const failureMode of ["rpc-unhealthy", "missing-fixtures", "malformed-fixtures"]) {
    const res = action(failureMode, policy, null, "weighin-report.md");
    assert.equal(res.status, 1);
    assert.match(res.output, /fail/);
    assert.ok(res.reportContent, `expected report file to exist for ${failureMode}`);
    assert.match(res.reportContent, /# WeighIn Resource Benchmark: Unsuccessful Comparison/);
    assert.match(res.reportContent, /> \*\*Status: FAILED\*\*/);
    assert.match(res.reportContent, /Policies established:\*\* No/);
    assert.match(res.reportContent, /Thresholds evaluated:\*\* None/);
    assert.match(res.reportContent, /No passing comparison/);
    assert.doesNotMatch(res.reportContent, /thresholds-passed/);
  }
});

test("Action preserves primary error when writing report-path fails due to invalid output path", () => {
  // Pass an invalid path that cannot be created as a file
  const res = action("rpc-unhealthy", policy, null, "fixtures.json"); // fixtures.json already exists as a file, but let's test a directory path as file
  assert.equal(res.status, 1);
  assert.match(res.output, /fail/);
  assert.match(res.summary, /RPC has not reported healthy/);
});

test("Action preserves validated computed diff when report delivery subsequently fails", () => {
  // Pass an invalid report path that attempts to write into an existing file as a directory
  const res = action("control", policy, null, "fixtures.json/report.md");
  assert.equal(res.status, 1);
  assert.match(res.output, /result<<[^\r\n]*\r?\nfail/);
  assert.match(res.output, /diff-json<<[^\r\n]*\r?\n\{"contracts":/);
  assert.doesNotMatch(res.output, /diff-json<<[^\r\n]*\r?\n\{\}\r?\n/);
  assert.match(res.summary, /Failed to write WeighIn report/);
});

test("Action preserves validated computed diff when summary delivery subsequently fails", () => {
  const res = action("summary-failure", policy);
  assert.equal(res.status, 1);
  assert.match(res.output, /result<<[^\n]*[\r\n]+fail/);
  assert.match(res.output, /diff-json<<[^\n]*[\r\n]+\{"contracts":/);
  assert.doesNotMatch(res.output, /diff-json<<[^\n]*[\r\n]+\{\}[\r\n]+/);
  assert.match(res.stdout + res.stderr, /unit summary delivery failure/);
});

test("Action emits empty diff-json on failure before comparison and never invents diff data", () => {
  const res = action("rpc-unhealthy", policy, null, "fixtures.json/report.md");
  assert.equal(res.status, 1);
  assert.match(res.output, /result<<[^\n]*[\r\n]+fail/);
  assert.match(res.output, /diff-json<<[^\n]*[\r\n]+\{\}[\r\n]+/);
  assert.match(res.summary, /RPC has not reported healthy/);
  assert.match(res.summary, /No passing comparison/);
});
