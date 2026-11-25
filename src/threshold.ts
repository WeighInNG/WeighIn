// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as TOML from "toml";
import { z } from "zod";
import { formatZodError, WeighinConfigSchema, parseAllowPct } from "./config";
import {
  DiffResult,
  METRIC_KEYS,
  MetricDiff,
  MetricKey,
  BenchmarkSelector,
  AggregateBudgetConfig,
  computeAggregateDiffs,
} from "./diff";
import { comparePercentageToLimit, percentageLimitText } from "./percentage";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * A rule value is either a named policy string or a numeric percentage cap.
 *
 * Named policies:
 *   "strict_zero_tolerance"     — any increase fails
 *   "allow_N_percent_increase"  — N% increase allowed (e.g. "allow_10_percent_increase")
 *   "ignore"                    — never fail on this metric
 */
export type RuleValue = string | number;

export interface GlobalThresholds {
  /** If true, any metric increase (even 1 unit) fails. Default false. */
  fail_on_any_regression?: boolean;
  /** Maximum allowed CPU increase as a percentage. */
  max_allowed_cpu_increase_pct?: number;
  /** Maximum allowed memory increase as a percentage. */
  max_allowed_memory_increase_pct?: number;
}

export interface WeighinConfig {
  limits?: {
    global?: Partial<Record<MetricKey, number>>;
    functions?: Record<string, Partial<Record<MetricKey, number>>>;
    aggregates?: Record<string, Partial<Record<MetricKey, number>>>;
  };
  thresholds?: {
    global?: GlobalThresholds;
    /** Per-function overrides keyed by function name */
    functions?: Record<string, Partial<Record<MetricKey, RuleValue>>>;
    aggregates?: Record<string, Partial<Record<MetricKey, RuleValue>>>;
  };
  aggregates?: Record<string, AggregateBudgetConfig>;
}

export interface PolicyOrigin {
  mode: "head" | "trusted";
  path: string;
  revision: string;
  content_sha256: string;
}

export type PolicyStatus = "absent" | "empty" | "active";

export interface ResolvedRule {
  target: "global" | string;
  metric: MetricKey;
  rule: RuleValue;
  source: "default" | "global" | "function_override" | "ignore";
}

export interface EffectivePolicyReport {
  status: PolicyStatus;
  mode?: "head" | "trusted";
  path?: string;
  revision?: string;
  content_sha256?: string;
  report_only: boolean;
  fail_on_any_regression?: boolean;
  rules: ResolvedRule[];
}

/** Validate policies independently of whether a benchmark happened to regress. */
export function validateConfig(
  value: unknown,
  filename = "weighin.toml",
): WeighinConfig {
  const parsed = WeighinConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error(formatZodError(parsed.error, filename));
  return parsed.data as WeighinConfig;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and parse weighin.toml. Returns null if the file does not exist
 * (no thresholds enforced). Throws on parse errors.
 */
export function loadConfig(configPath: string): WeighinConfig | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return validateConfig(TOML.parse(raw), configPath);
  } catch (error: any) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid WeighIn configuration")
    )
      throw error;
    throw new Error(`Failed to parse TOML in ${configPath}: ${error.message}`);
  }
}

/** Parse policy content while retaining a verifiable origin for reports. */
export function loadConfigContent(
  content: string,
  sourcePath: string,
): WeighinConfig {
  try {
    return validateConfig(TOML.parse(content), sourcePath);
  } catch (error: any) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid WeighIn configuration")
    )
      throw error;
    throw new Error(`Failed to parse TOML in ${sourcePath}: ${error.message}`);
  }
}

export function policyContentSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

export interface Violation {
  aggregate_id?: string;
  fixture_id?: string;
  logical_id?: string;
  case_id?: string;
  contract_id?: string;
  function_name?: string;
  metric: MetricKey;
  delta: number | null;
  pct: number | null;
  rule: string;
  rule_source?: string;
  message: string;
}

