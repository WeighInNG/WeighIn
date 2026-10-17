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
test("empty fixture suites and contracts are rejected; zero argument invocations and structured map/vec payloads remain valid", () => {
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
  const withPayloads = parseFixtures(
    JSON.stringify({
      id: "suite",
      contracts: [
        {
          id: "c",
          wasm_path: "contract.wasm",
          invocations: [
            {
              id: "call",
              function_name: "hello",
              args: [
                { type: "vec", value: [{ type: "symbol", value: "ok" }] },
                {
                  type: "map",
                  value: [
                    {
                      key: { type: "symbol", value: "k" },
                      value: { type: "u32", value: 1 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    "fixtures.json",
  );
  assert.equal(withPayloads.contracts[0].invocations[0].args.length, 2);
});

test("unknown fixture declaration fields reject before contract build, funding, deployment, or simulation", async () => {
  const exec = require("@actions/exec");
  const { buildContracts } = require("../dist/build");
  const { runMeasurement } = require("../dist/measurement");
  const invalidByLevel = [
    [
      "root",
      {
        suite_id: "bad-root",
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [{ function_name: "hello", args: [] }],
          },
        ],
      },
      /suite_id/,
    ],
    [
      "contract",
      {
        contracts: [
          {
            contract_id: "bad-contract",
            wasm_path: "contract.wasm",
            invocations: [{ function_name: "hello", args: [] }],
          },
        ],
      },
      /contracts\.0\.contract_id/,
    ],
    [
      "invocation",
      {
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              { case_id: "bad-case", function_name: "hello", args: [] },
            ],
          },
        ],
      },
      /contracts\.0\.invocations\.0\.case_id/,
    ],
    [
      "arg",
      {
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              {
                function_name: "hello",
                args: [{ type: "symbol", value: "world", extra: true }],
              },
            ],
          },
        ],
      },
      /contracts\.0\.invocations\.0\.args\.0\.extra/,
    ],
  ];

  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-strict-fixtures-"),
  );
  const originalExec = exec.exec;
  const originalFetch = globalThis.fetch;
  try {
    for (const [level, spec, expectedPath] of invalidByLevel) {
      const fixtureFile = path.join(temporary, `${level}-fixtures.json`);
      const keyFile = path.join(temporary, `${level}.key`);
      fs.writeFileSync(fixtureFile, JSON.stringify(spec));

      const execCalls = [];
      const fetchCalls = [];
      exec.exec = async (...args) => {
        execCalls.push(args);
        throw new Error("unexpected exec side effect");
      };
      globalThis.fetch = async (...args) => {
        fetchCalls.push(args);
        throw new Error("unexpected network side effect");
      };

      await assert.rejects(buildContracts(fixtureFile, "1.95.0"), (error) => {
        assert.match(error.message, /Invalid fixture declaration/);
        assert.match(error.message, expectedPath);
        return true;
      });
      assert.equal(
        execCalls.length,
        0,
        `buildContracts must not run commands for invalid ${level} fixture`,
      );

      await assert.rejects(
        runMeasurement({
          fixturesPath: fixtureFile,
          fixtureId: `configs/${level}-fixtures.json`,
          gitCommit: "deadbeef",
          sdkVersion: "28.0.0",
          rpcUrl: "http://127.0.0.1:1/rpc",
          keyFile,
        }),
        (error) => {
          assert.match(error.message, /Invalid fixture declaration/);
          assert.match(error.message, expectedPath);
          return true;
        },
      );
      assert.equal(
        fetchCalls.length,
        0,
        `runMeasurement must not contact RPC/Friendbot for invalid ${level} fixture`,
      );
      assert.equal(
        fs.existsSync(keyFile),
        false,
        `runMeasurement must not create deployer key for invalid ${level} fixture`,
      );
    }
  } finally {
    exec.exec = originalExec;
    globalThis.fetch = originalFetch;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function action(mode, config = policy, tmpRoot = null) {
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
        const fixtureObject =
          name === "head" && mode === "unknown-head-fixture-field"
            ? {
                contracts: [
                  {
                    contract_id: "typo",
                    wasm_path: "contract/contract.wasm",
                    invocations: [{ function_name: "hello", args: [] }],
                  },
                ],
              }
            : name === "base" && mode === "unknown-base-fixture-field"
              ? {
                  contracts: [
                    {
                      wasm_path: "contract/contract.wasm",
                      invocations: [
                        {
                          case_id: "typo",
                          function_name: "hello",
                          args: [],
                        },
                      ],
                    },
                  ],
                }
              : {
                  contracts:
                    name === "base" && mode === "empty-fixtures"
                      ? []
                      : [
                          {
                            wasm_path: "contract/contract.wasm",
                            invocations: [{ function_name: "hello", args: [] }],
                          },
                        ],
                };
        fs.writeFileSync(
          path.join(directory, "fixtures.json"),
          name === "base" && mode === "malformed-fixtures"
            ? "{broken"
            : JSON.stringify(fixtureObject),
        );
      }
    }
    if (config !== null)
      fs.writeFileSync(path.join(temporary, "head/weighin.toml"), config);
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
          "INPUT_FIXTURES-PATH": "fixtures.json",
          "INPUT_CONFIG-PATH": "weighin.toml",
          "INPUT_GITHUB-TOKEN": "",
          "INPUT_BASE-REF": "main",
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
    return {
      ...processResult,
      output: fs.readFileSync(output, "utf8"),
      summary: fs.readFileSync(summary, "utf8"),
      missingConfig: loadConfig(path.join(temporary, "missing.toml")),
      keyPaths,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
for (const [mode, message] of [
  ["funding-exhausted", /Account readiness failed within 120s/],
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
  [
    "unknown-head-fixture-field",
    /HEAD measurement failed:[\s\S]*contracts\.0\.contract_id/,
  ],
  [
    "unknown-base-fixture-field",
    /Required BASE comparison failed:[\s\S]*contracts\.0\.invocations\.0\.case_id/,
  ],
])
  test(`Action exits 1 and reports failure for ${mode}`, () => {
    const result = action(mode);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.output, /fail/);
    assert.doesNotMatch(result.output, /no-baseline|pass/);
    assert.match(result.summary, message);
    assert.match(result.summary, /No passing comparison/);
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
