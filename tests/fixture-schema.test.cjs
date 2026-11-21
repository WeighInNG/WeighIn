const { test } = require("node:test");
const assert = require("node:assert/strict");
const { WEIGHIN_FIXTURES_JSON_SCHEMA } = require("../dist/measurement");
const { parseFixtures } = require("../dist/identity");

test("published fixture schema is generated from the runtime fixture declarations", () => {
  assert.equal(
    WEIGHIN_FIXTURES_JSON_SCHEMA.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(
    WEIGHIN_FIXTURES_JSON_SCHEMA.title,
    "WeighIn fixture declarations",
  );
  assert.ok(WEIGHIN_FIXTURES_JSON_SCHEMA["x-weighin-identities"]);
  const contract = {
    wasm_path: "contract.wasm",
    invocations: [
      { function_name: "hello", args: [{ type: "symbol", value: "world" }] },
    ],
  };
  const parsed = parseFixtures(
    JSON.stringify({ contracts: [contract] }),
    "fixtures.json",
  );
  assert.equal(parsed.fixture_id, "path:fixtures.json");
  assert.equal(parsed.contracts[0].logical_id, "wasm:contract.wasm");
  assert.match(parsed.contracts[0].invocations[0].case_id, /^args:/);
});

test("fixture schema contract has valid and invalid examples that use runtime validation", () => {
  const valid = {
    id: "suite",
    contracts: [
      {
        id: "contract",
        wasm_path: "contract.wasm",
        invocations: [{ id: "hello", function_name: "hello", args: [] }],
      },
    ],
  };
  assert.doesNotThrow(() =>
    parseFixtures(JSON.stringify(valid), "fixtures.json"),
  );
  const invalid = structuredClone(valid);
  invalid.contracts[0].id = "   ";
  assert.throws(
    () => parseFixtures(JSON.stringify(invalid), "fixtures.json"),
    /ID must not be blank/,
  );
});