function evaluateRule(
  rule: RuleValue,
  diff: MetricDiff,
  contractId: string,
  functionName: string,
): Violation | null {
  const ruleStr =
    typeof rule === "number" ? `allow_${rule}_percent_increase` : rule;

  if (ruleStr === "ignore") return null;
  if (diff.availability === "unavailable") {
    return {
      contract_id: contractId,
      function_name: functionName,
      metric: diff.key,
      delta: null,
      pct: null,
      rule: ruleStr,
      message: `${diff.key} unavailable; cannot evaluate configured policy: ${diff.reason}`,
    };
  }
  if (!diff.regression) return null;

  if (ruleStr === "strict_zero_tolerance") {
    return {
      contract_id: contractId,
      function_name: functionName,
      metric: diff.key,
      delta: diff.delta,
      pct: diff.pct,
      rule: ruleStr,
      message: `${diff.key} increased by ${diff.delta} (strict zero tolerance)`,
    };
  }

  const allowedPct = typeof rule === "number" ? rule : parseAllowPct(ruleStr);
  if (allowedPct !== null) {
    let exceeded = diff.pct === null;
    if (!exceeded) {
      if (diff.delta === null || diff.base.consumed === null)
        throw new Error(
          `Cannot evaluate percentage rule ${ruleStr} for ${diff.key}: missing consumed value`,
        );
      exceeded =
        comparePercentageToLimit(diff.delta, diff.base.consumed, rule) > 0;
    }
    if (exceeded) {
      const pctStr = diff.pct === null ? "Infinity" : diff.pct.toFixed(2);
      return {
        contract_id: contractId,
        function_name: functionName,
        metric: diff.key,
        delta: diff.delta,
        pct: diff.pct,
        rule: ruleStr,
        message: `${diff.key} increased by ${pctStr}% (limit ${percentageLimitText(rule)}%)`,
      };
    }
    return null;
  }

  throw new Error(`Unsupported threshold rule "${ruleStr}" for ${diff.key}`);
}

// Map from global threshold fields to metric keys + default rules
const GLOBAL_RULE_MAP: Array<{
  field: keyof GlobalThresholds;
  metric: MetricKey;
  toRule: (val: number) => RuleValue;
}> = [
  {
    field: "max_allowed_cpu_increase_pct",
    metric: "cpu_instructions",
    toRule: (v) => v,
  },
  {
    field: "max_allowed_memory_increase_pct",
    metric: "memory_bytes",
    toRule: (v) => v,
  },
];

/**
 * Enforce all threshold rules against a DiffResult.
 * Returns the list of violations (empty = pass).
 */
