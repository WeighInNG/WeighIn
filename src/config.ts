import { z } from "zod";
import { METRIC_KEYS } from "./diff";

// ---------------------------------------------------------------------------
// weighin.toml Schema
// ---------------------------------------------------------------------------

/**
 * A nonnegative finite percentage value used for per-metric numeric rules.
 * Rejects NaN, Infinity, and negative numbers.
 */
const percentageSchema = z.number().finite().nonnegative();

/**
 * Authoritative rule value schema. Agrees with runtime validation in
 * threshold.ts. Accepts:
 *   - Nonnegative finite numbers (percentage caps, e.g. 10 or 1e-7)
 *   - "ignore"
 *   - "strict_zero_tolerance"
 *   - "allow_N_percent_increase" where N is a nonnegative decimal (e.g.
 *     "allow_10_percent_increase", "allow_2.5_percent_increase")
 *
 * Rejects: negative numbers, NaN, Infinity, malformed percentage strings such
 * as "allow_1.2.3_percent_increase" or "allow_-1_percent_increase".
 */
export const RuleValueSchema = z.union([
  percentageSchema,
  z
    .string()
    .refine(
      (val) =>
        val === "ignore" ||
        val === "strict_zero_tolerance" ||
        /^allow_(\d+(?:\.\d+)?)_percent_increase$/.test(val),
      {
        message:
          "Invalid rule string. Must be 'ignore', 'strict_zero_tolerance', or 'allow_X_percent_increase' where X is a nonnegative decimal",
      },
    ),
]);

export const GlobalThresholdsSchema = z
  .object({
    fail_on_any_regression: z.boolean().optional(),
    max_allowed_cpu_increase_pct: percentageSchema.optional(),
    max_allowed_memory_increase_pct: percentageSchema.optional(),
  })
  .strict();

export const GlobalLimitsSchema = z.record(
  z.enum(METRIC_KEYS),
  percentageSchema,
);

export const FunctionLimitsSchema = z.record(
  z.enum(METRIC_KEYS),
  percentageSchema,
);

// Per-metric optional rule object, strict (no unknown metric keys allowed).
export const FunctionThresholdsSchema = z
  .object(
    Object.fromEntries(
      METRIC_KEYS.map((key) => [key, RuleValueSchema.optional()]),
    ),
  )
  .strict();

export const BenchmarkSelectorSchema = z
  .object({
    fixture_id: z.string().min(1).optional(),
    logical_id: z.string().min(1).optional(),
    function_name: z.string().min(1),
    case_id: z.string().min(1).optional(),
  })
  .strict();

export const AggregateBudgetConfigSchema = z
  .object({
    description: z.string().optional(),
    members: z.array(BenchmarkSelectorSchema).min(1),
    limits: z.record(z.enum(METRIC_KEYS), percentageSchema).optional(),
    thresholds: FunctionThresholdsSchema.optional(),
  })
  .strict();

export type BenchmarkSelector = z.infer<typeof BenchmarkSelectorSchema>;
export type AggregateBudgetConfig = z.infer<typeof AggregateBudgetConfigSchema>;

/**
 * Authoritative WeighIn policy configuration schema. Exported for library
 * consumers. Agrees with the runtime validation performed by `validateConfig`.
 *
 * Function and aggregate selectors must be non-blank strings. Numeric rule
 * values must be nonnegative finite numbers. Malformed named percentage strings
 * are rejected. Unknown top-level and nested keys are rejected.
 */
export const WeighinConfigSchema = z
  .object({
    thresholds: z
      .object({
        global: GlobalThresholdsSchema.optional(),
        // Selectors must be non-blank (min(1)) — blank keys are rejected.
        functions: z
          .record(z.string().min(1), FunctionThresholdsSchema)
          .optional(),
        aggregates: z
          .record(z.string().min(1), FunctionThresholdsSchema)
          .optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        global: GlobalLimitsSchema.optional(),
        functions: z.record(z.string().min(1), FunctionLimitsSchema).optional(),
        aggregates: z
          .record(z.string().min(1), FunctionLimitsSchema)
          .optional(),
      })
      .strict()
      .optional(),
    aggregates: z
      .record(z.string().min(1), AggregateBudgetConfigSchema)
      .optional(),
  })
  .strict();

export type WeighinConfig = z.infer<typeof WeighinConfigSchema>;

/**
 * Validate an unknown value against the authoritative WeighIn policy schema.
 * Throws a descriptive error on any violation. This is the single source of
 * truth for policy validation used by both exported consumers and runtime
 * threshold enforcement.
 */
