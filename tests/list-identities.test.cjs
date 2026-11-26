"use strict";
// Behaviour tests for the offline `weighin list-identities` subcommand.
// All tests run offline: no RPC, no GitHub API, no native helper, no builds.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const bin = path.resolve(repoRoot, pkg.bin.weighin);

// Import compiled modules directly for unit-level tests.
const { parseArgs, LIST_IDENTITIES_USAGE } = require("../dist/cli");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-list-identities-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFixture(directory, name, content) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, "list-identities", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    // Prove offline operation: explicitly block network-adjacent env vars.
    env: {
      ...process.env,
      WEIGHIN_HELPER_PATH: undefined,
    },
  });
}

// A fixture with explicit IDs on fixture, contract and all invocations.
const EXPLICIT_ID_FIXTURE = {
  id: "greeting-suite",
  contracts: [
    {
      id: "greeting",
      wasm_path: "contract/target/wasm32v1-none/release/contract_test.wasm",
      invocations: [
        {
          id: "hello-world",
          function_name: "hello",
          args: [{ type: "symbol", value: "world" }],
        },
        {
          id: "hello-alice",
          function_name: "hello",
          args: [{ type: "symbol", value: "alice" }],
        },
      ],
    },
  ],
};

// A fixture that relies entirely on path/args-derived identities (no IDs).
const PATH_DERIVED_FIXTURE = {
  contracts: [
    {
      wasm_path: "contract/target/wasm32v1-none/release/my_contract.wasm",
      invocations: [
        {
          function_name: "get_balance",
          args: [{ type: "address", value: "GABC1234" }],
        },
      ],
    },
  ],
};

// A multi-contract fixture for tuple ordering tests.
const MULTI_CONTRACT_FIXTURE = {
  id: "multi-suite",
  contracts: [
    {
      id: "alpha",
      wasm_path: "alpha.wasm",
      invocations: [
        { id: "op-a", function_name: "transfer", args: [] },
        { id: "op-b", function_name: "balance", args: [] },
      ],
    },
    {
      id: "beta",
      wasm_path: "beta.wasm",
      invocations: [{ id: "op-c", function_name: "query", args: [] }],
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. parseArgs unit tests
// ---------------------------------------------------------------------------

test("list-identities: parseArgs returns list-identities kind with correct options", () => {
  const cmd = parseArgs(["list-identities", "fixtures.json"]);
  assert.equal(cmd.kind, "list-identities");
  assert.equal(cmd.options.fixturesPath, "fixtures.json");
  assert.equal(cmd.options.json, false);
});

test("list-identities: parseArgs recognises --json flag", () => {
  const cmd = parseArgs(["list-identities", "--json", "fixtures.json"]);
  assert.equal(cmd.kind, "list-identities");
  assert.equal(cmd.options.fixturesPath, "fixtures.json");
  assert.equal(cmd.options.json, true);
});

test("list-identities: parseArgs allows --json after the path", () => {
  const cmd = parseArgs(["list-identities", "fixtures.json", "--json"]);
  assert.equal(cmd.kind, "list-identities");
  assert.equal(cmd.options.fixturesPath, "fixtures.json");
  assert.equal(cmd.options.json, true);
});

test("list-identities: parseArgs rejects unknown option", () => {
  assert.throws(
    () => parseArgs(["list-identities", "--unknown", "fixtures.json"]),
    /Unknown option: --unknown/,
  );
});

test("list-identities: parseArgs rejects unexpected second positional argument", () => {
  assert.throws(
    () => parseArgs(["list-identities", "fixtures.json", "extra.json"]),
    /Unexpected argument: extra\.json/,
  );
});

test("list-identities: parseArgs requires a fixtures file path", () => {
  assert.throws(() => parseArgs(["list-identities"]), /requires a fixtures/i);
});

test("list-identities: parseArgs --help inside subcommand returns help kind", () => {
  const cmd = parseArgs(["list-identities", "--help"]);
  assert.equal(cmd.kind, "help");
});

test("list-identities: parseArgs -h inside subcommand returns help kind", () => {
  const cmd = parseArgs(["list-identities", "-h"]);
  assert.equal(cmd.kind, "help");
});

// ---------------------------------------------------------------------------
// 2. Valid input — explicit IDs
// ---------------------------------------------------------------------------

test("list-identities: prints one line per invocation for explicit-ID fixture", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", EXPLICIT_ID_FIXTURE);

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
});

test("list-identities: tab-separated columns are fixture_id, logical_id, function_name, case_id", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", EXPLICIT_ID_FIXTURE);

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const lines = result.stdout.trim().split("\n");
  for (const line of lines) {
    const cols = line.split("\t");
    assert.equal(cols.length, 4, `expected 4 tab-separated columns: ${line}`);
  }

  const [col0, col1, col2, col3] = lines[0].split("\t");
  assert.equal(col0, "id:greeting-suite");
  assert.equal(col1, "id:greeting");
  assert.equal(col2, "hello");
  assert.equal(col3, "id:hello-world");

  const [, , fn1, caseId1] = lines[1].split("\t");
  assert.equal(fn1, "hello");
  assert.equal(caseId1, "id:hello-alice");
});

// ---------------------------------------------------------------------------
// 3. Valid input — path/args-derived identities
// ---------------------------------------------------------------------------

test("list-identities: uses path-derived fixture_id when no fixture id is set", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(
    dir,
    "my-fixtures.json",
    PATH_DERIVED_FIXTURE,
  );

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const [fixtureId, logicalId, fnName] = lines[0].split("\t");
  // Fixture ID must be path-derived.
  assert.match(fixtureId, /^path:/);
  // Logical ID must be wasm-derived.
  assert.match(logicalId, /^wasm:/);
  assert.equal(fnName, "get_balance");
});

