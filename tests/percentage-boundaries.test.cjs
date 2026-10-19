const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  enforceThresholds,
  parseAllowRatio,
  isPercentageThresholdExceeded,
  toExactFraction,
} = require('../dist/threshold');

function diff(baseConsumed, headConsumed, metricKey = 'cpu_instructions') {
  const delta = headConsumed - baseConsumed;
  const pct = baseConsumed === 0 ? null : (delta / baseConsumed) * 100;
  const regression = delta > 0;
  const metrics = [
    {
      key: metricKey,
      base: { availability: 'measured', consumed: baseConsumed, limit: null },
      head: { availability: 'measured', consumed: headConsumed, limit: null },
      availability: 'comparable',
      delta,
      pct,
      regression,
    },
  ];

  return {
    contracts: [
      {
        fixture_id: 'path:fixtures.json',
        logical_id: 'id:contract',
        contract_id: 'CA',
        base_contract_id: 'CB',
        head_contract_id: 'CA',
        base_commit: 'base',
        head_commit: 'head',
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        newBenchmarks: [],
        removedBenchmarks: [],
        functions: [
          {
            function_name: 'test_fn',
            case_id: 'args:[]',
            metrics,
            hasRegression: regression,
          },
        ],
      },
    ],
    hasRegression: regression,
    newContracts: [],
    removedContracts: [],
  };
}

test('exact percentage boundary passes without floating-point upward distortion (2.9% limit)', () => {
  // In IEEE 754 float: (29 / 1000) * 100 = 2.9000000000000004 > 2.9
  // Exact rational comparison must evaluate this as within limit.
  const config = {
    thresholds: {
      functions: {
        test_fn: { cpu_instructions: 'allow_2.9_percent_increase' },
      },
    },
  };
  assert.equal(enforceThresholds(diff(1000, 1029), config).length, 0);

  // 30 / 1000 is 3.0%, strictly exceeding 2.9%
  const violations = enforceThresholds(diff(1000, 1030), config);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'allow_2.9_percent_increase');
  assert.match(violations[0].message, /increased by 3\.00% \(limit 2\.9%\)/);
});

test('exact decimal boundary passes without float truncation (0.1% increase at 7/7000)', () => {
  const config = {
    thresholds: {
      functions: {
        test_fn: { cpu_instructions: 0.1 },
      },
    },
  };
  assert.equal(enforceThresholds(diff(7000, 7007), config).length, 0);

  const violations = enforceThresholds(diff(7000, 7008), config);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'allow_0.1_percent_increase');
});

test('exact rational comparison covers nonrepresentable thirds (1/3 increase)', () => {
  // delta = 1, base = 3 is exact 1/3 (33.3333...%)
  const d = diff(3, 4);

  // 1. Exact fraction string rule "allow_100/3_percent_increase" passes
  assert.equal(
    enforceThresholds(d, {
      thresholds: {
        functions: { test_fn: { cpu_instructions: 'allow_100/3_percent_increase' } },
      },
    }).length,
    0,
  );

  // 2. Numeric 100 / 3 global threshold passes
  assert.equal(
    enforceThresholds(d, {
      thresholds: { global: { max_allowed_cpu_increase_pct: 100 / 3 } },
    }).length,
    0,
  );

  // 3. 33.34% limit passes because 1/3 < 0.3334
  assert.equal(
    enforceThresholds(d, {
      thresholds: {
        functions: { test_fn: { cpu_instructions: 'allow_33.34_percent_increase' } },
      },
    }).length,
    0,
  );

  // 4. 33.33% limit fails because 1/3 > 0.3333
  const v = enforceThresholds(d, {
    thresholds: {
      functions: { test_fn: { cpu_instructions: 'allow_33.33_percent_increase' } },
    },
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'allow_33.33_percent_increase');
  // Message displays rounded percentage (33.33%) while exact policy cleanly fails
  assert.match(v[0].message, /increased by 33\.33% \(limit 33\.33%\)/);
});

test('safe-integer limits evaluate with exact rational precision at quadrillions', () => {
  const baseQuadrillion = 8_000_000_000_000_000;
  const deltaQuadrillion = 800_000_000_000_000; // exactly 10%
  const config = {
    thresholds: {
      functions: {
        test_fn: { cpu_instructions: 'allow_10_percent_increase' },
      },
    },
  };

  assert.equal(
    enforceThresholds(
      diff(baseQuadrillion, baseQuadrillion + deltaQuadrillion),
      config,
    ).length,
    0,
  );

  // One unit more at 8 quadrillion fails
  const violations = enforceThresholds(
    diff(baseQuadrillion, baseQuadrillion + deltaQuadrillion + 1),
    config,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'allow_10_percent_increase');
});

test('nonrepresentable thirds evaluate with exact precision near safe-integer limits', () => {
  const base3Quadrillion = 3_000_000_000_000_000;
  const delta1Quadrillion = 1_000_000_000_000_000; // exact 1/3
  const config = {
    thresholds: {
      global: { max_allowed_memory_increase_pct: 100 / 3 },
    },
  };

  assert.equal(
    enforceThresholds(
      diff(base3Quadrillion, base3Quadrillion + delta1Quadrillion, 'memory_bytes'),
      config,
    ).length,
    0,
  );

  // One unit more than 1/3 fails
  assert.equal(
    enforceThresholds(
      diff(base3Quadrillion, base3Quadrillion + delta1Quadrillion + 1, 'memory_bytes'),
      config,
    ).length,
    1,
  );
});

test('parseAllowRatio and toExactFraction helper invariants', () => {
  assert.deepEqual(toExactFraction(10), { num: 10n, den: 1n });
  assert.deepEqual(toExactFraction(2.5), { num: 25n, den: 10n });
  assert.deepEqual(toExactFraction(BigInt(500)), { num: 500n, den: 1n });

  assert.deepEqual(parseAllowRatio(10), { num: 10n, den: 100n });
  assert.deepEqual(parseAllowRatio('allow_2.5_percent_increase'), {
    num: 25n,
    den: 1000n,
  });
  assert.deepEqual(parseAllowRatio('allow_100/3_percent_increase'), {
    num: 100n,
    den: 300n,
  });
  assert.deepEqual(parseAllowRatio('allow_1/3_percent_increase'), {
    num: 1n,
    den: 300n,
  });
  assert.equal(parseAllowRatio('unsupported_rule'), null);

  assert.equal(
    isPercentageThresholdExceeded(29, 1000, { num: 29n, den: 1000n }),
    false,
  );
  assert.equal(
    isPercentageThresholdExceeded(30, 1000, { num: 29n, den: 1000n }),
    true,
  );
  assert.equal(
    isPercentageThresholdExceeded(0, 1000, { num: 29n, den: 1000n }),
    false,
  );
  assert.equal(
    isPercentageThresholdExceeded(-5, 1000, { num: 29n, den: 1000n }),
    false,
  );
  assert.equal(
    isPercentageThresholdExceeded(1, 0, { num: 29n, den: 1000n }),
    true,
  );
});
