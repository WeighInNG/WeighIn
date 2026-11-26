const { test } = require("node:test");
const assert = require("node:assert/strict");
const baseline = require("../docs/experiments/native-integration/base.json");
const {
  comparePercentageToLimit,
  parsePercentageLimit,
  percentageLimitText,
} = require("../dist/percentage");
const { diffBenchmarks } = require("../dist/diff");
const { enforceThresholds } = require("../dist/threshold");

function recordsWithCpu(baseConsumed, headConsumed) {
  const base = structuredClone(baseline);
  const head = structuredClone(baseline);
  for (const record of base)
    for (const benchmark of record.benchmarks)
      benchmark.metrics.cpu_instructions.consumed = baseConsumed;
  for (const record of head)
    for (const benchmark of record.benchmarks)
      benchmark.metrics.cpu_instructions.consumed = headConsumed;
  return [base, head];
}

function diffWithCpu(baseConsumed, headConsumed, config) {
  const [base, head] = recordsWithCpu(baseConsumed, headConsumed);
  return diffBenchmarks(base, head, config);
}

function functionPolicy(rule) {
  return { thresholds: { functions: { hello: { cpu_instructions: rule } } } };
}

function aggregatePolicy(rule) {
  return {
    aggregates: {
      flow: {
        members: [{ function_name: "hello" }],
        thresholds: { cpu_instructions: rule },
      },
    },
  };
}

test("decimal limits are parsed exactly from named rules and numeric literals", () => {
  assert.deepEqual(parsePercentageLimit("allow_2.5_percent_increase"), {
    numerator: 25n,
    denominator: 10n,
    text: "2.5",
  });
  assert.deepEqual(parsePercentageLimit(1e-7), {
    numerator: 1n,
    denominator: 10000000n,
    text: "1e-7",
  });
  assert.deepEqual(
    parsePercentageLimit("allow_83.333333333333334_percent_increase"),
    {
      numerator: 83333333333333334n,
      denominator: 1000000000000000n,
      text: "83.333333333333334",
    },
  );
  assert.equal(parsePercentageLimit("ignore"), null);
  assert.equal(parsePercentageLimit(NaN), null);
  assert.equal(parsePercentageLimit(-1), null);
  assert.equal(percentageLimitText("allow_2.5_percent_increase"), "2.5");
  assert.equal(percentageLimitText(1e-7), "1e-7");
});

test("nonrepresentable thirds compare exactly in both directions", () => {
  assert.equal(
    comparePercentageToLimit(1, 3, "allow_33.33333333333333_percent_increase"),
    1,
  );
  assert.equal(
    comparePercentageToLimit(5, 6, "allow_83.333333333333334_percent_increase"),
    -1,
  );
  assert.equal(
    comparePercentageToLimit(1, 3, "allow_33.34_percent_increase"),
    -1,
  );
  assert.equal(
    comparePercentageToLimit(1, 3, "allow_33.33_percent_increase"),
    1,
  );
});

test("safe-integer limits compare exactly and unsafe counters fail closed", () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(
    comparePercentageToLimit(
      1,
      max,
      "allow_0.0000000000000111022302462515667_percent_increase",
    ),
    -1,
  );
  assert.equal(
    comparePercentageToLimit(
      1,
      max,
      "allow_0.0000000000000111022302462515666_percent_increase",
    ),
    1,
  );
  assert.equal(
    comparePercentageToLimit(1, 0, "allow_1000000_percent_increase"),
    1,
  );
  assert.equal(comparePercentageToLimit(0, 0, "allow_0_percent_increase"), 0);
  assert.throws(
    () => comparePercentageToLimit(1, max + 1, "allow_10_percent_increase"),
    /unsafe baseline/,
  );
  assert.throws(
    () => comparePercentageToLimit(1, 10, "allow_1.2.3_percent_increase"),
    /Invalid percentage limit/,
  );
});

test("per-function policies use exact boundaries while reports stay rounded", () => {
  const atLimit = enforceThresholds(
    diffWithCpu(10, 11),
    functionPolicy("allow_10_percent_increase"),
  );
  assert.deepEqual(atLimit, []);

  const aboveLimit = enforceThresholds(diffWithCpu(10, 12), functionPolicy(10));
  assert.equal(aboveLimit.length, 1);
  assert.match(aboveLimit[0].message, /increased by 20\.00% \(limit 10%\)/);

  const roundedThird = enforceThresholds(
    diffWithCpu(3, 4),
    functionPolicy("allow_33.33333333333333_percent_increase"),
  );
  assert.equal(roundedThird.length, 1);
  assert.match(roundedThird[0].message, /increased by 33\.33%/);
  assert.match(roundedThird[0].message, /limit 33\.33333333333333%/);

  const roundedSixth = enforceThresholds(
    diffWithCpu(6, 11),
    functionPolicy("allow_83.333333333333334_percent_increase"),
  );
  assert.deepEqual(roundedSixth, []);

  const zeroBase = enforceThresholds(
    diffWithCpu(0, 1),
    functionPolicy("allow_1000000_percent_increase"),
  );
  assert.equal(zeroBase.length, 1);
  assert.match(
    zeroBase[0].message,
    /increased by Infinity% \(limit 1000000%\)/,
  );
});

test("unavailable metrics and invalid rules remain failures", () => {
  const [, head] = recordsWithCpu(10, 11);
  head[0].benchmarks[0].metrics.cpu_instructions = {
    availability: "unavailable",
    consumed: null,
    limit: 400000000,
    reason: "measurement did not complete",
  };
  const [base] = recordsWithCpu(10, 11);
  const diff = diffBenchmarks(base, head);
  const violations = enforceThresholds(
    diff,
    functionPolicy("allow_10_percent_increase"),
  );
  assert.equal(violations.length, 1);
  assert.match(
    violations[0].message,
    /unavailable; cannot evaluate configured policy/,
  );
  assert.throws(
    () =>
      enforceThresholds(
        diffWithCpu(10, 11),
        functionPolicy("allow_1.2.3_percent_increase"),
      ),
    /cpu_instructions.*Invalid input|Unsupported threshold rule/,
  );
});

test("aggregate thresholds use the same exact integer/decimal comparison", () => {
  const exactViolation = enforceThresholds(
    diffWithCpu(
      3,
      4,
      aggregatePolicy("allow_33.33333333333333_percent_increase"),
    ),
    aggregatePolicy("allow_33.33333333333333_percent_increase"),
  );
  assert.equal(exactViolation.length, 1);
  assert.equal(exactViolation[0].aggregate_id, "flow");
  assert.match(exactViolation[0].message, /limit 33\.33333333333333%/);

  const exactPass = enforceThresholds(
    diffWithCpu(
      6,
      11,
      aggregatePolicy("allow_83.333333333333334_percent_increase"),
    ),
    aggregatePolicy("allow_83.333333333333334_percent_increase"),
  );
  assert.deepEqual(exactPass, []);
});