test("list-identities: case_id is args-derived when no invocation id is set", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", PATH_DERIVED_FIXTURE);

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const [, , , caseId] = result.stdout.trim().split("\t");
  assert.match(caseId, /^args:/);
  // The args encoding must be valid JSON.
  const argsJson = caseId.slice("args:".length);
  assert.doesNotThrow(() => JSON.parse(argsJson));
});

// ---------------------------------------------------------------------------
// 4. Multi-contract — ordering
// ---------------------------------------------------------------------------

test("list-identities: emits one row per invocation in contract declaration order", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(
    dir,
    "fixtures.json",
    MULTI_CONTRACT_FIXTURE,
  );

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 3);

  const [, lid0, fn0, cid0] = lines[0].split("\t");
  const [, lid1, fn1, cid1] = lines[1].split("\t");
  const [, lid2, fn2, cid2] = lines[2].split("\t");

  assert.equal(lid0, "id:alpha");
  assert.equal(fn0, "transfer");
  assert.equal(cid0, "id:op-a");

  assert.equal(lid1, "id:alpha");
  assert.equal(fn1, "balance");
  assert.equal(cid1, "id:op-b");

  assert.equal(lid2, "id:beta");
  assert.equal(fn2, "query");
  assert.equal(cid2, "id:op-c");
});

// ---------------------------------------------------------------------------
// 5. Explicit IDs are stable across reordering and path changes
// ---------------------------------------------------------------------------

test("list-identities: explicit IDs are unchanged when fixture is reordered", (t) => {
  const dir = tmpDir(t);

  // Original order fixture
  const original = writeFixture(dir, "original.json", MULTI_CONTRACT_FIXTURE);
  // Reordered fixture: contracts swapped, invocations within alpha swapped
  const reordered = writeFixture(dir, "reordered.json", {
    id: "multi-suite",
    contracts: [
      {
        id: "beta",
        wasm_path: "beta.wasm",
        invocations: [{ id: "op-c", function_name: "query", args: [] }],
      },
      {
        id: "alpha",
        wasm_path: "alpha.wasm",
        invocations: [
          { id: "op-b", function_name: "balance", args: [] },
          { id: "op-a", function_name: "transfer", args: [] },
        ],
      },
    ],
  });

  const r1 = run(dir, original);
  const r2 = run(dir, reordered);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);

  // Both produce the same set of tuples (possibly different order).
  const toSet = (output) =>
    new Set(
      output
        .trim()
        .split("\n")
        .map((l) => l.trim()),
    );
  assert.deepEqual(toSet(r1.stdout), toSet(r2.stdout));

  // The fixture_id, logical_id and case_id are identical regardless of order.
  const r1Lines = r1.stdout.trim().split("\n");
  const r2Lines = r2.stdout.trim().split("\n");
  for (const line of [...r1Lines, ...r2Lines]) {
    const [fid, lid, , cid] = line.split("\t");
    assert.equal(fid, "id:multi-suite");
    assert.match(lid, /^id:(alpha|beta)$/);
    assert.match(cid, /^id:op-(a|b|c)$/);
  }
});

