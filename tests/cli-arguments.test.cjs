const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const bin = path.resolve(repoRoot, require("../package.json").bin.weighin);
const { version } = require("../package.json");

function emptyDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-cli-args-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// The temporary directory is not a Git repository and contains no fixtures,
// Rust toolchain, Docker or RPC endpoint.
function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });
}

test("CLI --help and -h print offline usage and exit successfully", (t) => {
  const cwd = emptyDirectory(t);
  for (const flag of ["--help", "-h"]) {
    const result = run(cwd, flag);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Usage: weighin \[options\] \[fixtures\.json\] \[results\.json\]/,
    );
    assert.match(result.stdout, /--rpc-url <url>/);
    assert.match(result.stdout, /--deployment-timeout-seconds <n>/);
    assert.match(result.stdout, /--output <path>/);
    assert.match(result.stdout, /default: weighin-fixtures\.json/);
    assert.match(result.stdout, /default: weighin-results\.json/);
    assert.match(result.stdout, /default: http:\/\/localhost:8000\/rpc/);
    assert.match(result.stdout, /only measures/i);
    // Help runs before Git probes and measurement diagnostics.
    assert.doesNotMatch(result.stdout, /^Commit:/m);
    assert.equal(result.stderr, "");
    assert.deepEqual(fs.readdirSync(cwd), []);
  }
});

test("CLI --version reports installed package metadata version offline", (t) => {
  const cwd = emptyDirectory(t);
  const result = run(cwd, "--version");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
  assert.equal(result.stderr, "");
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test("CLI rejects invalid usage before fixture or network side effects", (t) => {
  const cwd = emptyDirectory(t);
  const cases = [
    { args: ["--unknown"], message: /Unknown option: --unknown/ },
    { args: ["--rpc-url"], message: /--rpc-url requires a value/ },
    {
      args: ["--deployment-timeout-seconds"],
      message: /--deployment-timeout-seconds requires a value/,
    },
    {
      args: ["--deployment-timeout-seconds", "601"],
      message: /between 1 and 600 seconds/,
    },
    {
      args: ["--deployment-timeout-seconds", "1.5"],
      message: /integer between 1 and 600 seconds/,
    },
    {
      args: ["--rpc-url", "--output", "out.json"],
      message: /--rpc-url requires a value/,
    },
    { args: ["--output"], message: /--output requires a value/ },
    {
      args: ["--output", "--rpc-url", "http://localhost:8000/rpc"],
      message: /--output requires a value/,
    },
    {
      args: ["--helper-path"],
      message: /--helper-path requires a path to an executable/,
    },
    {
      args: ["one.json", "two.json", "three.json"],
      message: /Unexpected argument: three\.json/,
    },
    {
      args: ["--rpc-url", "a", "--rpc-url", "b"],
      message: /Duplicate option: --rpc-url/,
    },
    {
      args: [
        "--deployment-timeout-seconds",
        "5",
        "--deployment-timeout-seconds",
        "6",
      ],
      message: /Duplicate option: --deployment-timeout-seconds/,
    },
    {
      args: ["--output", "a.json", "--output", "b.json"],
      message: /Duplicate option: --output/,
    },
    {
      args: ["--helper-path", "a", "--helper-path", "b"],
      message: /Duplicate option: --helper-path/,
    },
    {
      args: ["fixtures.json", "out.json", "--output", "other.json"],
      message: /Ambiguous output configuration/,
    },
    {
      args: ["fixtures.json", "out.json", "--stdout"],
      message: /Ambiguous output configuration/,
    },
  ];

  for (const { args, message } of cases) {
    const result = run(cwd, ...args);
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /Usage: weighin/);
    assert.equal(result.stdout, "");
  }
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test("CLI parses an explicit default-named fixture with a legacy output", (t) => {
  const cwd = emptyDirectory(t);
  const result = run(cwd, "weighin-fixtures.json", "legacy-results.json");
  assert.ifError(result.error);
  // Measurement fails because no fixture file exists; parsing must succeed.
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /Unexpected argument/);
  assert.match(result.stdout, /^Fixtures: weighin-fixtures\.json$/m);
  assert.match(result.stdout, /^Output:\s+legacy-results\.json$/m);
  assert.equal(fs.existsSync(path.join(cwd, "legacy-results.json")), false);
});

test("CLI option ordering chooses the same fixture, output and RPC paths", (t) => {
  const cwd = emptyDirectory(t);
  const argumentLists = [
    ["fixtures.json", "out.json", "--rpc-url", "http://127.0.0.1:1"],
    ["--rpc-url", "http://127.0.0.1:1", "fixtures.json", "out.json"],
    [
      "fixtures.json",
      "--output",
      "out.json",
      "--rpc-url",
      "http://127.0.0.1:1",
    ],
  ];
  const selections = argumentLists.map((args) => {
    const result = run(cwd, ...args);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    return result.stdout
      .split("\n")
      .filter((line) => /^(Fixtures|Output|RPC URL):/.test(line))
      .join("\n");
  });

  assert.equal(new Set(selections).size, 1, selections.join("\n---\n"));
  assert.match(selections[0], /Fixtures: fixtures\.json/);
  assert.match(selections[0], /Output:\s+out\.json/);
  assert.match(selections[0], /RPC URL:\s+http:\/\/127\.0\.0\.1:1/);
  assert.equal(fs.existsSync(path.join(cwd, "out.json")), false);
});

test("CLI treats -- as end of options for dash-prefixed paths", (t) => {
  const cwd = emptyDirectory(t);
  const result = run(cwd, "--", "--help", "dash-results.json");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  // --help was parsed as the fixture path, not as the help command.
  assert.match(result.stdout, /^Fixtures: --help$/m);
  assert.match(result.stdout, /^Output:\s+dash-results\.json$/m);
  assert.equal(fs.existsSync(path.join(cwd, "dash-results.json")), false);
});
