import { describe, it, expect } from "vitest";
import {
  enforceThresholds,
  GlobalThresholds,
  WeighinConfig,
} from "../src/threshold";
import { DiffResult, MetricKey } from "../src/diff";

function createMockDiff(
  key: MetricKey,
  delta: number,
  pct: number | null,
  regression: boolean,
): DiffResult {
  return {
    contracts: [
      {
        contract_id: "contract-a",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        functions: [
          {
            function_name: "test-fn",
            hasRegression: regression,
            metrics: [
              {
                key,
                base: { consumed: 100, limit: 0 },
                head: { consumed: 100 + delta, limit: 0 },
                delta,
                pct,
                regression,
              },
            ],
          },
        ],
      },
    ],
    hasRegression: regression,
    newContracts: [],
    removedContracts: [],
  };
}

describe("enforceThresholds", () => {
  it("returns empty violations if config or thresholds are empty", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    expect(enforceThresholds(diff, null)).toEqual([]);
    expect(enforceThresholds(diff, {})).toEqual([]);
    expect(enforceThresholds(diff, { thresholds: {} })).toEqual([]);
  });

  it("handles fail_on_any_regression", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    const config: WeighinConfig = {
      thresholds: { global: { fail_on_any_regression: true } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("fail_on_any_regression");
  });

  it("respects max_allowed_cpu_increase_pct global rule", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true); // 10% increase
    const config: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("allow_5_percent_increase");

    const configPass: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 15 } },
    };
    expect(enforceThresholds(diff, configPass)).toEqual([]);
  });

  it("strict_zero_tolerance catches any regression", () => {
    const diff = createMockDiff("events_count", 1, 1, true);
    const config: WeighinConfig = {
      thresholds: {
        functions: { "test-fn": { events_count: "strict_zero_tolerance" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("strict_zero_tolerance");
  });

  it("strict_zero_tolerance passes if no regression", () => {
    const diff = createMockDiff("events_count", -1, -1, false);
    const config: WeighinConfig = {
      thresholds: {
        functions: { "test-fn": { events_count: "strict_zero_tolerance" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toEqual([]); // No violation if improvement
  });

  it("ignore rule skips violations even with global fail_on_any_regression", () => {
    const diff = createMockDiff("cpu_instructions", 10, 10, true);
    const config: WeighinConfig = {
      thresholds: {
        global: { fail_on_any_regression: true },
        functions: { "test-fn": { cpu_instructions: "ignore" } },
      },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toEqual([]);
  });

  it("handles Infinity percentage (division by zero) correctly", () => {
    const diff = createMockDiff("cpu_instructions", 10, null, true); // pct = null
    const config: WeighinConfig = {
      thresholds: { global: { max_allowed_cpu_increase_pct: 100 } },
    };
    const violations = enforceThresholds(diff, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("Infinity");
  });

  describe("Absolute limits", () => {
    it("fails when absolute limit is exceeded", () => {
      const config = {
        limits: {
          global: {
            cpu_instructions: 50,
          },
        },
      };
      const diff = {
        contracts: [
          {
            contract_id: "c1",
            functions: [
              {
                function_name: "test",
                metrics: [
                  {
                    key: "cpu_instructions",
                    base: { consumed: 10, limit: 100 },
                    head: { consumed: 51, limit: 100 },
                    delta: 41,
                    pct: 410,
                    regression: true,
                  },
                ],
              },
            ],
          },
        ],
      };

      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(1);
      expect(v[0].rule).toBe("absolute_limit(50)");
      expect(v[0].message).toContain("exceeded absolute limit");
    });

    it("passes when absolute limit is exactly met or below", () => {
      const config = {
        limits: {
          global: {
            cpu_instructions: 51,
          },
          functions: {
            test: {
              memory_bytes: 50,
            },
          },
        },
      };
      const diff = {
        contracts: [
          {
            contract_id: "c1",
            functions: [
              {
                function_name: "test",
                metrics: [
                  {
                    key: "cpu_instructions",
                    base: { consumed: 0, limit: 100 },
                    head: { consumed: 51, limit: 100 },
                    delta: 51,
                    pct: null,
                    regression: true,
                  },
                  {
                    key: "memory_bytes",
                    base: { consumed: 0, limit: 100 },
                    head: { consumed: 40, limit: 100 },
                    delta: 40,
                    pct: null,
                    regression: true,
                  },
                ],
              },
            ],
          },
        ],
      };

      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(0);
    });

    it("evaluates absolute and regression limits independently (both fail)", () => {
      const config = {
        limits: {
          global: { cpu_instructions: 50 },
        },
        thresholds: {
          global: { max_allowed_cpu_increase_pct: 10 },
        },
      };
      const diff = {
        contracts: [
          {
            contract_id: "c1",
            functions: [
              {
                function_name: "test",
                metrics: [
                  {
                    key: "cpu_instructions",
                    base: { consumed: 10, limit: 100 },
                    head: { consumed: 51, limit: 100 },
                    delta: 41,
                    pct: 410,
                    regression: true,
                  },
                ],
              },
            ],
          },
        ],
      };
      const v = enforceThresholds(diff as any, config as any);
      expect(v).toHaveLength(2);
      expect(v[0].rule).toBe("absolute_limit(50)");
      expect(v[1].rule).toBe("allow_10_percent_increase");
    });
  });
});

// ---------------------------------------------------------------------------
// Shared parity table for enforceThresholds (issue #28)
//
// Verifies that enforceThresholds agrees with the exported schema: values that
// WeighinConfigSchema rejects must also be rejected by enforceThresholds (via
// the internal validateConfig call), and values it accepts must not throw.
// ---------------------------------------------------------------------------

import {
  WeighinConfigSchema,
  validateConfig,
  RuleValueSchema,
} from "../src/config";
import { diffBenchmarks } from "../src/diff";

describe("enforceThresholds schema parity (issue #28)", () => {
  // Minimal no-regression diff to test policy acceptance without needing actual changes
  const emptyDiff: DiffResult = {
    contracts: [
      {
        contract_id: "c1",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: false,
        newFunctions: [],
        removedFunctions: [],
        functions: [
          {
            function_name: "hello",
            hasRegression: false,
            metrics: [
              {
                key: "cpu_instructions",
                base: { consumed: 100, limit: 0 },
                head: { consumed: 100, limit: 0 },
                delta: 0,
                pct: 0,
                regression: false,
              },
            ],
          },
        ],
      },
    ],
    hasRegression: false,
    newContracts: [],
    removedContracts: [],
  };

  function configWith(rule: unknown) {
    return { thresholds: { functions: { hello: { cpu_instructions: rule } } } };
  }

  const REJECTED_RULES = [
    // Category 2: malformed named percentage strings
    {
      desc: "allow_1.2.3_percent_increase",
      rule: "allow_1.2.3_percent_increase",
    },
    { desc: "allow_-1_percent_increase", rule: "allow_-1_percent_increase" },
    { desc: "allow_magic", rule: "allow_magic" },
    // Category 4: negative numbers
    { desc: "numeric -1", rule: -1 },
    { desc: "numeric -0.5", rule: -0.5 },
    // Category 5: nonfinite numbers
    { desc: "Infinity", rule: Infinity },
    { desc: "-Infinity", rule: -Infinity },
    { desc: "NaN", rule: NaN },
    // Other invalid types
    { desc: "boolean true", rule: true },
  ];

  const ACCEPTED_RULES = [
    // Category 1: valid named percentages
    { desc: "allow_10_percent_increase", rule: "allow_10_percent_increase" },
    { desc: "allow_2.5_percent_increase", rule: "allow_2.5_percent_increase" },
    { desc: "allow_0_percent_increase", rule: "allow_0_percent_increase" },
    // Category 3: scientific notation
    { desc: "numeric 0", rule: 0 },
    { desc: "numeric 1e-7", rule: 1e-7 },
    { desc: "numeric 10", rule: 10 },
    // Category 10: named rules
    { desc: "ignore", rule: "ignore" },
    { desc: "strict_zero_tolerance", rule: "strict_zero_tolerance" },
  ];

  describe("enforceThresholds rejects invalid rules that WeighinConfigSchema also rejects", () => {
    for (const { desc, rule } of REJECTED_RULES) {
      it(`rejects: ${desc}`, () => {
        // Exported schema rejects it
        expect(WeighinConfigSchema.safeParse(configWith(rule)).success).toBe(
          false,
        );
        // Runtime also rejects it
        expect(() =>
          enforceThresholds(emptyDiff, configWith(rule) as WeighinConfig),
        ).toThrow();
      });
    }
  });

  describe("enforceThresholds accepts valid rules that WeighinConfigSchema also accepts", () => {
    for (const { desc, rule } of ACCEPTED_RULES) {
      it(`accepts: ${desc}`, () => {
        // Exported schema accepts it
        expect(WeighinConfigSchema.safeParse(configWith(rule)).success).toBe(
          true,
        );
        // Runtime also accepts it (no throw)
        expect(() =>
          enforceThresholds(emptyDiff, configWith(rule) as WeighinConfig),
        ).not.toThrow();
      });
    }
  });

  // Category 6: unknown policy keys
  describe("both schema and runtime reject unknown policy keys", () => {
    it("rejects unknown top-level key", () => {
      const config = { unknown_key: true };
      expect(WeighinConfigSchema.safeParse(config).success).toBe(false);
      expect(() =>
        enforceThresholds(emptyDiff, config as unknown as WeighinConfig),
      ).toThrow();
    });

    it("rejects unknown metric key in function thresholds", () => {
      const config = {
        thresholds: { functions: { hello: { cpu_instruction: "ignore" } } },
      };
      expect(WeighinConfigSchema.safeParse(config).success).toBe(false);
      expect(() =>
        enforceThresholds(emptyDiff, config as unknown as WeighinConfig),
      ).toThrow();
    });
  });

  // Category 7: blank function selectors
  describe("both schema and runtime reject blank function selectors", () => {
    it("rejects blank string selector", () => {
      const config = {
        thresholds: { functions: { "": { cpu_instructions: "ignore" } } },
      };
      expect(WeighinConfigSchema.safeParse(config).success).toBe(false);
      expect(() =>
        enforceThresholds(emptyDiff, config as unknown as WeighinConfig),
      ).toThrow();
    });
  });

  // Category 8: valid function/global overrides
  describe("valid function/global overrides pass through both schema and runtime", () => {
    it("accepts max_allowed_cpu_increase_pct global rule", () => {
      const config: WeighinConfig = {
        thresholds: { global: { max_allowed_cpu_increase_pct: 5 } },
      };
      expect(WeighinConfigSchema.safeParse(config).success).toBe(true);
      expect(() => enforceThresholds(emptyDiff, config)).not.toThrow();
    });
  });

  // Category 9: absolute limits
  describe("valid absolute limits accepted by both schema and runtime", () => {
    it("accepts global absolute limit", () => {
      const config: WeighinConfig = {
        limits: { global: { cpu_instructions: 500000 } },
      };
      expect(WeighinConfigSchema.safeParse(config).success).toBe(true);
      expect(() => enforceThresholds(emptyDiff, config)).not.toThrow();
    });
  });

  // Category 11: fail-closed for unavailable values
  describe("fail-closed: unavailable metric with policy generates a violation", () => {
    it("unavailable metric + strict policy yields a violation (fail-closed)", () => {
      const diffWithUnavailable: DiffResult = {
        contracts: [
          {
            contract_id: "c1",
            base_commit: "abc",
            head_commit: "def",
            hasRegression: false,
            newFunctions: [],
            removedFunctions: [],
            functions: [
              {
                function_name: "hello",
                hasRegression: false,
                metrics: [
                  {
                    key: "cpu_instructions",
                    availability: "unavailable",
                    base: { consumed: null, limit: null },
                    head: { consumed: null, limit: null },
                    delta: null,
                    pct: null,
                    regression: false,
                    reason: "not measured",
                  },
                ],
              },
            ],
          },
        ],
        hasRegression: false,
        newContracts: [],
        removedContracts: [],
      };
      const config: WeighinConfig = {
        thresholds: {
          functions: { hello: { cpu_instructions: "strict_zero_tolerance" } },
        },
      };
      const violations = enforceThresholds(diffWithUnavailable, config);
      expect(violations).toHaveLength(1);
      expect(violations[0].metric).toBe("cpu_instructions");
      expect(violations[0].message).toMatch(/unavailable/);
    });
  });
});
