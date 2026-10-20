import { z } from "zod";
import { METRIC_KEYS } from "./diff";

// ---------------------------------------------------------------------------
// weighin.toml Schema
// ---------------------------------------------------------------------------

export const RuleValueSchema = z.union([
  z.number(),
  z.string().refine(
    (val) => {
      return (
        val === "ignore" ||
        val === "strict_zero_tolerance" ||
        /^allow_[\d.]+_percent_increase$/.test(val)
      );
    },
    {
      message:
        "Invalid rule string. Must be 'ignore', 'strict_zero_tolerance', or 'allow_X_percent_increase'",
    },
  ),
]);

export const GlobalThresholdsSchema = z
  .object({
    fail_on_any_regression: z.boolean().optional(),
    max_allowed_cpu_increase_pct: z.number().optional(),
    max_allowed_memory_increase_pct: z.number().optional(),
  })
  .strict();

export const GlobalLimitsSchema = z.record(
  z.enum(METRIC_KEYS),
  z.number().nonnegative(),
);

export const FunctionLimitsSchema = z.record(
  z.enum(METRIC_KEYS),
  z.number().nonnegative(),
);

export const FunctionThresholdsSchema = z.record(
  z.enum(METRIC_KEYS),
  RuleValueSchema,
);

export const WeighinConfigSchema = z
  .object({
    thresholds: z
      .object({
        global: GlobalThresholdsSchema.optional(),
        functions: z.record(z.string(), FunctionThresholdsSchema).optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        global: GlobalLimitsSchema.optional(),
        functions: z.record(z.string(), FunctionLimitsSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WeighinConfig = z.infer<typeof WeighinConfigSchema>;

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

export const U32_MIN = 0;
export const U32_MAX = 4294967295;
export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;
export const SCSYMBOL_LIMIT = 32;

/**
 * Validates a boolean value.
 * Must be an actual boolean without coercion.
 */
export function validateBool(val: any): string | null {
  if (typeof val !== "boolean") {
    return "Invalid value for bool: must be boolean";
  }
  return null;
}

/**
 * Validates a u32 value.
 * Must be an integer number in 0..4294967295.
 */
export function validateU32(val: any): string | null {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return "Invalid value for u32: must be number";
  }
  if (!Number.isInteger(val)) {
    return "Invalid value for u32: must be integer";
  }
  if (val < U32_MIN || val > U32_MAX) {
    return `Invalid value for u32: out of bounds (expected ${U32_MIN}..${U32_MAX})`;
  }
  return null;
}

/**
 * Validates an i32 value.
 * Must be an integer number in -2147483648..2147483647.
 */
export function validateI32(val: any): string | null {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return "Invalid value for i32: must be number";
  }
  if (!Number.isInteger(val)) {
    return "Invalid value for i32: must be integer";
  }
  if (val < I32_MIN || val > I32_MAX) {
    return `Invalid value for i32: out of bounds (expected ${I32_MIN}..${I32_MAX})`;
  }
  return null;
}

/**
 * Validates a string value.
 * Must be an actual string without coercion.
 */
export function validateString(val: any): string | null {
  if (typeof val !== "string") {
    return "Invalid value for string: must be string";
  }
  return null;
}

/**
 * Validates a symbol value.
 * Must be an actual string obeying the pinned Soroban host's symbol length/character rules:
 * - Length: 0 to 32 bytes (SCSYMBOL_LIMIT = 32, per soroban-env-common/src/symbol.rs).
 * - Character repertoire: 63 characters [a-zA-Z0-9_] (per soroban-env-common/src/symbol.rs and soroban-env-host/src/host.rs).
 * - Empty string "" is explicitly supported by the host (per soroban-env-host/src/test/symbol.rs:zero_len).
 */
export function validateSymbol(val: any): string | null {
  if (typeof val !== "string") {
    return "Invalid value for symbol: must be string";
  }
  if (Buffer.byteLength(val, "utf8") > SCSYMBOL_LIMIT) {
    return `Invalid value for symbol: length exceeds maximum ${SCSYMBOL_LIMIT} bytes (got ${Buffer.byteLength(val, "utf8")})`;
  }
  if (!/^[a-zA-Z0-9_]*$/.test(val)) {
    return "Invalid value for symbol: contains invalid characters (allowed: [a-zA-Z0-9_])";
  }
  return null;
}

/**
 * Validates any primitive argument (bool, u32, i32, string, symbol, or large int).
 * Returns an error message if invalid, or null if valid.
 */
export function validatePrimitiveArg(type: string, val: any): string | null {
  switch (type.toLowerCase()) {
    case "bool":
      return validateBool(val);
    case "u32":
      return validateU32(val);
    case "i32":
      return validateI32(val);
    case "string":
      return validateString(val);
    case "symbol":
      return validateSymbol(val);
    case "u64":
    case "i64":
    case "u128":
    case "i128":
      return validateLargeInt(type, val);
    default:
      return null;
  }
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
      const primitiveErr = validatePrimitiveArg(data.type, data.value);
      if (primitiveErr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: primitiveErr,
          path: ["value"],
        });
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
