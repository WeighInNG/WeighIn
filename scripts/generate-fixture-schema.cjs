const fs = require("node:fs");
const path = require("node:path");
const { WEIGHIN_FIXTURES_JSON_SCHEMA } = require("../dist/measurement");

const output = path.join(
  __dirname,
  "..",
  "docs/schemas/weighin-fixtures.schema.json",
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify(WEIGHIN_FIXTURES_JSON_SCHEMA, null, 2)}\n`,
);
