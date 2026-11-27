const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");

test("active workflow Actions use full commit SHAs", () => {
  const workflowDirectory = path.join(root, ".github/workflows");
  let thirdPartyActions = 0;
  const inspectUses = (value, file) => {
    if (Array.isArray(value)) {
      for (const item of value) inspectUses(item, file);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "uses" && typeof child === "string") {
          if (child.startsWith("./")) continue;
          thirdPartyActions += 1;
          assert.match(
            child,
            /^[^@]+@[0-9a-f]{40}$/i,
            `${file}: third-party Action must be pinned to a full commit SHA: ${child}`,
          );
        } else {
          inspectUses(child, file);
        }
      }
    }
  };

  for (const name of fs.readdirSync(workflowDirectory)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const file = `.github/workflows/${name}`;
    const workflow = YAML.parse(fs.readFileSync(path.join(root, file), "utf8"));
    inspectUses(workflow, file);
  }
  assert.ok(
    thirdPartyActions > 0,
    "workflow scan must inspect third-party Actions",
  );
});