export function enforceThresholds(
  diff: DiffResult,
  config: WeighinConfig | null,
): Violation[] {
  validateThresholdDiff(diff);
  if (config !== null) config = validateConfig(config);
  if (!config?.thresholds && !config?.limits && !config?.aggregates) return [];

  const global = config?.thresholds?.global ?? {};
  const perFunction = config?.thresholds?.functions ?? {};
  const globalLimits = config?.limits?.global ?? {};
  const functionLimits = config?.limits?.functions ?? {};
  const violations: Violation[] = [];

  // -------------------------------------------------------------------------
  // Aggregate threshold & limit enforcement
  // -------------------------------------------------------------------------
  const hasAggregatesConfig =
    Boolean(config?.aggregates && Object.keys(config.aggregates).length > 0) ||
    Boolean(
      config?.limits?.aggregates &&
      Object.keys(config.limits.aggregates).length > 0,
    ) ||
    Boolean(
      config?.thresholds?.aggregates &&
      Object.keys(config.thresholds.aggregates).length > 0,
    );

  if (hasAggregatesConfig) {
    if (!diff.aggregates) {
      computeAggregateDiffs(diff, config);
    }

    const aggregateLimits = config?.limits?.aggregates ?? {};
    const aggregateThresholds = config?.thresholds?.aggregates ?? {};

    for (const aggDiff of diff.aggregates ?? []) {
      const name = aggDiff.name;
      const aggConfig = config?.aggregates?.[name];
      const limits = { ...aggConfig?.limits, ...aggregateLimits[name] };
      const thresholds = {
        ...aggConfig?.thresholds,
        ...aggregateThresholds[name],
      };

      // 1. Absolute limits
      for (const [metricKeyStr, limit] of Object.entries(limits)) {
        const metricKey = metricKeyStr as MetricKey;
        if (limit === undefined) continue;

        const aggMetric = aggDiff.metrics.find((m) => m.key === metricKey);
        if (
          !aggMetric ||
          aggMetric.availability === "unavailable" ||
          aggMetric.head_consumed === null
        ) {
          violations.push({
            aggregate_id: name,
            metric: metricKey,
            delta: null,
            pct: null,
            rule: `absolute_limit(${limit})`,
            rule_source: `aggregates.${name}.limits.${metricKey}`,
            message: `${metricKey} unavailable; cannot evaluate configured aggregate absolute limit: ${aggMetric?.reason ?? "measured value unavailable"}`,
          });
        } else if (aggMetric.head_consumed > limit) {
          violations.push({
            aggregate_id: name,
            metric: metricKey,
            delta: aggMetric.head_consumed - limit,
            pct: null,
            rule: `absolute_limit(${limit})`,
            rule_source: `aggregates.${name}.limits.${metricKey}`,
            message: `${metricKey} exceeded aggregate absolute limit: limit ${limit}, actual ${aggMetric.head_consumed}`,
          });
        }
      }

      // 2. Relative thresholds
      for (const [metricKeyStr, rule] of Object.entries(thresholds)) {
        const metricKey = metricKeyStr as MetricKey;
        if (rule === undefined) continue;

        const ruleStr =
          typeof rule === "number" ? `allow_${rule}_percent_increase` : rule;
        if (ruleStr === "ignore") continue;

        const aggMetric = aggDiff.metrics.find((m) => m.key === metricKey);
        if (!aggMetric || aggMetric.availability === "unavailable") {
          violations.push({
            aggregate_id: name,
            metric: metricKey,
            delta: null,
            pct: null,
            rule: ruleStr,
            rule_source: `aggregates.${name}.thresholds.${metricKey}`,
            message: `${metricKey} unavailable; cannot evaluate configured aggregate policy: ${aggMetric?.reason ?? "measured value unavailable"}`,
          });
          continue;
        }

        if (!aggMetric.regression) continue;

        if (ruleStr === "strict_zero_tolerance") {
          violations.push({
            aggregate_id: name,
            metric: metricKey,
            delta: aggMetric.delta,
            pct: aggMetric.pct,
            rule: ruleStr,
            rule_source: `aggregates.${name}.thresholds.${metricKey}`,
            message: `${metricKey} increased by ${aggMetric.delta} (strict zero tolerance)`,
          });
          continue;
        }

        const allowedPct =
          typeof rule === "number" ? rule : parseAllowPct(ruleStr);
        if (allowedPct !== null) {
          let exceeded = aggMetric.pct === null;
          if (!exceeded) {
            if (aggMetric.delta === null || aggMetric.base_consumed === null)
              throw new Error(
                `Cannot evaluate aggregate percentage rule ${ruleStr} for ${metricKey}: missing consumed value`,
              );
            exceeded =
              comparePercentageToLimit(
                aggMetric.delta,
                aggMetric.base_consumed,
                rule,
              ) > 0;
          }
          if (exceeded) {
            const pctStr =
              aggMetric.pct === null ? "Infinity" : aggMetric.pct.toFixed(2);
            violations.push({
              aggregate_id: name,
              metric: metricKey,
              delta: aggMetric.delta,
              pct: aggMetric.pct,
              rule: ruleStr,
              rule_source: `aggregates.${name}.thresholds.${metricKey}`,
              message: `${metricKey} increased by ${pctStr}% (limit ${percentageLimitText(rule)}%)`,
            });
          }
        }
      }
    }
  }

  const comparedNames = new Set(
    diff.contracts.flatMap((contract) =>
      contract.functions.map((fn) => fn.function_name),
    ),
  );
  for (const [name, rules] of Object.entries(perFunction)) {
    if (
      Object.values(rules).some((rule) => rule !== "ignore") &&
      !comparedNames.has(name)
    ) {
      throw new Error(
        `Cannot evaluate configured policy: function ${name} has no matched BASE/HEAD benchmark`,
      );
    }
  }
  for (const [name, limits] of Object.entries(functionLimits)) {
    if (Object.keys(limits).length > 0 && !comparedNames.has(name)) {
      throw new Error(
        `Cannot evaluate configured limits: function ${name} has no matched BASE/HEAD benchmark`,
      );
    }
  }
  if (
    (global.fail_on_any_regression ||
      GLOBAL_RULE_MAP.some(({ field }) => global[field] !== undefined) ||
      Object.keys(globalLimits).length > 0) &&
    comparedNames.size === 0
  ) {
    throw new Error(
      "Cannot evaluate configured global policy or limits: no matched BASE/HEAD benchmarks",
    );
  }

  for (const contract of diff.contracts) {
    for (const fn of contract.functions) {
      const identity = {
        fixture_id: contract.fixture_id,
        logical_id: contract.logical_id,
        case_id: fn.case_id,
      };
      for (const metricDiff of fn.metrics) {
        const absoluteLimit =
          functionLimits[fn.function_name]?.[metricDiff.key] ??
          globalLimits[metricDiff.key];
        if (absoluteLimit !== undefined) {
          if (
            metricDiff.availability === "unavailable" ||
            metricDiff.head.consumed === null
          ) {
            violations.push({
              ...identity,
              contract_id: contract.contract_id,
              function_name: fn.function_name,
              metric: metricDiff.key,
              delta: null,
              pct: null,
              rule: `absolute_limit(${absoluteLimit})`,
              message: `${metricDiff.key} unavailable; cannot evaluate configured absolute limit: ${metricDiff.reason ?? "measured value unavailable"}`,
            });
          } else if (metricDiff.head.consumed > absoluteLimit) {
            violations.push({
              ...identity,
              contract_id: contract.contract_id,
              function_name: fn.function_name,
              metric: metricDiff.key,
              delta: metricDiff.head.consumed - absoluteLimit,
              pct: null,
              rule: `absolute_limit(${absoluteLimit})`,
              message: `${metricDiff.key} exceeded absolute limit: limit ${absoluteLimit}, actual ${metricDiff.head.consumed}`,
            });
          }
        }
        // 1. Per-function overrides take priority over global rules
        const fnOverrides = perFunction[fn.function_name];
        const fnRule = fnOverrides?.[metricDiff.key];
        if (fnRule !== undefined) {
          const v = evaluateRule(
            fnRule,
            metricDiff,
            contract.contract_id,
            fn.function_name,
          );
          if (v) violations.push({ ...v, ...identity });
          continue;
        }

        // 2. Global fail_on_any_regression
        if (
          global.fail_on_any_regression &&
          (metricDiff.regression || metricDiff.availability === "unavailable")
        ) {
          violations.push({
            ...identity,
            contract_id: contract.contract_id,
            function_name: fn.function_name,
            metric: metricDiff.key,
            delta: metricDiff.delta,
            pct: metricDiff.pct,
            rule: "fail_on_any_regression",
            message:
              metricDiff.availability === "unavailable"
                ? `${metricDiff.key} unavailable; cannot evaluate fail_on_any_regression: ${metricDiff.reason}`
                : `${metricDiff.key} increased by ${metricDiff.delta} (fail_on_any_regression)`,
          });
          continue;
        }

        // 3. Named global rules (cpu, memory caps)
        for (const { field, metric, toRule } of GLOBAL_RULE_MAP) {
          if (metricDiff.key !== metric) continue;
          const val = global[field];
          if (val !== undefined) {
            const v = evaluateRule(
              toRule(val as number),
              metricDiff,
              contract.contract_id,
              fn.function_name,
            );
            if (v) violations.push({ ...v, ...identity });
          }
        }
      }
    }
  }

  return violations;
}

