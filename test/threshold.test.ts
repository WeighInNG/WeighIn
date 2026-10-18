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

  describe("Exact percentage boundaries without floating-point distortion", () => {
    function createExactDiff(
      key: MetricKey,
      baseConsumed: number,
      headConsumed: number,
    ): DiffResult {
      const delta = headConsumed - baseConsumed;
      const pct = baseConsumed === 0 ? null : (delta / baseConsumed) * 100;
      const regression = delta > 0;
      return {
        contracts: [
          {
            contract_id: "contract-exact",
            base_commit: "base",
            head_commit: "head",
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
                    base: { consumed: baseConsumed, limit: 0 },
                    head: { consumed: headConsumed, limit: 0 },
                    delta,
                    pct,
                    regression,
                    availability: "comparable",
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

    it("evaluates exact boundary cleanly where float division rounds up (2.9% boundary)", () => {
      // 29 / 1000 * 100 in float is 2.9000000000000004 > 2.9
      const boundaryDiff = createExactDiff("cpu_instructions", 1000, 1029);
      const configPass: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_2.9_percent_increase" },
          },
        },
      };
      expect(enforceThresholds(boundaryDiff, configPass)).toEqual([]);

      const exceededDiff = createExactDiff("cpu_instructions", 1000, 1030);
      const violations = enforceThresholds(exceededDiff, configPass);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("allow_2.9_percent_increase");
    });

    it("evaluates exact decimal boundary for 0.1% increase (7 / 7000)", () => {
      // 7 / 7000 * 100 in float can distort against 0.1
      const boundaryDiff = createExactDiff("cpu_instructions", 7000, 7007);
      const configPass: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: 0.1 },
          },
        },
      };
      expect(enforceThresholds(boundaryDiff, configPass)).toEqual([]);

      const exceededDiff = createExactDiff("cpu_instructions", 7000, 7008);
      const violations = enforceThresholds(exceededDiff, configPass);
      expect(violations).toHaveLength(1);
    });

    it("evaluates nonrepresentable thirds cleanly (1/3 increase)", () => {
      // 1 / 3 is nonrepresentable as a terminating decimal
      const thirdDiff = createExactDiff("cpu_instructions", 3, 4);

      // Exact fractional rate passes
      const configFraction: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_100/3_percent_increase" },
          },
        },
      };
      expect(enforceThresholds(thirdDiff, configFraction)).toEqual([]);

      // JS numeric 100 / 3 passes
      const configNumeric: WeighinConfig = {
        thresholds: {
          global: { max_allowed_cpu_increase_pct: 100 / 3 },
        },
      };
      expect(enforceThresholds(thirdDiff, configNumeric)).toEqual([]);

      // 33.34% allows up to 0.3334, so 1/3 (0.33333...) passes
      const config33_34: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_33.34_percent_increase" },
          },
        },
      };
      expect(enforceThresholds(thirdDiff, config33_34)).toEqual([]);

      // 33.33% allows up to 0.3333, but 1/3 is strictly greater, so it fails
      const config33_33: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_33.33_percent_increase" },
          },
        },
      };
      const violations = enforceThresholds(thirdDiff, config33_33);
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe("allow_33.33_percent_increase");
    });

    it("evaluates values near safe-integer limits with exact precision", () => {
      const baseQuadrillion = 8_000_000_000_000_000;
      const deltaQuadrillion = 800_000_000_000_000; // exactly 10%
      const boundaryDiff = createExactDiff(
        "cpu_instructions",
        baseQuadrillion,
        baseQuadrillion + deltaQuadrillion,
      );

      const config10: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_10_percent_increase" },
          },
        },
      };
      expect(enforceThresholds(boundaryDiff, config10)).toEqual([]);

      // One single unit more at 9 quadrillion exceeds the exact 10% limit
      const exceededDiff = createExactDiff(
        "cpu_instructions",
        baseQuadrillion,
        baseQuadrillion + deltaQuadrillion + 1,
      );
      const violations = enforceThresholds(exceededDiff, config10);
      expect(violations).toHaveLength(1);
    });

    it("evaluates nonrepresentable thirds near safe-integer limits", () => {
      const base3Quadrillion = 3_000_000_000_000_000;
      const delta1Quadrillion = 1_000_000_000_000_000; // exact 1/3
      const thirdDiff = createExactDiff(
        "memory_bytes",
        base3Quadrillion,
        base3Quadrillion + delta1Quadrillion,
      );

      const configThird: WeighinConfig = {
        thresholds: {
          global: { max_allowed_memory_increase_pct: 100 / 3 },
        },
      };
      expect(enforceThresholds(thirdDiff, configThird)).toEqual([]);

      // One unit above 1/3 at quadrillions fails
      const exceededThirdDiff = createExactDiff(
        "memory_bytes",
        base3Quadrillion,
        base3Quadrillion + delta1Quadrillion + 1,
      );
      const violations = enforceThresholds(exceededThirdDiff, configThird);
      expect(violations).toHaveLength(1);
    });

    it("keeps displayed rounded percentage separate from pass/fail semantics", () => {
      const thirdDiff = createExactDiff("cpu_instructions", 3, 4);
      const config33_33: WeighinConfig = {
        thresholds: {
          functions: {
            "test-fn": { cpu_instructions: "allow_33.33_percent_increase" },
          },
        },
      };
      const violations = enforceThresholds(thirdDiff, config33_33);
      expect(violations).toHaveLength(1);
      // Displayed percentage is formatted to 2 decimals (33.33%) even though exact decision failed
      expect(violations[0].message).toContain("33.33%");
      expect(violations[0].message).toContain("limit 33.33%");
    });
  });
});
