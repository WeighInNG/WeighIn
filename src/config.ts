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
  })
  .strict();

export type WeighinConfig = z.infer<typeof WeighinConfigSchema>;

// ---------------------------------------------------------------------------
// weighin-fixtures.json Schema
// ---------------------------------------------------------------------------

export const InvocationArgSchema = z
  .object({
    type: z.enum(["symbol", "string", "u32", "i32", "bool"]),
    value: z.any(),
  })
  .strict();

export const InvocationSpecSchema = z
  .object({
    function_name: z.string(),
    args: z.array(InvocationArgSchema),
  })
  .strict();

export const ContractSpecSchema = z
  .object({
    wasm_path: z.string(),
    invocations: z.array(InvocationSpecSchema),
  })
  .strict();

export const FixturesSpecSchema = z
  .object({
    contracts: z.array(ContractSpecSchema),
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