/** Validate every derived metric at the public policy boundary. Callers may
 * pass a DiffResult directly, so policy must not trust its derived flags.
 */
function validateThresholdDiff(diff: DiffResult): void {
  const invalid = (path: string, detail: string): never => {
    throw new Error(`Invalid DiffResult at ${path}: ${detail}`);
  };
  if (!diff || typeof diff !== "object" || !Array.isArray(diff.contracts)) {
    invalid("contracts", "expected an array");
  }
  const contractRegressions: boolean[] = [];
  diff.contracts.forEach((contract, ci) => {
    if (
      !contract ||
      typeof contract !== "object" ||
      !Array.isArray(contract.functions)
    ) {
      invalid(`contracts[${ci}].functions`, "expected an array");
    }
    const functionRegressions: boolean[] = [];
    contract.functions.forEach((fn, fi) => {
      if (!fn || typeof fn !== "object" || !Array.isArray(fn.metrics)) {
        invalid(
          `contracts[${ci}].functions[${fi}].metrics`,
          "expected an array",
        );
      }
      const byKey = new Map<MetricKey, MetricDiff>();
      fn.metrics.forEach((metric, mi) => {
        const path = `contracts[${ci}].functions[${fi}].metrics[${mi}]`;
        if (
          !metric ||
          !METRIC_KEYS.includes(metric.key) ||
          byKey.has(metric.key)
        ) {
          invalid(`${path}.key`, "expected one unique supported metric key");
        }
        byKey.set(metric.key, metric);
        for (const side of ["base", "head"] as const) {
          const value = metric[side];
          if (
            !value ||
            !(
              value.consumed === null ||
              (typeof value.consumed === "number" &&
                Number.isFinite(value.consumed) &&
                value.consumed >= 0)
            ) ||
            !(
              value.limit === null ||
              (typeof value.limit === "number" &&
                Number.isFinite(value.limit) &&
                value.limit >= 0)
            )
          ) {
            invalid(
              `${path}.${side}`,
              "consumed and limit must be finite nonnegative numbers or null",
            );
          }
          if (
            value.availability !== undefined &&
            ((value.availability !== "measured" &&
              value.availability !== "unavailable") ||
              (value.availability === "measured") !== (value.consumed !== null))
          ) {
            invalid(
              `${path}.${side}.availability`,
              "must agree with whether consumed is measured or unavailable",
            );
          }
        }
        const base = metric.base.consumed;
        const head = metric.head.consumed;
        const comparable = base !== null && head !== null;
        const expectedDelta = comparable ? head - base : null;
        const expectedPct =
          comparable && base !== 0 ? (expectedDelta! / base) * 100 : null;
        const expectedAvailability = comparable ? "comparable" : "unavailable";
        const problems: string[] = [];
        if (metric.availability !== expectedAvailability)
          problems.push("availability");
        if (metric.delta !== expectedDelta) problems.push("delta");
        if (metric.pct !== expectedPct) problems.push("pct");
        if (metric.regression !== (comparable && expectedDelta! > 0))
          problems.push("regression");
        if (problems.length)
          invalid(
            path,
            `${problems.join(", ")} contradict base/head consumed values`,
          );
        if (!comparable && typeof metric.reason !== "string") {
          invalid(`${path}.reason`, "unavailable metrics require a reason");
        }
      });
      if (
        byKey.size !== METRIC_KEYS.length ||
        METRIC_KEYS.some((key) => !byKey.has(key))
      ) {
        invalid(
          `contracts[${ci}].functions[${fi}].metrics`,
          "all supported metrics are required exactly once",
        );
      }
      const hasRegression = fn.metrics.some((metric) => metric.regression);
      if (fn.hasRegression !== hasRegression) {
        invalid(
          `contracts[${ci}].functions[${fi}].hasRegression`,
          "does not match metric regression flags",
        );
      }
      functionRegressions.push(hasRegression);
    });
    const hasRegression = functionRegressions.some(Boolean);
    if (contract.hasRegression !== hasRegression) {
      invalid(
        `contracts[${ci}].hasRegression`,
        "does not match function regression flags",
      );
    }
    contractRegressions.push(hasRegression);
  });
  if (diff.aggregates !== undefined && !Array.isArray(diff.aggregates)) {
    invalid("aggregates", "expected an array when present");
  }
  const aggregateRegressions = (diff.aggregates ?? []).map((aggregate, ai) => {
    const aggregatePath = `aggregates[${ai}]`;
    if (
      !aggregate ||
      typeof aggregate !== "object" ||
      !Array.isArray(aggregate.metrics)
    ) {
      invalid(`${aggregatePath}.metrics`, "expected an array");
    }
    const byKey = new Map<MetricKey, (typeof aggregate.metrics)[number]>();
    aggregate.metrics.forEach((metric, mi) => {
      const path = `${aggregatePath}.metrics[${mi}]`;
      if (
        !metric ||
        !METRIC_KEYS.includes(metric.key) ||
        byKey.has(metric.key)
      ) {
        invalid(`${path}.key`, "expected one unique supported metric key");
      }
      byKey.set(metric.key, metric);
      const base = metric.base_consumed;
      const head = metric.head_consumed;
      const comparable = base !== null && head !== null;
      if (
        !(base === null || (Number.isFinite(base) && base >= 0)) ||
        !(head === null || (Number.isFinite(head) && head >= 0))
      ) {
        invalid(
          path,
          "base/head consumed values must be finite nonnegative numbers or null",
        );
      }
      const expectedDelta = comparable ? head - base : null;
      const expectedPct = comparable
        ? base === 0
          ? expectedDelta! > 0
            ? null
            : 0
          : (expectedDelta! / base) * 100
        : null;
      const expectedAvailability = comparable ? "comparable" : "unavailable";
      if (
        metric.availability !== expectedAvailability ||
        metric.delta !== expectedDelta ||
        metric.pct !== expectedPct ||
        metric.regression !== (comparable && expectedDelta! > 0)
      ) {
        invalid(
          path,
          "availability, delta, pct, or regression contradict aggregate base/head values",
        );
      }
      if (!comparable && typeof metric.reason !== "string") {
        invalid(`${path}.reason`, "unavailable metrics require a reason");
      }
    });
    if (
      byKey.size !== METRIC_KEYS.length ||
      METRIC_KEYS.some((key) => !byKey.has(key))
    ) {
      invalid(
        `${aggregatePath}.metrics`,
        "all supported metrics are required exactly once",
      );
    }
    const hasRegression = aggregate.metrics.some((metric) => metric.regression);
    if (aggregate.hasRegression !== hasRegression) {
      invalid(
        `${aggregatePath}.hasRegression`,
        "does not match metric regression flags",
      );
    }
    return hasRegression;
  });
  const hasRegression =
    contractRegressions.some(Boolean) || aggregateRegressions.some(Boolean);
  if (diff.hasRegression !== hasRegression) {
    invalid("hasRegression", "does not match nested regression flags");
  }
}

