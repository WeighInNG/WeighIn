const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const actionEntries = [
  {
    name: "bundled",
    file: path.resolve(__dirname, "../bundled/index.js"),
    useHook: false,
  },
  {
    name: "compiled",
    file: path.resolve(__dirname, "../dist/action.js"),
    useHook: true,
  },
];

function runActionWithBaseRef({
  entryFile,
  useHook = false,
  baseRefInput = null,
  fixturesPath = "fixtures.json",
  rpcUrl = "http://localhost:9999/unreachable-rpc",
}) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-base-ref-test-"),
  );
  const headDir = path.join(temporary, "head");
  fs.mkdirSync(headDir, { recursive: true });

  const fixturesFile = path.join(headDir, fixturesPath);
  fs.writeFileSync(
    fixturesFile,
    JSON.stringify({
      contracts: [
        {
          wasm_path: "contract.wasm",
          invocations: [{ function_name: "hello", args: [] }],
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(headDir, "contract.wasm"),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  );

  const outputFile = path.join(temporary, "output");
  const summaryFile = path.join(temporary, "summary");
  fs.writeFileSync(outputFile, "");
  fs.writeFileSync(summaryFile, "");

  const env = {
    ...process.env,
    TMPDIR: temporary,
    GITHUB_WORKSPACE: headDir,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    "INPUT_FIXTURES-PATH": fixturesPath,
    "INPUT_RPC-URL": rpcUrl,
    "INPUT_CONFIG-PATH": "",
    "INPUT_GITHUB-TOKEN": "",
    "INPUT_BUILD-COMMAND": "",
    "INPUT_SKIP-BUILD": "false",
  };

  if (baseRefInput !== null) {
    env["INPUT_BASE-REF"] = baseRefInput;
  } else {
    delete env["INPUT_BASE-REF"];
  }

  const args = [];
  if (useHook) {
    args.push(
      "--require",
      path.resolve(__dirname, "support/action-unit-hook.cjs"),
    );
    env.WEIGHIN_UNIT_MODE = "control";
    env.WEIGHIN_UNIT_BASE = path.join(temporary, "base");
    fs.mkdirSync(env.WEIGHIN_UNIT_BASE, { recursive: true });
    fs.writeFileSync(
      path.join(env.WEIGHIN_UNIT_BASE, fixturesPath),
      fs.readFileSync(fixturesFile),
    );
  }
  args.push(entryFile);

  try {
    const proc = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 10000,
      env,
    });

    const outputContent = fs.existsSync(outputFile)
      ? fs.readFileSync(outputFile, "utf8")
      : "";
    const summaryContent = fs.existsSync(summaryFile)
      ? fs.readFileSync(summaryFile, "utf8")
      : "";

    // Check if any deployer key directories were created in temporary TMPDIR
    const createdKeyDirs = fs
      .readdirSync(temporary)
      .filter((name) => name.startsWith("weighin-key-"));

    return {
      status: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
      output: outputContent,
      summary: summaryContent,
      keyDirs: createdKeyDirs,
      combinedOutput: `${proc.stdout}\n${proc.stderr}\n${outputContent}`,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

for (const entry of actionEntries) {
  test(`${entry.name} Action rejects empty-whitespace base-ref early with zero side effects`, () => {
    for (const val of ["   ", "\t", "\n", " \t \n "]) {
      const res = runActionWithBaseRef({
        entryFile: entry.file,
        useHook: entry.useHook,
        baseRefInput: val,
      });

      assert.equal(
        res.status,
        1,
        `Expected status 1 for whitespace value "${val}"`,
      );
      assert.match(
        res.combinedOutput,
        /Invalid base-ref: ref cannot be empty or whitespace/,
      );
      assert.match(res.output, /result<<[^\n]*[\r\n]+fail/);
      assert.match(res.output, /diff-json<<[^\n]*[\r\n]+\{\}/);
      assert.equal(
        res.keyDirs.length,
        0,
        `Expected no key directories created for rejected input, found: ${res.keyDirs.join(", ")}`,
      );
    }
  });

  test(`${entry.name} Action rejects option-like base-ref early before invoking Git`, () => {
    for (const val of [
      "--upload-pack=exploit",
      "-o",
      "--",
      "-b",
      "--depth=2",
    ]) {
      const res = runActionWithBaseRef({
        entryFile: entry.file,
        useHook: entry.useHook,
        baseRefInput: val,
      });

      assert.equal(
        res.status,
        1,
        `Expected status 1 for option-like value "${val}"`,
      );
      assert.match(
        res.combinedOutput,
        /Invalid base-ref: option-like refs are not permitted/,
      );
      assert.match(res.output, /result<<[^\n]*[\r\n]+fail/);
      assert.match(res.output, /diff-json<<[^\n]*[\r\n]+\{\}/);
      assert.equal(
        res.keyDirs.length,
        0,
        `Expected no key directories created for rejected input, found: ${res.keyDirs.join(", ")}`,
      );
    }
  });

  test(`${entry.name} Action rejects malformed base-ref syntax early before HEAD work`, () => {
    for (const val of [
      "main branch",
      "main\tbranch",
      "HEAD~1",
      "HEAD^2",
      "refs:heads",
      "refs/heads/?",
      "refs/heads/*",
      "refs\\heads\\main",
      "main..feature",
      "main//feature",
      "/main",
      "main/",
      "main.",
      "main.lock",
      "feat/.hidden",
      "main@{1}",
      "@",
    ]) {
      const res = runActionWithBaseRef({
        entryFile: entry.file,
        useHook: entry.useHook,
        baseRefInput: val,
      });

      assert.equal(
        res.status,
        1,
        `Expected status 1 for malformed value "${val}"`,
      );
      assert.match(res.combinedOutput, /Invalid base-ref:/);
      assert.match(res.output, /result<<[^\n]*[\r\n]+fail/);
      assert.match(res.output, /diff-json<<[^\n]*[\r\n]+\{\}/);
      assert.equal(
        res.keyDirs.length,
        0,
        `Expected no key directories created for rejected input "${val}", found: ${res.keyDirs.join(", ")}`,
      );
    }
  });

  test(`${entry.name} Action accepts valid branch/tag/SHA base-ref without ref rejection`, () => {
    for (const validRef of [
      "main",
      "master",
      "feat/feature-112",
      "v1.0.0",
      "refs/heads/main",
      "refs/tags/v2.0",
      "80d446f58cd4c1946ae7fbf68ff9e5477e1d0aeb",
      "c3de51f",
    ]) {
      const res = runActionWithBaseRef({
        entryFile: entry.file,
        useHook: entry.useHook,
        baseRefInput: validRef,
      });

      // Should NOT reject on base-ref validation
      assert.doesNotMatch(
        res.combinedOutput,
        /Invalid base-ref:/,
        `Should not reject valid ref "${validRef}"`,
      );
    }
  });

  test(`${entry.name} Action accepts omitted base-ref and defaults without ref rejection`, () => {
    const resOmitted = runActionWithBaseRef({
      entryFile: entry.file,
      useHook: entry.useHook,
      baseRefInput: null,
    });

    assert.doesNotMatch(resOmitted.combinedOutput, /Invalid base-ref:/);

    const resEmpty = runActionWithBaseRef({
      entryFile: entry.file,
      useHook: entry.useHook,
      baseRefInput: "",
    });

    assert.doesNotMatch(resEmpty.combinedOutput, /Invalid base-ref:/);
  });
}
