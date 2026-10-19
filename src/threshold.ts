import * as fs from "fs";
import * as TOML from "toml";
import { z } from "zod";
import { formatZodError } from "./config";
import { DiffResult, METRIC_KEYS, MetricDiff, MetricKey } from "./diff";

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
  };
  thresholds?: {
    global?: GlobalThresholds;
    /** Per-function overrides keyed by function name */
    functions?: Record<string, Partial<Record<MetricKey, RuleValue>>>;
  };
}

const percentage = z.number().finite().nonnegative();
const ruleSchema = z.union([
  percentage,
  z
    .string()
    .refine(
      (value) =>
        value === "ignore" ||
        value === "strict_zero_tolerance" ||
        parseAllowPct(value) !== null,
      "Unsupported threshold rule",
    ),
]);
const metricRules = z
  .object(
    Object.fromEntries(METRIC_KEYS.map((key) => [key, ruleSchema.optional()])),
  )
  .strict();
const configSchema = z
  .object({
    limits: z
      .object({
        global: z.record(z.enum(METRIC_KEYS), percentage).optional(),
        functions: z
          .record(z.string().min(1), z.record(z.enum(METRIC_KEYS), percentage))
          .optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        global: z
          .object({
            fail_on_any_regression: z.boolean().optional(),
            max_allowed_cpu_increase_pct: percentage.optional(),
            max_allowed_memory_increase_pct: percentage.optional(),
          })
          .strict()
          .optional(),
        functions: z.record(z.string().min(1), metricRules).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Validate policies independently of whether a benchmark happened to regress. */
export function validateConfig(value: unknown): WeighinConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(formatZodError(parsed.error, "weighin.toml"));
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
    return validateConfig(TOML.parse(raw));
  } catch (error: any) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid WeighIn configuration")
    )
      throw error;
    throw new Error(`Failed to parse TOML in ${configPath}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

export interface Violation {
  fixture_id?: string;
  logical_id?: string;
  case_id?: string;
  contract_id: string;
  function_name: string;
  metric: MetricKey;
  delta: number | null;
  pct: number | null;
  rule: string;
  message: string;
}

function parseAllowPct(rule: string): number | null {
  // Matches "allow_10_percent_increase", "allow_2.5_percent_increase", etc.
  const m = rule.match(/^allow_(\d+(?:\.\d+)?)_percent_increase$/);
  const value = m ? Number(m[1]) : NaN;
  return Number.isFinite(value) ? value : null;
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
    if (diff.pct === null || diff.pct > allowedPct) {
      const pctStr = diff.pct === null ? "Infinity" : diff.pct.toFixed(2);
      return {
        contract_id: contractId,
        function_name: functionName,
        metric: diff.key,
        delta: diff.delta,
        pct: diff.pct,
        rule: ruleStr,
        message: `${diff.key} increased by ${pctStr}% (limit ${allowedPct}%)`,
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

export type PolicyStatus = "absent" | "empty" | "configured";
export type PolicyEvaluationMode = "report_only" | "enforced";
export type RuleSource = "default" | "global" | "function";
export type LimitSource = "none" | "global" | "function";

export interface PolicySourceSummary {
  mode: "head" | "trusted" | "inline" | "none";
  path: string | null;
  revision?: string;
  content_sha256?: string;
  present: boolean;
}

export interface ResolvedMetricPolicy {
  metric: MetricKey;
  regression_rule: string;
  regression_rule_source: RuleSource;
  absolute_limit: number | null;
  absolute_limit_source: LimitSource;
  effective_mode: "report_only" | "ignored" | "enforced";
}

export interface ResolvedFunctionPolicy {
  fixture_id?: string;
  logical_id?: string;
  contract_id: string;
  function_name: string;
  case_id?: string;
  metrics: Record<MetricKey, ResolvedMetricPolicy>;
}

export interface EffectivePolicyReport {
  status: PolicyStatus;
  evaluation_mode: PolicyEvaluationMode;
  source: PolicySourceSummary;
  configured: {
    global_thresholds: {
      fail_on_any_regression: boolean;
      max_allowed_cpu_increase_pct: number | null;
      max_allowed_memory_increase_pct: number | null;
    };
    global_limits: Partial<Record<MetricKey, number>>;
    function_thresholds: Record<string, Partial<Record<MetricKey, string>>>;
    function_limits: Record<string, Partial<Record<MetricKey, number>>>;
  };
  functions: ResolvedFunctionPolicy[];
}

declare module "./diff" {
  interface DiffResult {
    policy?: EffectivePolicyReport;
  }
}

function normalizeRuleName(rule: RuleValue): string {
  return typeof rule === "number" ? `allow_${rule}_percent_increase` : rule;
}

function comparePolicyStrings(a?: string, b?: string): number {
  const sa = a ?? "";
  const sb = b ?? "";
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function resolvePolicySource(
  diff: DiffResult,
  config: WeighinConfig | null,
  origin?: Partial<PolicyOrigin> & {
    mode?: "head" | "trusted" | "inline" | "none";
    path?: string | null;
    present?: boolean;
  },
): PolicySourceSummary {
  if (origin) {
    const present =
      typeof origin.present === "boolean" ? origin.present : config !== null;
    const mode =
      origin.mode ?? (present ? ("inline" as const) : ("none" as const));
    return {
      mode,
      path: origin.path ?? null,
      ...(origin.revision ? { revision: origin.revision } : {}),
      ...(origin.content_sha256
        ? { content_sha256: origin.content_sha256 }
        : {}),
      present,
    };
  }
  const inActionRun =
    /\bat run \(/.test(new Error().stack ?? "") &&
    Boolean(process.env["GITHUB_WORKSPACE"]);
  if (inActionRun) {
    const trustedRef = process.env["INPUT_TRUSTED-POLICY-REF"]?.trim() || "";
    const trustedPath = process.env["INPUT_TRUSTED-POLICY-PATH"]?.trim() || "";
    const configPathRel = (
      process.env["INPUT_CONFIG-PATH"]?.trim() || "weighin.toml"
    )
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");
    const headCommit = diff.contracts[0]?.head_commit;
    if (trustedRef && trustedPath) {
      return {
        mode: "trusted",
        path: trustedPath,
        ...(headCommit ? { revision: headCommit } : {}),
        present: config !== null,
      };
    }
    return {
      mode: "head",
      path: configPathRel,
      ...(headCommit ? { revision: headCommit } : {}),
      present: config !== null,
    };
  }
  if (config === null) {
    return {
      mode: "none",
      path: null,
      present: false,
    };
  }
  return {
    mode: "inline",
    path: null,
    present: true,
  };
}

/**
 * Resolve the effective policy summary and per-function/per-metric rules for a comparison report.
 */
export function resolveEffectivePolicy(
  diff: DiffResult,
  config: WeighinConfig | null,
  origin?: Partial<PolicyOrigin> & {
    mode?: "head" | "trusted" | "inline" | "none";
    path?: string | null;
    present?: boolean;
  },
): EffectivePolicyReport {
  const validated = config !== null ? validateConfig(config) : null;
  const global = validated?.thresholds?.global ?? {};
  const perFunction = validated?.thresholds?.functions ?? {};
  const globalLimits = validated?.limits?.global ?? {};
  const functionLimits = validated?.limits?.functions ?? {};

  const source = resolvePolicySource(diff, validated, origin);

  const normalizedFunctionThresholds: Record<
    string,
    Partial<Record<MetricKey, string>>
  > = {};
  for (const fnName of Object.keys(perFunction).sort(comparePolicyStrings)) {
    const fnRules = perFunction[fnName] ?? {};
    const entry: Partial<Record<MetricKey, string>> = {};
    for (const key of METRIC_KEYS) {
      const ruleVal = fnRules[key];
      if (ruleVal !== undefined) {
        entry[key] = normalizeRuleName(ruleVal);
      }
    }
    if (Object.keys(entry).length > 0) {
      normalizedFunctionThresholds[fnName] = entry;
    }
  }

  const normalizedGlobalLimits: Partial<Record<MetricKey, number>> = {};
  for (const key of METRIC_KEYS) {
    if (globalLimits[key] !== undefined) {
      normalizedGlobalLimits[key] = globalLimits[key];
    }
  }

  const normalizedFunctionLimits: Record<
    string,
    Partial<Record<MetricKey, number>>
  > = {};
  for (const fnName of Object.keys(functionLimits).sort(comparePolicyStrings)) {
    const fnLims = functionLimits[fnName] ?? {};
    const entry: Partial<Record<MetricKey, number>> = {};
    for (const key of METRIC_KEYS) {
      if (fnLims[key] !== undefined) {
        entry[key] = fnLims[key];
      }
    }
    if (Object.keys(entry).length > 0) {
      normalizedFunctionLimits[fnName] = entry;
    }
  }

  const hasConfiguredRules =
    Boolean(global.fail_on_any_regression) ||
    global.max_allowed_cpu_increase_pct !== undefined ||
    global.max_allowed_memory_increase_pct !== undefined ||
    Object.keys(normalizedFunctionThresholds).length > 0 ||
    Object.keys(normalizedGlobalLimits).length > 0 ||
    Object.keys(normalizedFunctionLimits).length > 0;

  const status: PolicyStatus = !source.present
    ? "absent"
    : hasConfiguredRules
      ? "configured"
      : "empty";

  const sortedContracts = [...diff.contracts].sort(
    (a, b) =>
      comparePolicyStrings(a.fixture_id, b.fixture_id) ||
      comparePolicyStrings(a.logical_id, b.logical_id) ||
      comparePolicyStrings(a.contract_id, b.contract_id),
  );

  const functions: ResolvedFunctionPolicy[] = [];
  for (const contract of sortedContracts) {
    const sortedFns = [...contract.functions].sort(
      (a, b) =>
        comparePolicyStrings(a.function_name, b.function_name) ||
        comparePolicyStrings(a.case_id, b.case_id),
    );
    for (const fn of sortedFns) {
      const fnOverrides = perFunction[fn.function_name];
      const fnLimitOverrides = functionLimits[fn.function_name];
      const metricsMap = {} as Record<MetricKey, ResolvedMetricPolicy>;

      for (const metricKey of METRIC_KEYS) {
        let regressionRule = "report_only";
        let regressionRuleSource: RuleSource = "default";

        const fnRule = fnOverrides?.[metricKey];
        if (fnRule !== undefined) {
          regressionRule = normalizeRuleName(fnRule);
          regressionRuleSource = "function";
        } else if (global.fail_on_any_regression) {
          regressionRule = "fail_on_any_regression";
          regressionRuleSource = "global";
        } else {
          for (const { field, metric, toRule } of GLOBAL_RULE_MAP) {
            if (metricKey === metric && global[field] !== undefined) {
              regressionRule = normalizeRuleName(
                toRule(global[field] as number),
              );
              regressionRuleSource = "global";
              break;
            }
          }
        }

        let absoluteLimit: number | null = null;
        let absoluteLimitSource: LimitSource = "none";
        if (fnLimitOverrides?.[metricKey] !== undefined) {
          absoluteLimit = fnLimitOverrides[metricKey]!;
          absoluteLimitSource = "function";
        } else if (globalLimits[metricKey] !== undefined) {
          absoluteLimit = globalLimits[metricKey]!;
          absoluteLimitSource = "global";
        }

        const effectiveMode: "report_only" | "ignored" | "enforced" =
          (regressionRule !== "report_only" && regressionRule !== "ignore") ||
          absoluteLimit !== null
            ? "enforced"
            : regressionRule === "ignore"
              ? "ignored"
              : "report_only";

        metricsMap[metricKey] = {
          metric: metricKey,
          regression_rule: regressionRule,
          regression_rule_source: regressionRuleSource,
          absolute_limit: absoluteLimit,
          absolute_limit_source: absoluteLimitSource,
          effective_mode: effectiveMode,
        };
      }

      functions.push({
        ...(contract.fixture_id !== undefined
          ? { fixture_id: contract.fixture_id }
          : {}),
        ...(contract.logical_id !== undefined
          ? { logical_id: contract.logical_id }
          : {}),
        contract_id: contract.contract_id,
        function_name: fn.function_name,
        ...(fn.case_id !== undefined ? { case_id: fn.case_id } : {}),
        metrics: metricsMap,
      });
    }
  }

  const hasEnforcedRule =
    Boolean(global.fail_on_any_regression) ||
    global.max_allowed_cpu_increase_pct !== undefined ||
    global.max_allowed_memory_increase_pct !== undefined ||
    Object.keys(normalizedGlobalLimits).length > 0 ||
    Object.keys(normalizedFunctionLimits).length > 0 ||
    Object.values(normalizedFunctionThresholds).some((rules) =>
      Object.values(rules).some((r) => r !== undefined && r !== "ignore"),
    ) ||
    functions.some((fn) =>
      Object.values(fn.metrics).some((m) => m.effective_mode === "enforced"),
    );

  const evaluationMode: PolicyEvaluationMode =
    status === "configured" && hasEnforcedRule ? "enforced" : "report_only";

  return {
    status,
    evaluation_mode: evaluationMode,
    source,
    configured: {
      global_thresholds: {
        fail_on_any_regression: Boolean(global.fail_on_any_regression),
        max_allowed_cpu_increase_pct:
          global.max_allowed_cpu_increase_pct ?? null,
        max_allowed_memory_increase_pct:
          global.max_allowed_memory_increase_pct ?? null,
      },
      global_limits: normalizedGlobalLimits,
      function_thresholds: normalizedFunctionThresholds,
      function_limits: normalizedFunctionLimits,
    },
    functions,
  };
}

/**
 * Enforce all threshold rules against a DiffResult.
 * Returns the list of violations (empty = pass).
 */
export function enforceThresholds(
  diff: DiffResult,
  config: WeighinConfig | null,
  origin?: Partial<PolicyOrigin> & {
    mode?: "head" | "trusted" | "inline" | "none";
    path?: string | null;
    present?: boolean;
  },
): Violation[] {
  if (config !== null) config = validateConfig(config);
  if (!config?.thresholds && !config?.limits) {
    diff.policy = resolveEffectivePolicy(diff, config, origin);
    return [];
  }

  const global = config?.thresholds?.global ?? {};
  const perFunction = config?.thresholds?.functions ?? {};
  const globalLimits = config?.limits?.global ?? {};
  const functionLimits = config?.limits?.functions ?? {};
  const violations: Violation[] = [];

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
      GLOBAL_RULE_MAP.some(({ field }) => global[field] !== undefined)) &&
    comparedNames.size === 0
  ) {
    throw new Error(
      "Cannot evaluate global policy: no matched BASE/HEAD benchmarks",
    );
  }

  diff.policy = resolveEffectivePolicy(diff, config, origin);

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
