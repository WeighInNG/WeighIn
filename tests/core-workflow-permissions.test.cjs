const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

test("core CI declares only read access to repository contents", () => {
  const workflow = YAML.parse(
    fs.readFileSync(
      path.join(__dirname, "..", ".github/workflows/ci.yml"),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
});