test("list-identities: explicit IDs survive WASM path change", (t) => {
  const dir = tmpDir(t);

  const originalPath = writeFixture(dir, "original.json", {
    id: "suite",
    contracts: [
      {
        id: "my-contract",
        wasm_path: "old/path/contract.wasm",
        invocations: [{ id: "op1", function_name: "fn", args: [] }],
      },
    ],
  });

  const movedPath = writeFixture(dir, "moved.json", {
    id: "suite",
    contracts: [
      {
        id: "my-contract",
        wasm_path: "new/path/contract_renamed.wasm",
        invocations: [{ id: "op1", function_name: "fn", args: [] }],
      },
    ],
  });

  const r1 = run(dir, originalPath);
  const r2 = run(dir, movedPath);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);

  // The tuples must be identical: explicit IDs, not wasm paths, drive identity.
  assert.equal(r1.stdout, r2.stdout);

  const [fid, lid, fn, cid] = r1.stdout.trim().split("\t");
  assert.equal(fid, "id:suite");
  assert.equal(lid, "id:my-contract");
  assert.equal(fn, "fn");
  assert.equal(cid, "id:op1");
});

// ---------------------------------------------------------------------------
// 6. Machine-readable JSON output
// ---------------------------------------------------------------------------

test("list-identities --json emits a JSON array to stdout", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", EXPLICIT_ID_FIXTURE);

  const result = run(dir, "--json", fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result.stdout);
  }, `stdout must be valid JSON: ${result.stdout}`);

  assert.ok(Array.isArray(parsed), "JSON output must be an array");
  assert.equal(parsed.length, 2);
});

test("list-identities --json array elements have fixture_id, logical_id, function_name and case_id", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", EXPLICIT_ID_FIXTURE);

  const result = run(dir, "--json", fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const parsed = JSON.parse(result.stdout);
  for (const item of parsed) {
    assert.ok("fixture_id" in item, "must have fixture_id");
    assert.ok("logical_id" in item, "must have logical_id");
    assert.ok("function_name" in item, "must have function_name");
    assert.ok("case_id" in item, "must have case_id");
    assert.equal(typeof item.fixture_id, "string");
    assert.equal(typeof item.logical_id, "string");
    assert.equal(typeof item.function_name, "string");
    assert.equal(typeof item.case_id, "string");
  }
});

test("list-identities --json produces the same identity values as the tab output", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(
    dir,
    "fixtures.json",
    MULTI_CONTRACT_FIXTURE,
  );

  const tabResult = run(dir, fixturePath);
  const jsonResult = run(dir, "--json", fixturePath);
  assert.equal(tabResult.status, 0, tabResult.stderr);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);

  const tabTuples = tabResult.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [fixture_id, logical_id, function_name, case_id] = line.split("\t");
      return { fixture_id, logical_id, function_name, case_id };
    });
  const jsonTuples = JSON.parse(jsonResult.stdout);

  assert.deepEqual(jsonTuples, tabTuples);
});

// ---------------------------------------------------------------------------
// 7. Invalid input — parse failures
// ---------------------------------------------------------------------------

test("list-identities: missing fixture file exits 1 with error message", (t) => {
  const dir = tmpDir(t);
  const result = run(dir, path.join(dir, "nonexistent.json"));

  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(result.stdout, "");
});