/**
 * Resolve the effective policy applied to a diff run into a structured, reportable form.
 * Does not disclose unrelated configuration tokens or non-policy parameters.
 */
export function resolveEffectivePolicy(
  diff: DiffResult,
  config: WeighinConfig | null,
  origin?: PolicyOrigin | null,
): EffectivePolicyReport {
  if (!config) {
    return {
      status: "absent",
      report_only: true,
      rules: [],
    };
  }

  const global = config.thresholds?.global ?? {};
  const perFunction = config.thresholds?.functions ?? {};
  const globalLimits = config.limits?.global ?? {};
  const functionLimits = config.limits?.functions ?? {};

  const hasRules =
    Boolean(global.fail_on_any_regression) ||
    GLOBAL_RULE_MAP.some(({ field }) => global[field] !== undefined) ||
    Object.keys(perFunction).length > 0 ||
    Object.keys(globalLimits).length > 0 ||
    Object.keys(functionLimits).length > 0;

  if (!hasRules) {
    return {
      status: "empty",
      mode: origin?.mode,
      path: origin?.path,
      revision: origin?.revision,
      content_sha256: origin?.content_sha256,
      report_only: true,
      rules: [],
    };
  }

  const rules: ResolvedRule[] = [];

  // Global absolute limits
  for (const [metric, limit] of Object.entries(globalLimits)) {
    if (limit !== undefined) {
      rules.push({
        target: "global",
        metric: metric as MetricKey,
        rule: `absolute_limit(${limit})`,
        source: "global",
      });
    }
  }

  // Global thresholds
  if (global.fail_on_any_regression) {
    for (const key of METRIC_KEYS) {
      rules.push({
        target: "global",
        metric: key,
        rule: "fail_on_any_regression",
        source: "global",
      });
    }
  }
  for (const { field, metric, toRule } of GLOBAL_RULE_MAP) {
    const val = global[field];
    if (typeof val === "number") {
      rules.push({
        target: "global",
        metric,
        rule: toRule(val),
        source: "global",
      });
    }
  }

  // Function limits & overrides
  for (const contract of diff.contracts) {
    for (const fn of contract.functions) {
      const fnLimits = functionLimits[fn.function_name];
      if (fnLimits) {
        for (const [metric, limit] of Object.entries(fnLimits)) {
          if (limit !== undefined) {
            rules.push({
              target: fn.function_name,
              metric: metric as MetricKey,
              rule: `absolute_limit(${limit})`,
              source: "function_override",
            });
          }
        }
      }

      const fnOverrides = perFunction[fn.function_name];
      if (fnOverrides) {
        for (const [metric, ruleVal] of Object.entries(fnOverrides)) {
          if (ruleVal !== undefined) {
            rules.push({
              target: fn.function_name,
              metric: metric as MetricKey,
              rule: ruleVal,
              source: ruleVal === "ignore" ? "ignore" : "function_override",
            });
          }
        }
      }
    }
  }

  return {
    status: "active",
    mode: origin?.mode,
    path: origin?.path,
    revision: origin?.revision,
    content_sha256: origin?.content_sha256,
    report_only: false,
    fail_on_any_regression: global.fail_on_any_regression,
    rules,
  };
}
