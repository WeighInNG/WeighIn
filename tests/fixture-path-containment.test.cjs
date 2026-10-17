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

function action(mode, config = policy, tmpRoot = null, options = {}) {
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
        const fixturePayload = {
          ...(options.explicitId ? { id: options.explicitId } : {}),
          contracts:
            name === "base" && mode === "empty-fixtures"
              ? []
              : [
                  {
                    ...(options.explicitContractId
                      ? { id: options.explicitContractId }
                      : {}),
                    wasm_path: options.wasmPath ?? "contract/contract.wasm",
                    invocations: [{ function_name: "hello", args: [] }],
                  },
                ],
        };
        const targetRel = options.writeFixturesRel ?? "fixtures.json";
        const targetFile = path.join(directory, targetRel);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(
          targetFile,
          name === "base" && mode === "malformed-fixtures"
            ? "{broken"
            : JSON.stringify(fixturePayload),
        );
      }
    }
    if (options.setup) {
      options.setup(temporary);
    }
    if (config !== null)
      fs.writeFileSync(path.join(temporary, "head/weighin.toml"), config);
    const output = path.join(temporary, "outputs"),
      summary = path.join(temporary, "summary");
    fs.writeFileSync(output, "");
    fs.writeFileSync(summary, "");
    const fixturesInput =
      typeof options.fixturesPath === "function"
        ? options.fixturesPath(temporary)
        : (options.fixturesPath ?? "fixtures.json");
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
          "INPUT_FIXTURES-PATH": fixturesInput,
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
    const buildFile = path.join(keyLogDir, "builds.jsonl");
    const builds = fs.existsSync(buildFile)
      ? fs
          .readFileSync(buildFile, "utf8")
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
      builds,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test("Action rejects absolute and escaping fixtures-path inputs before build or measurement, even with explicit fixture IDs", () => {
  for (const explicitId of [undefined, "explicit-suite"]) {
    for (const fixturesPath of [
      (tmp) => path.join(tmp, "head", "fixtures.json"),
      () => "/tmp/outside-fixtures.json",
      () => "../head/fixtures.json",
      () => "nested/../../outside-fixtures.json",
      () => ".",
    ]) {
      const result = action("control", policy, null, {
        explicitId,
        explicitContractId: explicitId ? "explicit-contract" : undefined,
        fixturesPath,
        setup: (tmp) => {
          fs.writeFileSync(
            path.join(tmp, "outside-fixtures.json"),
            JSON.stringify({
              ...(explicitId ? { id: explicitId } : {}),
              contracts: [
                {
                  id: "explicit-contract",
                  wasm_path: "contract/contract.wasm",
                  invocations: [{ function_name: "hello", args: [] }],
                },
              ],
            }),
          );
        },
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.output, /fail/);
      assert.match(result.summary, /Invalid fixtures-path/);
      assert.equal(
        result.builds.length,
        0,
        "must not build when fixtures-path is outside HEAD",
      );
      assert.equal(
        result.keyPaths.length,
        0,
        "must not measure when fixtures-path is outside HEAD",
      );
    }
  }
});
test("Action rejects existing symlink escapes in HEAD and BASE worktrees without reusing HEAD fixtures for BASE", () => {
  function tryFileSymlink(target, linkPath) {
    try {
      fs.symlinkSync(target, linkPath);
      return true;
    } catch (err) {
      if (err && err.code === "EPERM" && process.platform === "win32") {
        return false;
      }
      throw err;
    }
  }

  for (const explicitId of [undefined, "explicit-suite"]) {
    let headFileLinked = true;
    const headFileEscape = action("control", policy, null, {
      explicitId,
      setup: (tmp) => {
        const outside = path.join(tmp, "outside.json");
        fs.writeFileSync(
          outside,
          fs.readFileSync(path.join(tmp, "head/fixtures.json")),
        );
        fs.rmSync(path.join(tmp, "head/fixtures.json"));
        headFileLinked = tryFileSymlink(
          outside,
          path.join(tmp, "head/fixtures.json"),
        );
      },
    });
    if (headFileLinked) {
      assert.equal(headFileEscape.status, 1);
      assert.match(
        headFileEscape.summary,
        /Invalid fixtures-path[\s\S]*symlink escapes HEAD/,
      );
      assert.equal(headFileEscape.builds.length, 0);
      assert.equal(headFileEscape.keyPaths.length, 0);
    }

    const headDirEscape = action("control", policy, null, {
      explicitId,
      fixturesPath: "linked/fixtures.json",
      setup: (tmp) => {
        const outsideDir = path.join(tmp, "outside-dir");
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.writeFileSync(
          path.join(outsideDir, "fixtures.json"),
          fs.readFileSync(path.join(tmp, "head/fixtures.json")),
        );
        fs.symlinkSync(
          outsideDir,
          path.join(tmp, "head/linked"),
          process.platform === "win32" ? "junction" : "dir",
        );
      },
    });
    assert.equal(headDirEscape.status, 1);
    assert.match(
      headDirEscape.summary,
      /Invalid fixtures-path[\s\S]*symlink escapes HEAD/,
    );
    assert.equal(headDirEscape.builds.length, 0);
    assert.equal(headDirEscape.keyPaths.length, 0);

    let baseFileLinked = true;
    const baseFileEscapeToHead = action("control", policy, null, {
      explicitId,
      setup: (tmp) => {
        const headFixtures = path.join(tmp, "head/fixtures.json");
        fs.rmSync(path.join(tmp, "base/fixtures.json"));
        baseFileLinked = tryFileSymlink(
          headFixtures,
          path.join(tmp, "base/fixtures.json"),
        );
      },
    });
    if (baseFileLinked) {
      assert.equal(baseFileEscapeToHead.status, 1);
      assert.match(
        baseFileEscapeToHead.summary,
        /Required BASE comparison failed: Invalid fixtures-path[\s\S]*symlink escapes base/,
      );
      assert.equal(baseFileEscapeToHead.builds.length, 1);
      assert.equal(baseFileEscapeToHead.keyPaths.length, 1);
    }

    const baseDirEscapeToHead = action("control", policy, null, {
      explicitId,
      writeFixturesRel: "linked/fixtures.json",
      wasmPath: "../contract/contract.wasm",
      fixturesPath: "linked/fixtures.json",
      setup: (tmp) => {
        fs.rmSync(path.join(tmp, "base/linked"), {
          recursive: true,
          force: true,
        });
        fs.symlinkSync(
          path.join(tmp, "head/linked"),
          path.join(tmp, "base/linked"),
          process.platform === "win32" ? "junction" : "dir",
        );
      },
    });
    assert.equal(baseDirEscapeToHead.status, 1);
    assert.match(
      baseDirEscapeToHead.summary,
      /Required BASE comparison failed: Invalid fixtures-path[\s\S]*symlink escapes base/,
    );
    assert.equal(
      baseDirEscapeToHead.builds.length,
      1,
      "HEAD builds once, but BASE must not build when its fixture symlink escapes",
    );
    assert.equal(
      baseDirEscapeToHead.keyPaths.length,
      1,
      "HEAD measures once, but BASE must not measure or reuse HEAD fixtures",
    );
  }
});
test("Action allows normalized relative and nested fixture paths within each revision while preserving library absolute-path API", async () => {
  const nested = action("control", policy, null, {
    writeFixturesRel: "benchmarks/soroban/fixtures.json",
    wasmPath: "../../contract/contract.wasm",
    fixturesPath: "./benchmarks/./soroban/../soroban/fixtures.json",
  });
  assert.equal(nested.status, 0, nested.stdout + nested.stderr);
  assert.equal(nested.keyPaths.length, 2);
  assert.equal(
    nested.keyPaths[0].fixtureId,
    "benchmarks/soroban/fixtures.json",
  );
  assert.equal(
    nested.keyPaths[1].fixtureId,
    "benchmarks/soroban/fixtures.json",
  );
  assert.notEqual(
    nested.keyPaths[0].fixturesPath,
    nested.keyPaths[1].fixturesPath,
  );

  // Library API continues to accept absolute fixturesPath directly
  const { buildContracts } = require("../dist/build");
  const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-lib-abs-"));
  try {
    const absFixtures = path.join(tmpLib, "fixtures.json");
    fs.writeFileSync(absFixtures, '{"contracts":[]}');
    await assert.rejects(
      buildContracts(absFixtures, "1.95.0"),
      /contracts/,
    );
  } finally {
    fs.rmSync(tmpLib, { recursive: true, force: true });
  }
});
