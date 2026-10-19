import { describe, it, expect } from "vitest";
import {
  enforceThresholds,
  GlobalThresholds,
  resolveEffectivePolicy,
  WeighinConfig,
} from "../src/threshold";
import { DiffResult, MetricKey } from "../src/diff";
import { renderComment } from "../src/comment";

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
        base_contract_id: "contract-a",
        head_contract_id: "contract-a",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        newBenchmarks: [],
        removedBenchmarks: [],
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

  describe("Effective policy and source reporting", () => {
    it("distinguishes absent policy from loaded empty policy and makes default report-only mode explicit", () => {
      const absentDiff = createMockDiff("cpu_instructions", 10, 10, true);
      expect(
        enforceThresholds(absentDiff, null, {
          mode: "head",
          path: "weighin.toml",
          revision: "def12345",
          present: false,
        }),
      ).toEqual([]);
      expect(absentDiff.policy?.status).toBe("absent");
      expect(absentDiff.policy?.evaluation_mode).toBe("report_only");
      expect(absentDiff.policy?.source).toEqual({
        mode: "head",
        path: "weighin.toml",
        revision: "def12345",
        present: false,
      });
      expect(absentDiff.policy?.functions[0].metrics.cpu_instructions).toEqual({
        metric: "cpu_instructions",
        regression_rule: "report_only",
        regression_rule_source: "default",
        absolute_limit: null,
        absolute_limit_source: "none",
        effective_mode: "report_only",
      });

      const emptyDiff = createMockDiff("cpu_instructions", 10, 10, true);
      expect(
        enforceThresholds(
          emptyDiff,
          { thresholds: {} },
          {
            mode: "head",
            path: "weighin.toml",
            revision: "def12345",
            content_sha256: "e3b0c442",
            present: true,
          },
        ),
      ).toEqual([]);
      expect(emptyDiff.policy?.status).toBe("empty");
      expect(emptyDiff.policy?.evaluation_mode).toBe("report_only");
      expect(emptyDiff.policy?.source).toEqual({
        mode: "head",
        path: "weighin.toml",
        revision: "def12345",
        content_sha256: "e3b0c442",
        present: true,
      });

      const absentReport = renderComment(absentDiff, [], "main", "def12345");
      expect(absentReport).toContain("### Effective Policy");
      expect(absentReport).toContain(
        "- **Policy status**: `absent` (no policy file loaded — **default report-only mode**, no thresholds or limits enforced)",
      );
      expect(absentReport).toContain(
        "- **Policy source**: mode `head`, path `weighin.toml` at `def12345` (absent)",
      );

      const emptyReport = renderComment(emptyDiff, [], "main", "def12345");
      expect(emptyReport).toContain(
        "- **Policy status**: `empty` (loaded policy contains no active rules or limits — **default report-only mode**, no thresholds or limits enforced)",
      );
      expect(emptyReport).toContain(
        "- **Policy source**: mode `head`, path `weighin.toml` at `def12345`, SHA256 `e3b0c442` (present)",
      );
    });

    it("records global rules, function overrides, explicit ignore, and default report-only in JSON and Markdown reports", () => {
      const diff = createMockDiff("cpu_instructions", 5, 5, true);
      const config: WeighinConfig = {
        limits: {
          global: { cpu_instructions: 1000, memory_bytes: 2048 },
          functions: { "test-fn": { memory_bytes: 512 } },
        },
        thresholds: {
          global: {
            max_allowed_cpu_increase_pct: 10,
            max_allowed_memory_increase_pct: 20,
          },
          functions: {
            "test-fn": {
              memory_bytes: "ignore",
              events_count: "strict_zero_tolerance",
            },
          },
        },
      };

      const violations = enforceThresholds(diff, config, {
        mode: "trusted",
        path: "ci/weighin.toml",
        revision: "99887766",
        content_sha256: "deadbeef",
      });
      expect(violations).toEqual([]);

      const policy = diff.policy!;
      expect(policy.status).toBe("configured");
      expect(policy.evaluation_mode).toBe("enforced");
      expect(policy.source).toEqual({
        mode: "trusted",
        path: "ci/weighin.toml",
        revision: "99887766",
        content_sha256: "deadbeef",
        present: true,
      });

      const fnMetrics = policy.functions[0].metrics;
      // Global threshold + global limit
      expect(fnMetrics.cpu_instructions).toEqual({
        metric: "cpu_instructions",
        regression_rule: "allow_10_percent_increase",
        regression_rule_source: "global",
        absolute_limit: 1000,
        absolute_limit_source: "global",
        effective_mode: "enforced",
      });
      // Function ignore override + function limit override
      expect(fnMetrics.memory_bytes).toEqual({
        metric: "memory_bytes",
        regression_rule: "ignore",
        regression_rule_source: "function",
        absolute_limit: 512,
        absolute_limit_source: "function",
        effective_mode: "enforced",
      });
      // Function strict_zero_tolerance override
      expect(fnMetrics.events_count).toEqual({
        metric: "events_count",
        regression_rule: "strict_zero_tolerance",
        regression_rule_source: "function",
        absolute_limit: null,
        absolute_limit_source: "none",
        effective_mode: "enforced",
      });
      // Unconfigured metric falls back to default report_only
      expect(fnMetrics.ledger_read_bytes).toEqual({
        metric: "ledger_read_bytes",
        regression_rule: "report_only",
        regression_rule_source: "default",
        absolute_limit: null,
        absolute_limit_source: "none",
        effective_mode: "report_only",
      });

      const markdown = renderComment(diff, violations, "main", "abcdef12");
      expect(markdown).toContain(
        "- **Policy status**: `configured` (evaluation mode: `enforced`)",
      );
      expect(markdown).toContain(
        "- **Policy source**: mode `trusted`, path `ci/weighin.toml` at `99887766`, SHA256 `deadbeef` (present)",
      );
      expect(markdown).toContain(
        "| `cpu_instructions` | `allow_10_percent_increase` | `global` | `1000` | `global` | `enforced` |",
      );
      expect(markdown).toContain(
        "| `memory_bytes` | `ignore` | `function` | `512` | `function` | `enforced` |",
      );
      expect(markdown).toContain(
        "| `events_count` | `strict_zero_tolerance` | `function` | `none` | `none` | `enforced` |",
      );
      expect(markdown).toContain(
        "| `ledger_read_bytes` | `report_only` | `default` | `none` | `none` | `report_only` |",
      );
    });

    it("reports ignored effective mode when a metric is explicitly ignored with no absolute limit and does not leak env secrets", () => {
      const prevSecret = process.env["SUPER_SECRET_TOKEN_FOR_TEST"];
      process.env["SUPER_SECRET_TOKEN_FOR_TEST"] = "ghp_do_not_disclose_12345";
      try {
        const diff = createMockDiff("cpu_instructions", 10, 10, true);
        const config: WeighinConfig = {
          thresholds: {
            global: { fail_on_any_regression: true },
            functions: { "test-fn": { cpu_instructions: "ignore" } },
          },
        };
        const policy = resolveEffectivePolicy(diff, config);
        expect(policy.functions[0].metrics.cpu_instructions).toEqual({
          metric: "cpu_instructions",
          regression_rule: "ignore",
          regression_rule_source: "function",
          absolute_limit: null,
          absolute_limit_source: "none",
          effective_mode: "ignored",
        });
        expect(policy.functions[0].metrics.memory_bytes).toEqual({
          metric: "memory_bytes",
          regression_rule: "fail_on_any_regression",
          regression_rule_source: "global",
          absolute_limit: null,
          absolute_limit_source: "none",
          effective_mode: "enforced",
        });
        expect(JSON.stringify(policy)).not.toContain(
          "ghp_do_not_disclose_12345",
        );
        const markdown = renderComment(
          { ...diff, policy },
          [],
          "main",
          "abcdef12",
        );
        expect(markdown).not.toContain("ghp_do_not_disclose_12345");
      } finally {
        if (prevSecret === undefined) {
          delete process.env["SUPER_SECRET_TOKEN_FOR_TEST"];
        } else {
          process.env["SUPER_SECRET_TOKEN_FOR_TEST"] = prevSecret;
        }
      }
    });
  });
});
