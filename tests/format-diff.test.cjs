"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { formatDiff, formatMetricRows } = require("../scripts/format-diff.js");

test("formats decrease, regression, unchanged, and unavailable metrics", () => {
  const diff = {
    contracts: [
      {
        fixture_id: "fixture-a",
        functions: [
          {
            function_name: "swap",
            case_id: "default",
            metrics: [
              {
                key: "cpu_instructions",
                base: { consumed: 100 },
                head: { consumed: 120 },
                availability: "comparable",
                delta: 20,
                pct: 20,
                regression: true,
              },
              {
                key: "memory_bytes",
                base: { consumed: 100 },
                head: { consumed: 80 },
                availability: "comparable",
                delta: -20,
                pct: -20,
                regression: false,
              },
              {
                key: "ledger_read_entries",
                base: { consumed: 3 },
                head: { consumed: 3 },
                availability: "comparable",
                delta: 0,
                pct: 0,
                regression: false,
              },
              {
                key: "historical_data_read_bytes",
                base: { consumed: null },
                head: { consumed: null },
                availability: "unavailable",
                delta: null,
                pct: null,
                regression: false,
              },
            ],
          },
        ],
      },
    ],
  };

  const rows = formatMetricRows(diff);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].regression, true);
  assert.equal(rows[1].delta, -20);
  assert.equal(rows[2].delta, 0);
  assert.equal(rows[3].unavailable, true);

  const output = formatDiff(diff, false);
  assert.match(output, /cpu_instructions/);
  assert.match(output, /memory_bytes/);
  assert.match(output, /\+20\.00%/);
  assert.match(output, /-20\.00%/);
});

test("rejects invalid diff JSON", () => {
  assert.throws(
    () => formatDiff({}),
    /expected an object with a contracts array/,
  );
});