export function validateConfig(value: unknown): WeighinConfig {
  const parsed = WeighinConfigSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(formatZodError(parsed.error, "weighin.toml"));
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Large Integer Validation
// ---------------------------------------------------------------------------
const U64_MAX = 18446744073709551615n;
const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;
const U128_MAX = 340282366920938463463374607431768211455n;
const I128_MIN = -170141183460469231731687303715884105728n;
const I128_MAX = 170141183460469231731687303715884105727n;

export function validateLargeInt(type: string, val: any): string | null {
  if (typeof val !== "string") {
    return `Invalid value for ${type}: must be a string to preserve precision`;
  }
  if (!/^-?\d+$/.test(val)) {
    return `Invalid value for ${type}: must be a valid integer string`;
  }
  try {
    const bi = BigInt(val);
    switch (type) {
      case "u64":
        if (bi < 0n || bi > U64_MAX)
          return `Invalid value for u64: out of bounds`;
        break;
      case "i64":
        if (bi < I64_MIN || bi > I64_MAX)
          return `Invalid value for i64: out of bounds`;
        break;
      case "u128":
        if (bi < 0n || bi > U128_MAX)
          return `Invalid value for u128: out of bounds`;
        break;
      case "i128":
        if (bi < I128_MIN || bi > I128_MAX)
          return `Invalid value for i128: out of bounds`;
        break;
    }
  } catch {
    return `Invalid value for ${type}: malformed integer string`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// weighin-fixtures.json Schema

// ---------------------------------------------------------------------------

export const InvocationArgSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      type: z.preprocess(
        (val) => (typeof val === "string" ? val.toLowerCase() : val),
        z.enum([
          "symbol",
          "string",
          "u32",
          "i32",
          "bool",
          "u64",
          "i64",
          "u128",
          "i128",
          "address",
          "bytes",
          "vec",
          "map",
        ]),
      ),
      value: z.any(),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (["u64", "i64", "u128", "i128"].includes(data.type)) {
        const err = validateLargeInt(data.type, data.value);
        if (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err,
            path: ["value"],
          });
        }
      } else if (data.type === "vec") {
        if (!Array.isArray(data.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "must be array",
            path: ["value"],
          });
        } else {
          data.value.forEach((val: any, idx: number) => {
            const res = InvocationArgSchema.safeParse(val);
            if (!res.success) {
              res.error.issues.forEach((issue) => {
                ctx.addIssue({ ...issue, path: ["value", idx, ...issue.path] });
              });
            } else {
              data.value[idx] = res.data;
            }
          });
        }
      } else if (data.type === "map") {
        if (!Array.isArray(data.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "must be array",
            path: ["value"],
          });
        } else {
          data.value.forEach((entry: any, idx: number) => {
            if (!entry || !entry.key || !entry.value) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "map entries must have key and value",
                path: ["value", idx],
              });
            } else {
              const resK = InvocationArgSchema.safeParse(entry.key);
              if (!resK.success) {
                resK.error.issues.forEach((issue) =>
                  ctx.addIssue({
                    ...issue,
                    path: ["value", idx, "key", ...issue.path],
                  }),
                );
              } else {
                data.value[idx].key = resK.data;
              }
              const resV = InvocationArgSchema.safeParse(entry.value);
              if (!resV.success) {
                resV.error.issues.forEach((issue) =>
                  ctx.addIssue({
                    ...issue,
                    path: ["value", idx, "value", ...issue.path],
                  }),
                );
              } else {
                data.value[idx].value = resV.data;
              }
            }
          });
        }
      }
    }),
);

const idSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "ID must not be blank");

export const InvocationSpecSchema = z
  .object({
    id: idSchema.optional(),
    function_name: z.string().min(1),
    args: z.array(InvocationArgSchema),
  })
  .strict();

export const ContractSpecSchema = z
  .object({
    id: idSchema.optional(),
    wasm_path: z.string().min(1),
    invocations: z.array(InvocationSpecSchema).min(1),
  })
  .strict();

export const FixturesSpecSchema = z
  .object({
    id: idSchema.optional(),
    contracts: z.array(ContractSpecSchema).min(1),
  })
  .strict();

export type FixturesSpec = z.infer<typeof FixturesSpecSchema>;

// ---------------------------------------------------------------------------
// Error Formatting
// ---------------------------------------------------------------------------

export function formatZodError(error: z.ZodError, fileName: string): string {
  const lines = [`Invalid WeighIn configuration in ${fileName}:`];
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    lines.push(`- ${path || "root"}: ${issue.message}`);
  }
  return lines.join("\n");
}

export type RuleValue = z.infer<typeof RuleValueSchema>;
export type GlobalThresholds = z.infer<typeof GlobalThresholdsSchema>;
export type InvocationArg = z.infer<typeof InvocationArgSchema>;
export type InvocationSpec = z.infer<typeof InvocationSpecSchema>;
export type ContractSpec = z.infer<typeof ContractSpecSchema>;
