const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Address } = require("@stellar/stellar-sdk");
const { verifyTransferReplay } = require("./token-transfer-cases.cjs");

function output(raw, key) {
  const lines = raw.split("\n");
  const first = lines.findIndex((line) => line.startsWith(`${key}<<`));
  assert.ok(first >= 0, `Missing Action output ${key}`);
  const last = lines.indexOf(lines[first].slice(key.length + 2), first + 1);
  assert.ok(last > first, `Unterminated Action output ${key}`);
  return lines.slice(first + 1, last).join("\n");
}

function verifyBundledAction({
  temporary,
  destination,
  endpoint,
  helper,
  signer,
  fixture,
  baseline,
  regression,
  policy,
}) {
  const workspace = path.join(temporary, "project");
  const origin = path.join(temporary, "origin.git");
  const bundle = path.resolve(__dirname, "../../bundled/index.js");
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(workspace);
  const git = (...args) =>
    cp.execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "WeighIn isolated proof");
  git("config", "user.email", "experiment@example.invalid");
  fs.copyFileSync(
    baseline,
    path.join(workspace, fixture.contracts[0].wasm_path),
  );
  fs.writeFileSync(
    path.join(workspace, "fixture.json"),
    JSON.stringify(fixture, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(workspace, "policy.toml"), policy);
  git("add", ".");
  git("commit", "-m", "Funded transfer baseline");
  const base = git("rev-parse", "HEAD");
  git("clone", "--bare", workspace, origin);
  git("remote", "add", "origin", origin);
  git("switch", "-c", "experiment-head");
  fs.writeFileSync(
    path.join(destination, "bundled-fixture.json"),
    JSON.stringify(fixture, null, 2) + "\n",
  );

  function run(label, expectedExit) {
    const captures = path.join(temporary, `action-${label}`);
    fs.mkdirSync(captures);
    const outputs = path.join(captures, "outputs.txt");
    const summary = path.join(captures, "summary.md");
    fs.writeFileSync(outputs, "");
    fs.writeFileSync(summary, "");
    const result = cp.spawnSync(
      process.execPath,
      [
        "--require",
        path.join(__dirname, "token-transfer-action-preload.cjs"),
        bundle,
      ],
      {
        cwd: workspace,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          GITHUB_EVENT_PATH: "",
          GITHUB_OUTPUT: outputs,
          GITHUB_STEP_SUMMARY: summary,
          "INPUT_FIXTURES-PATH": "fixture.json",
          "INPUT_CONFIG-PATH": "policy.toml",
          "INPUT_BASE-REF": "main",
          "INPUT_RPC-URL": endpoint,
          "INPUT_SKIP-BUILD": "true",
          "INPUT_GITHUB-TOKEN": "",
          WEIGHIN_HELPER_PATH: helper,
          WEIGHIN_TOKEN_TRANSFER_KEY_FILE: signer,
          WEIGHIN_MIGRATION_EVIDENCE: captures,
        },
      },
    );
    for (const file of fs.readdirSync(captures)) {
      fs.copyFileSync(
        path.join(captures, file),
        path.join(destination, `bundled-${label}-${file}`),
      );
    }
    fs.writeFileSync(
      path.join(destination, `bundled-${label}-process.json`),
      JSON.stringify(
        {
          exit: result.status,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          base,
          head: git("rev-parse", "HEAD"),
          bundle_sha256: sha256(fs.readFileSync(bundle)),
        },
        null,
        2,
      ) + "\n",
    );
    if (result.error) throw result.error;
    assert.equal(result.status, expectedExit, result.stdout + result.stderr);
    const raw = fs.readFileSync(outputs, "utf8");
    assert.equal(output(raw, "result"), expectedExit ? "fail" : "pass");
    const diff = JSON.parse(output(raw, "diff-json"));
    assert.equal(diff.contracts.length, 1);
    const [contract] = diff.contracts;
    assert.equal(contract.functions.length, 1);
    const [measured] = contract.functions;
    assert.equal(measured.function_name, "transfer");
    const cpu = measured.metrics.find(
      (metric) => metric.key === "cpu_instructions",
    );
    assert.ok(
      expectedExit
        ? cpu.head.consumed > cpu.base.consumed
        : cpu.head.consumed === cpu.base.consumed,
    );
    if (expectedExit)
      assert.match(
        result.stdout + result.stderr,
        /1 threshold violation\(s\) detected/,
      );

    const [asset, sender, recipient] =
      fixture.contracts[0].invocations[0].args.map((arg) => arg.value);
    const replays = JSON.parse(
      fs.readFileSync(path.join(captures, "native.json"), "utf8"),
    );
    for (const side of ["base", "head"]) {
      verifyTransferReplay(
        replays,
        {
          contract_id: contract[`${side}_contract_id`],
          benchmarks: [{ provenance: measured[`${side}_provenance`] }],
        },
        Address.fromString(asset).toScVal(),
        sender,
        recipient,
      );
    }
  }
  run("control", 0);
  fs.copyFileSync(
    regression,
    path.join(workspace, fixture.contracts[0].wasm_path),
  );
  git("add", fixture.contracts[0].wasm_path);
  git("commit", "-m", "Inject redundant token balance reads");
  run("regression", 1);
}

module.exports = { verifyBundledAction };