test("list-identities: malformed JSON exits 1 with error message", (t) => {
  const dir = tmpDir(t);
  const badPath = path.join(dir, "bad.json");
  fs.writeFileSync(badPath, "{ not valid json", "utf8");

  const result = run(dir, badPath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.notEqual(result.stderr, "");
  assert.equal(result.stdout, "");
});

test("list-identities: fixture failing schema validation exits 1", (t) => {
  const dir = tmpDir(t);
  const badPath = path.join(dir, "invalid.json");
  // Missing required contracts array.
  fs.writeFileSync(badPath, JSON.stringify({ id: "suite" }), "utf8");

  const result = run(dir, badPath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.notEqual(result.stderr, "");
  assert.equal(result.stdout, "");
});

test("list-identities: duplicate logical IDs exit 1 with diagnostic", (t) => {
  const dir = tmpDir(t);
  const duplicatePath = writeFixture(dir, "dup.json", {
    contracts: [
      {
        id: "same",
        wasm_path: "a.wasm",
        invocations: [{ function_name: "fn", args: [] }],
      },
      {
        id: "same",
        wasm_path: "b.wasm",
        invocations: [{ function_name: "fn", args: [] }],
      },
    ],
  });

  const result = run(dir, duplicatePath);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /[Dd]uplicate/);
  assert.equal(result.stdout, "");
});

// ---------------------------------------------------------------------------
// 8. Unknown options and argument validation
// ---------------------------------------------------------------------------

test("list-identities: unknown option exits 1 with diagnostic", (t) => {
  const dir = tmpDir(t);
  const result = run(dir, "--unknown-option", "fixtures.json");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --unknown-option/);
  assert.equal(result.stdout, "");
});

test("list-identities: missing path argument exits 1 with usage hint", (t) => {
  const dir = tmpDir(t);
  const result = run(dir);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a fixtures/i);
  assert.equal(result.stdout, "");
});

test("list-identities: extra positional argument exits 1", (t) => {
  const dir = tmpDir(t);
  const result = run(dir, "fixtures.json", "extra.json");
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected argument/);
  assert.equal(result.stdout, "");
});

// ---------------------------------------------------------------------------
// 9. Offline execution — no measurement, no RPC, no deployment
// ---------------------------------------------------------------------------

test("list-identities: does not start any measurement or touch RPC", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(dir, "fixtures.json", EXPLICIT_ID_FIXTURE);

  const result = run(dir, fixturePath);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  // None of the measurement diagnostic lines must appear on stdout.
  assert.doesNotMatch(result.stdout, /Benchmarking/i);
  assert.doesNotMatch(result.stdout, /Starting Weighin/i);
  assert.doesNotMatch(result.stdout, /RPC URL/);
  assert.doesNotMatch(result.stdout, /Commit:/);
  assert.doesNotMatch(result.stdout, /Output:/);
  // Stderr must be empty on success.
  assert.equal(result.stderr, "");
});

test("list-identities: list-identities help flag does not trigger measurement", (t) => {
  const dir = tmpDir(t);
  const result = run(dir, "--help");
  assert.ifError(result.error);
  // -h/--help returns main help text; not measurement.
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: weighin/);
  assert.doesNotMatch(result.stdout, /Benchmarking/i);
  assert.equal(result.stderr, "");
  // No files written.
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---------------------------------------------------------------------------
// 10. Consistency with parseFixtures from identity module
// ---------------------------------------------------------------------------

test("list-identities: tab output matches parseFixtures-derived identities directly", (t) => {
  const dir = tmpDir(t);
  const fixturePath = writeFixture(
    dir,
    "fixtures.json",
    MULTI_CONTRACT_FIXTURE,
  );

  const result = run(dir, fixturePath);
  assert.equal(result.status, 0, result.stderr);

  // Compute expected identities via the library directly.
  const { parseFixtures } = require("../dist/identity");
  const raw = JSON.stringify(MULTI_CONTRACT_FIXTURE);
  // fixturePath is relative to CWD used in the subprocess, which is `dir`.
  const relPath = "fixtures.json";
  const identified = parseFixtures(raw, relPath);

  const expectedLines = [];
  for (const contract of identified.contracts) {
    for (const invocation of contract.invocations) {
      expectedLines.push(
        [
          identified.fixture_id,
          contract.logical_id,
          invocation.function_name,
          invocation.case_id,
        ].join("\t"),
      );
    }
  }

  assert.equal(result.stdout.trim(), expectedLines.join("\n"));
});
