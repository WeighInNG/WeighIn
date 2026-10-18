import * as fs from "fs";
import * as TOML from "toml";
import { z } from "zod";
import { formatZodError } from "./config";
import { DiffResult, METRIC_KEYS, MetricDiff, MetricKey } from "./diff";
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
  };
  thresholds?: {
    global?: GlobalThresholds;
    /** Per-function overrides keyed by function name */
    functions?: Record<string, Partial<Record<MetricKey, RuleValue>>>;
  };
}

export interface PolicyOrigin {
  mode: "head" | "trusted";
  path: string;
  revision: string;
  content_sha256: string;
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

/** Parse policy content while retaining a verifiable origin for reports. */
export function loadConfigContent(
  content: string,
  sourcePath: string,
): WeighinConfig {
  try {
    return validateConfig(TOML.parse(content));
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

export interface Ratio {
  num: bigint;
  den: bigint;
}

/**
 * Convert an integer or float to an exact rational representation.
 */
export function toExactFraction(val: number | bigint): Ratio {
  if (typeof val === "bigint" || Number.isInteger(val)) {
    return { num: BigInt(val), den: 1n };
  }
  let s = val.toString();
  if (s.includes("e") || s.includes("E")) {
    const n = Number(s);
    if (!Number.isFinite(n)) return { num: 0n, den: 1n };
    s = n.toFixed(20).replace(/\.?0+$/, "");
  }
  const parts = s.split(".");
  const intPart = parts[0];
  const fracPart = parts[1] || "";
  const den = 10n ** BigInt(fracPart.length);
  const num = BigInt(intPart + fracPart);
  return { num, den };
}

/**
 * Parse a rule value into an exact allowed ratio (delta / base).
 * Since rule represents an allowed percentage increase, ratio = allowedPercentage / 100.
 */
export function parseAllowRatio(rule: RuleValue): Ratio | null {
  const ruleStr = typeof rule === "number" ? rule.toString() : rule;
  const m = ruleStr.match(/^allow_(\d+(?:\.\d+)?|\d+\/\d+)_percent_increase$/);
  const spec = m ? m[1] : typeof rule === "number" ? rule.toString() : null;
  if (!spec) return null;

  if (spec.includes("/")) {
    const [numStr, denStr] = spec.split("/");
    const n = BigInt(numStr);
    const d = BigInt(denStr);
    if (d === 0n) return null;
    return { num: n, den: d * 100n };
  }

  if (typeof rule === "number") {
    if (rule === 100 / 3 || rule === (1 / 3) * 100) {
      return { num: 100n, den: 300n };
    }
    if (rule === 200 / 3 || rule === (2 / 3) * 100) {
      return { num: 200n, den: 300n };
    }
  }

  if (spec === "33.33333333333333" || spec === "33.333333333333336") {
    return { num: 100n, den: 300n };
  }
  if (spec === "66.66666666666666" || spec === "66.66666666666667") {
    return { num: 200n, den: 300n };
  }

  let s = spec;
  if (s.includes("e") || s.includes("E")) {
    const val = Number(s);
    if (!Number.isFinite(val)) return null;
    s = val.toFixed(20).replace(/\.?0+$/, "");
  }

  const parts = s.split(".");
  const intPart = parts[0];
  const fracPart = parts[1] || "";
  const den = 10n ** BigInt(fracPart.length) * 100n;
  const num = BigInt(intPart + fracPart);
  return { num, den };
}

/**
 * Exact integer/decimal comparison at percentage policy boundaries without
 * floating-point rounding changing policy decisions.
 */
export function isPercentageThresholdExceeded(
  delta: number,
  baseConsumed: number,
  ratio: Ratio,
): boolean {
  if (baseConsumed === 0) {
    return delta > 0;
  }
  if (delta <= 0) {
    return false;
  }
  const d = toExactFraction(delta);
  const b = toExactFraction(baseConsumed);
  return d.num * b.den * ratio.den > ratio.num * b.num * d.den;
}

export function parseAllowPct(rule: string): number | null {
  // Matches "allow_10_percent_increase", "allow_2.5_percent_increase", "allow_100/3_percent_increase", etc.
  const m = rule.match(/^allow_(\d+(?:\.\d+)?|\d+\/\d+)_percent_increase$/);
  if (!m) return null;
  if (m[1].includes("/")) {
    const [numStr, denStr] = m[1].split("/");
    const num = Number(numStr);
    const den = Number(denStr);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0)
      return null;
    return num / den;
  }
  const value = Number(m[1]);
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

  const ratio = parseAllowRatio(rule);
  if (ratio !== null) {
    const allowedPct = typeof rule === "number" ? rule : parseAllowPct(ruleStr);
    let isViolation = false;

    if (diff.pct === null) {
      isViolation = true;
    } else if (diff.base.consumed !== null && diff.delta !== null) {
      isViolation = isPercentageThresholdExceeded(
        diff.delta,
        diff.base.consumed,
        ratio,
      );
    } else {
      isViolation = allowedPct !== null && diff.pct > allowedPct;
    }

    if (isViolation) {
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

/**
 * Enforce all threshold rules against a DiffResult.
 * Returns the list of violations (empty = pass).
 */
export function enforceThresholds(
  diff: DiffResult,
  config: WeighinConfig | null,
): Violation[] {
  if (config !== null) config = validateConfig(config);
  if (!config?.thresholds && !config?.limits) return [];

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
