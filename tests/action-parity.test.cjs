const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("yaml");

const root = path.resolve(__dirname, "..");
const {
  SUPPORTED_MAIN_ACTION_INPUTS,
  SUPPORTED_MAIN_ACTION_OUTPUTS,
  SUPPORTED_COMMENT_ACTION_INPUTS,
  SUPPORTED_COMMENT_ACTION_OUTPUTS,
  OPTIONAL_CONDITIONAL_OUTPUTS,
  MAIN_ACTION_INPUT_DEFAULTS,
} = require("../dist/action-contract");

const mainActionYml = yaml.parse(fs.readFileSync(path.join(root, "action.yml"), "utf8"));
const commentActionYml = yaml.parse(fs.readFileSync(path.join(root, "comment/action.yml"), "utf8"));

function parseGithubOutput(content) {
  const outputs = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const delimiterMatch = line.match(/^([^<]+)<<(.+)$/);
    if (delimiterMatch) {
      const key = delimiterMatch[1];
      const delimiter = delimiterMatch[2];
      const valLines = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valLines.push(lines[i]);
        i++;
      }
      outputs[key] = valLines.join("\n");
    } else {
      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        outputs[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
      }
    }
  }
  return outputs;
}

function runMainAction({
  entryFile,
  envOverrides = {},
  useHook = false,
  fixturesPath = "weighin-fixtures.json",
}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-parity-main-"));
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
  fs.writeFileSync(path.join(headDir, "contract.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));

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
    "INPUT_CONFIG-PATH": "",
    "INPUT_RPC-URL": "http://localhost:8000/rpc",
    "INPUT_GITHUB-TOKEN": "",
    "INPUT_BASE-REF": "main",
    "INPUT_SKIP-BUILD": "true",
    ...envOverrides,
  };

  for (const [key, val] of Object.entries(envOverrides)) {
    if (val === null) {
      delete env[key];
      env[key] = "";
    }
  }

  const args = [];
  if (useHook) {
    args.push("--require", path.resolve(__dirname, "support/action-unit-hook.cjs"));
    env.WEIGHIN_UNIT_MODE = "control";
    env.WEIGHIN_UNIT_BASE = path.join(temporary, "base");
    fs.mkdirSync(env.WEIGHIN_UNIT_BASE, { recursive: true });
    fs.writeFileSync(path.join(env.WEIGHIN_UNIT_BASE, fixturesPath), fs.readFileSync(fixturesFile));
    fs.writeFileSync(path.join(env.WEIGHIN_UNIT_BASE, "contract.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  }
  args.push(entryFile);

  try {
    const proc = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 10000,
      env,
    });

    const outputContent = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
    const parsedOutputs = parseGithubOutput(outputContent);
    const keyDirs = fs.readdirSync(temporary).filter((name) => name.startsWith("weighin-key-"));

    return {
      status: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
      combined: `${proc.stdout}\n${proc.stderr}\n${outputContent}`,
      outputRaw: outputContent,
      outputs: parsedOutputs,
      keyDirs,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function runCommentAction({
  entryFile,
  envOverrides = {},
}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-parity-comment-"));
  const outputFile = path.join(temporary, "output");
  fs.writeFileSync(outputFile, "");

  const reportPath = path.join(temporary, "report.md");
  const metadataPath = path.join(temporary, "metadata.json");
  fs.writeFileSync(reportPath, "# Report\n");
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({ schemaVersion: 1, repository: "WeighInNG/WeighIn", prNumber: 42, headSha: "a".repeat(40) }),
  );

  const env = {
    ...process.env,
    TMPDIR: temporary,
    GITHUB_OUTPUT: outputFile,
    "INPUT_REPORT-PATH": reportPath,
    "INPUT_METADATA-PATH": metadataPath,
    "INPUT_GITHUB-TOKEN": "test-token",
    ...envOverrides,
  };

  for (const [key, val] of Object.entries(envOverrides)) {
    if (val === null) {
      delete env[key];
    }
  }

  try {
    const proc = spawnSync(process.execPath, [entryFile], {
      encoding: "utf8",
      timeout: 10000,
      env,
    });

    const outputContent = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
    const parsedOutputs = parseGithubOutput(outputContent);

    return {
      status: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
      combined: `${proc.stdout}\n${proc.stderr}\n${outputContent}`,
      outputRaw: outputContent,
      outputs: parsedOutputs,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. Static Contract Parity Tests
// ---------------------------------------------------------------------------

test("action.yml declared inputs match runtime SUPPORTED_MAIN_ACTION_INPUTS exactly", () => {
  const declaredInputs = Object.keys(mainActionYml.inputs || {}).sort();
  const supportedInputs = [...SUPPORTED_MAIN_ACTION_INPUTS].sort();
  assert.deepEqual(
    declaredInputs,
    supportedInputs,
    `Declared inputs in action.yml do not match SUPPORTED_MAIN_ACTION_INPUTS:\n` +
      `Declared:  ${declaredInputs.join(", ")}\n` +
      `Supported: ${supportedInputs.join(", ")}`,
  );
});

test("action.yml declared outputs match runtime SUPPORTED_MAIN_ACTION_OUTPUTS exactly", () => {
  const declaredOutputs = Object.keys(mainActionYml.outputs || {}).sort();
  const supportedOutputs = [...SUPPORTED_MAIN_ACTION_OUTPUTS].sort();
  assert.deepEqual(
    declaredOutputs,
    supportedOutputs,
    `Declared outputs in action.yml do not match SUPPORTED_MAIN_ACTION_OUTPUTS:\n` +
      `Declared:  ${declaredOutputs.join(", ")}\n` +
      `Supported: ${supportedOutputs.join(", ")}`,
  );
});

test("comment/action.yml declared inputs match runtime SUPPORTED_COMMENT_ACTION_INPUTS exactly", () => {
  const declaredInputs = Object.keys(commentActionYml.inputs || {}).sort();
  const supportedInputs = [...SUPPORTED_COMMENT_ACTION_INPUTS].sort();
  assert.deepEqual(
    declaredInputs,
    supportedInputs,
    `Declared inputs in comment/action.yml do not match SUPPORTED_COMMENT_ACTION_INPUTS:\n` +
      `Declared:  ${declaredInputs.join(", ")}\n` +
      `Supported: ${supportedInputs.join(", ")}`,
  );
});

test("comment/action.yml declared outputs match runtime SUPPORTED_COMMENT_ACTION_OUTPUTS exactly", () => {
  const declaredOutputs = Object.keys(commentActionYml.outputs || {}).sort();
  const supportedOutputs = [...SUPPORTED_COMMENT_ACTION_OUTPUTS].sort();
  assert.deepEqual(
    declaredOutputs,
    supportedOutputs,
    `Declared outputs in comment/action.yml do not match SUPPORTED_COMMENT_ACTION_OUTPUTS:\n` +
      `Declared:  ${declaredOutputs.join(", ")}\n` +
      `Supported: ${supportedOutputs.join(", ")}`,
  );
});

test("source code wiring in src/action.ts reads only declared inputs and emits only declared outputs", () => {
  const actionSource = fs.readFileSync(path.join(root, "src/action.ts"), "utf8");

  // Verify core.getInput and parseOptionalBooleanInput calls
  const readInputs = new Set();
  for (const match of actionSource.matchAll(/core\.getInput\(["']([^"']+)["']/g)) {
    readInputs.add(match[1]);
  }
  for (const match of actionSource.matchAll(/parseOptionalBooleanInput\(["']([^"']+)["']/g)) {
    readInputs.add(match[1]);
  }

  for (const input of readInputs) {
    assert.ok(
      mainActionYml.inputs[input],
      `src/action.ts reads input '${input}' which is not declared in action.yml`,
    );
  }

  for (const declaredInput of Object.keys(mainActionYml.inputs)) {
    assert.ok(
      readInputs.has(declaredInput),
      `action.yml declares input '${declaredInput}' which is not read in src/action.ts`,
    );
  }

  // Verify core.setOutput calls
  const emittedOutputs = new Set();
  for (const match of actionSource.matchAll(/core\.setOutput\(["']([^"']+)["']/g)) {
    emittedOutputs.add(match[1]);
  }

  for (const output of emittedOutputs) {
    assert.ok(
      mainActionYml.outputs[output],
      `src/action.ts emits output '${output}' which is not declared in action.yml`,
    );
  }

  for (const declaredOutput of Object.keys(mainActionYml.outputs)) {
    assert.ok(
      emittedOutputs.has(declaredOutput),
      `action.yml declares output '${declaredOutput}' which is not emitted in src/action.ts`,
    );
  }
});

test("source code wiring in src/comment-action.ts reads only declared inputs and emits only declared outputs", () => {
  const commentSource = fs.readFileSync(path.join(root, "src/comment-action.ts"), "utf8");

  const readInputs = new Set();
  for (const match of commentSource.matchAll(/core\.getInput\(["']([^"']+)["']/g)) {
    readInputs.add(match[1]);
  }

  for (const input of readInputs) {
    assert.ok(
      commentActionYml.inputs[input],
      `src/comment-action.ts reads input '${input}' which is not declared in comment/action.yml`,
    );
  }

  for (const declaredInput of Object.keys(commentActionYml.inputs)) {
    assert.ok(
      readInputs.has(declaredInput),
      `comment/action.yml declares input '${declaredInput}' which is not read in src/comment-action.ts`,
    );
  }

  const emittedOutputs = new Set();
  for (const match of commentSource.matchAll(/core\.setOutput\(["']([^"']+)["']/g)) {
    emittedOutputs.add(match[1]);
  }

  assert.equal(emittedOutputs.size, 0, "comment-action.ts should not emit undeclared outputs");
});

test("reviewable exception list accounts for all declared outputs across both entry points", () => {
  assert.ok(OPTIONAL_CONDITIONAL_OUTPUTS, "OPTIONAL_CONDITIONAL_OUTPUTS must be defined");
  assert.ok(Array.isArray(OPTIONAL_CONDITIONAL_OUTPUTS.main), "OPTIONAL_CONDITIONAL_OUTPUTS.main must be an array");
  assert.ok(Array.isArray(OPTIONAL_CONDITIONAL_OUTPUTS.comment), "OPTIONAL_CONDITIONAL_OUTPUTS.comment must be an array");

  // Every conditional rule must document name, condition, and description
  for (const rule of [...OPTIONAL_CONDITIONAL_OUTPUTS.main, ...OPTIONAL_CONDITIONAL_OUTPUTS.comment]) {
    assert.ok(rule.name, "Conditional output rule must have a name");
    assert.ok(rule.condition, "Conditional output rule must specify condition");
    assert.ok(rule.description, "Conditional output rule must have a description");
  }

  // All declared outputs not in the exception list are mandatory/unconditional on every run
  const conditionalMain = new Set(OPTIONAL_CONDITIONAL_OUTPUTS.main.map((r) => r.name));
  const unconditionalMain = SUPPORTED_MAIN_ACTION_OUTPUTS.filter((name) => !conditionalMain.has(name));
  assert.deepEqual(unconditionalMain, ["result", "diff-json"]);
});

// ---------------------------------------------------------------------------
// 2. Bundled and Compiled Action Runtime Execution Tests
// ---------------------------------------------------------------------------

const mainEntries = [
  { name: "bundled", file: path.resolve(root, "bundled/index.js"), useHook: false },
  { name: "compiled", file: path.resolve(root, "dist/action.js"), useHook: true },
];

for (const entry of mainEntries) {
  test(`${entry.name} main Action rejects unsupported inputs early with status 1 and zero deployer key creation`, () => {
    const res = runMainAction({
      entryFile: entry.file,
      useHook: entry.useHook,
      envOverrides: {
        INPUT_UNSUPPORTED_OPTION: "invalid-value",
        INPUT_TYPO: "typo-value",
      },
    });

    assert.equal(res.status, 1);
    assert.match(res.combined, /Unsupported Action input: UNSUPPORTED_OPTION, TYPO/);
    assert.match(res.combined, /Supported inputs are: fixtures-path/);
    assert.equal(res.outputs.result, "fail");
    assert.equal(res.outputs["diff-json"], "{}");
    assert.equal(res.keyDirs.length, 0, "No deployer key directory should be created on unsupported input");
  });

  test(`${entry.name} main Action fails fast on missing required fixtures-path input`, () => {
    const res = runMainAction({
      entryFile: entry.file,
      useHook: entry.useHook,
      envOverrides: {
        "INPUT_FIXTURES-PATH": null,
      },
    });

    assert.equal(res.status, 1);
    assert.match(res.combined, /Input required and not supplied: fixtures-path/);
    assert.equal(res.outputs.result, "fail");
    assert.equal(res.outputs["diff-json"], "{}");
    assert.equal(res.keyDirs.length, 0);
  });

  test(`${entry.name} main Action accepts omitted optional inputs without input errors`, () => {
    const res = runMainAction({
      entryFile: entry.file,
      useHook: entry.useHook,
      envOverrides: {
        "INPUT_CONFIG-PATH": null,
        "INPUT_RPC-URL": null,
        "INPUT_SKIP-BUILD": null,
        "INPUT_BASE-REF": null,
      },
    });

    // Should not fail with unsupported or missing input error
    assert.doesNotMatch(res.combined, /Unsupported Action input/);
    assert.doesNotMatch(res.combined, /Input required and not supplied/);
  });
}

test("compiled main Action executes full success path and emits all unconditional outputs matching contract", () => {
  const res = runMainAction({
    entryFile: path.resolve(root, "dist/action.js"),
    useHook: true,
    envOverrides: {
      "INPUT_SKIP-BUILD": "true",
    },
  });

  assert.equal(res.status, 0, `Execution failed with output:\n${res.combined}`);
  assert.equal(res.outputs.result, "pass");
  assert.ok(res.outputs["diff-json"], "diff-json output must be emitted");
  assert.doesNotThrow(() => JSON.parse(res.outputs["diff-json"]));

  // Verify all unconditional outputs from reviewable exception list are emitted
  const conditional = new Set(OPTIONAL_CONDITIONAL_OUTPUTS.main.map((r) => r.name));
  for (const declaredOutput of SUPPORTED_MAIN_ACTION_OUTPUTS) {
    if (!conditional.has(declaredOutput)) {
      assert.ok(
        res.outputs[declaredOutput] !== undefined,
        `Unconditional output '${declaredOutput}' was not emitted`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Bundled and Compiled Comment Action Runtime Execution Tests
// ---------------------------------------------------------------------------

const commentEntries = [
  { name: "bundled", file: path.resolve(root, "bundled/comment-action.js") },
];

for (const entry of commentEntries) {
  test(`${entry.name} comment Action rejects unsupported inputs early with status 1`, () => {
    const res = runCommentAction({
      entryFile: entry.file,
      envOverrides: {
        INPUT_EXTRA_PARAM: "not-supported",
      },
    });

    assert.equal(res.status, 1);
    assert.match(res.combined, /Unsupported Action input: EXTRA_PARAM/);
    assert.match(res.combined, /Supported inputs are: report-path, metadata-path, github-token/);
  });

  test(`${entry.name} comment Action fails fast when required inputs are omitted`, () => {
    for (const requiredInput of ["INPUT_REPORT-PATH", "INPUT_METADATA-PATH", "INPUT_GITHUB-TOKEN"]) {
      const res = runCommentAction({
        entryFile: entry.file,
        envOverrides: {
          [requiredInput]: null,
        },
      });

      assert.equal(res.status, 1);
      const inputName = requiredInput.slice(6).toLowerCase();
      assert.match(res.combined, new RegExp(`Input required and not supplied: ${inputName}`));
    }
  });
}
