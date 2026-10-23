import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/threshold";
import {
  WeighinConfigSchema,
  RuleValueSchema,
  validateConfig,
  FixturesSpecSchema,
  formatZodError,
} from "../src/config";
import * as fs from "fs";

vi.mock("fs");

describe("loadConfig (TOML parsing & Zod Validation)", () => {
  it("returns null if file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadConfig("missing.toml")).toBeNull();
  });

  it("parses a valid minimal weighin.toml", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global]
      fail_on_any_regression = true
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.thresholds?.global?.fail_on_any_regression).toBe(true);
  });

  it("parses a full valid weighin.toml with dynamic function names", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global]
      fail_on_any_regression = false
      max_allowed_cpu_increase_pct = 5

      [thresholds.functions.hello_world]
      memory_bytes = "ignore"
      cpu_instructions = "strict_zero_tolerance"
      
      [thresholds.functions.another_fn]
      events_count = "allow_10_percent_increase"
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.thresholds?.functions?.hello_world?.memory_bytes).toBe(
      "ignore",
    );
    expect(config?.thresholds?.functions?.another_fn?.events_count).toBe(
      "allow_10_percent_increase",
    );
  });

  it("throws on malformed toml", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.global
      missing_bracket = true
    `);
    expect(() => loadConfig("weighin.toml")).toThrow("Failed to parse TOML");
  });

  it("throws on unknown top-level property (strict)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      unknown_key = true
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(
      "Unrecognized key(s) in object: 'unknown_key'",
    );
  });

  it("throws on unknown rule string", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.functions.test]
      memory_bytes = "allow_magic"
    `);
    expect(() => loadConfig("weighin.toml")).toThrow("Invalid rule string");
  });

  it("throws on invalid metric key", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [thresholds.functions.test]
      memory_byte = "ignore"
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(
      "Unrecognized key(s) in object: 'memory_byte'",
    );
  });

  it("parses valid absolute limits", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [limits.global]
      tx_size_bytes = 100000
      [limits.functions.hello_world]
      cpu_instructions = 50000000
    `);
    const config = loadConfig("weighin.toml");
    expect(config?.limits?.global?.tx_size_bytes).toBe(100000);
    expect(config?.limits?.functions?.hello_world?.cpu_instructions).toBe(
      50000000,
    );
  });

  it("throws on negative limit values", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
      [limits.global]
      tx_size_bytes = -1
    `);
    expect(() => loadConfig("weighin.toml")).toThrow(
      /greater than or equal to 0/,
    );
  });
});

describe("FixturesSpecSchema", () => {
  it("parses a valid fixture", () => {
    const valid = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [{ type: "u32", value: 42 }],
            },
          ],
        },
      ],
    };
    expect(FixturesSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("fails on missing required fields", () => {
    const invalid = { contracts: [{ wasm_path: "foo.wasm" }] };
    const res = FixturesSpecSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error, "fixtures.json");
      expect(msg).toContain("contracts.0.invocations");
      expect(msg).toContain("Required");
    }
  });

  it("fails on invalid argument type", () => {
    const invalid = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [{ type: "magic", value: 42 }],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error, "fix.json");
      expect(msg).toContain("Invalid enum value");

      // Error formatting test (newline fix)
      const lines = msg.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Invalid WeighIn configuration in fix.json:");
      expect(lines[1]).toContain(
        "- contracts.0.invocations.0.args.0.type: Invalid enum value",
      );
    }
  });

  it("parses mixed-case types correctly and round-trips to lowercase", () => {
    const input = {
      contracts: [
        {
          wasm_path: "foo.wasm",
          invocations: [
            {
              function_name: "test",
              args: [
                { type: "SymBol", value: "hello" },
                { type: "VEC", value: [{ type: "U32", value: 123 }] },
                {
                  type: "Map",
                  value: [
                    {
                      key: { type: "STRING", value: "k" },
                      value: { type: "I64", value: "10" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(input);
    expect(res.success).toBe(true);
    if (res.success) {
      const args = res.data.contracts[0].invocations[0].args;
      expect(args[0].type).toBe("symbol");
      expect(args[1].type).toBe("vec");
      expect(args[1].value[0].type).toBe("u32");
      expect(args[2].type).toBe("map");
      expect(args[2].value[0].key.type).toBe("string");
      expect(args[2].value[0].value.type).toBe("i64");
    }
  });

  it("accepts valid optional ID-bearing fixtures at fixture, contract, and invocation level", () => {
    const input = {
      id: "fixture-main",
      contracts: [
        {
          id: "contract-1",
          wasm_path: "test.wasm",
          invocations: [
            {
              id: "inv-1",
              function_name: "test_fn",
              args: [{ type: "U32", value: 42 }],
            },
          ],
        },
      ],
    };
    const res = FixturesSpecSchema.safeParse(input);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.id).toBe("fixture-main");
      expect(res.data.contracts[0].id).toBe("contract-1");
      expect(res.data.contracts[0].invocations[0].id).toBe("inv-1");
    }
  });

  it("rejects blank IDs at fixture, contract, and invocation level", () => {
    expect(
      FixturesSpecSchema.safeParse({
        id: "   ",
        contracts: [
          {
            wasm_path: "test.wasm",
            invocations: [{ function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      FixturesSpecSchema.safeParse({
        contracts: [
          {
            id: "",
            wasm_path: "test.wasm",
            invocations: [{ function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      FixturesSpecSchema.safeParse({
        contracts: [
          {
            wasm_path: "test.wasm",
            invocations: [{ id: "  ", function_name: "test_fn", args: [] }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shared policy-schema parity table (issue #28)
//
// Every entry is checked against both the exported schema (RuleValueSchema /
// WeighinConfigSchema / validateConfig) and the runtime validator so that the
// two can never drift apart silently.
// ---------------------------------------------------------------------------

/**
 * Wrap a rule value in a minimal full config object so it can be parsed by
 * WeighinConfigSchema and validateConfig.
 */
function configWithRule(rule: unknown) {
  return {
    thresholds: {
      functions: {
        hello: { cpu_instructions: rule },
      },
    },
  };
}

/**
 * Shared table of (description, rule value, should be accepted).
 *
 * Each entry is verified against:
 *  1. RuleValueSchema.safeParse — exported schema
 *  2. WeighinConfigSchema.safeParse — exported config schema
 *  3. validateConfig — runtime validator
 */
const RULE_VALUE_TABLE: Array<{
  desc: string;
  rule: unknown;
  accept: boolean;
}> = [
  // --- Category 1: valid named decimal percentages ---
  {
    desc: "allow_0_percent_increase",
    rule: "allow_0_percent_increase",
    accept: true,
  },
  {
    desc: "allow_10_percent_increase",
    rule: "allow_10_percent_increase",
    accept: true,
  },
  {
    desc: "allow_2.5_percent_increase",
    rule: "allow_2.5_percent_increase",
    accept: true,
  },
  {
    desc: "allow_100_percent_increase",
    rule: "allow_100_percent_increase",
    accept: true,
  },
  {
    desc: "allow_0.001_percent_increase",
    rule: "allow_0.001_percent_increase",
    accept: true,
  },

  // --- Category 2: malformed named percentage strings (previously accepted by exported schema) ---
  {
    desc: "allow_1.2.3_percent_increase (multi-dot)",
    rule: "allow_1.2.3_percent_increase",
    accept: false,
  },
  {
    desc: "allow_-1_percent_increase (negative in string)",
    rule: "allow_-1_percent_increase",
    accept: false,
  },
  {
    desc: "allow__percent_increase (no digits)",
    rule: "allow__percent_increase",
    accept: false,
  },
  { desc: "allow_magic (wrong pattern)", rule: "allow_magic", accept: false },
  {
    desc: "allow_percent_increase (missing N)",
    rule: "allow_percent_increase",
    accept: false,
  },
  {
    desc: "ALLOW_10_PERCENT_INCREASE (wrong case)",
    rule: "ALLOW_10_PERCENT_INCREASE",
    accept: false,
  },
  {
    desc: "allow_10_percent_increase_ (trailing underscore)",
    rule: "allow_10_percent_increase_",
    accept: false,
  },

  // --- Category 3: valid scientific-notation numeric policies ---
  { desc: "numeric 0", rule: 0, accept: true },
  { desc: "numeric 1e-7 (scientific notation)", rule: 1e-7, accept: true },
  { desc: "numeric 10", rule: 10, accept: true },
  { desc: "numeric 100", rule: 100, accept: true },
  {
    desc: "numeric 1.5e2 (scientific notation 150)",
    rule: 1.5e2,
    accept: true,
  },

  // --- Category 4: negative numeric policies ---
  { desc: "numeric -1 (negative)", rule: -1, accept: false },
  { desc: "numeric -0.01 (negative decimal)", rule: -0.01, accept: false },
  { desc: "numeric -1e10 (large negative)", rule: -1e10, accept: false },

  // --- Category 5: nonfinite numeric policies ---
  { desc: "Infinity", rule: Infinity, accept: false },
  { desc: "-Infinity", rule: -Infinity, accept: false },
  { desc: "NaN", rule: NaN, accept: false },

  // --- Category 10: valid ignore rule ---
  { desc: "ignore", rule: "ignore", accept: true },
  {
    desc: "strict_zero_tolerance",
    rule: "strict_zero_tolerance",
    accept: true,
  },
];

describe("Shared policy-schema parity table (issue #28)", () => {
  describe("RuleValueSchema exported schema", () => {
    for (const { desc, rule, accept } of RULE_VALUE_TABLE) {
      it(`${accept ? "accepts" : "rejects"}: ${desc}`, () => {
        const result = RuleValueSchema.safeParse(rule);
        expect(result.success).toBe(accept);
      });
    }
  });

  describe("WeighinConfigSchema exported config schema", () => {
    for (const { desc, rule, accept } of RULE_VALUE_TABLE) {
      it(`${accept ? "accepts" : "rejects"}: ${desc}`, () => {
        const result = WeighinConfigSchema.safeParse(configWithRule(rule));
        expect(result.success).toBe(accept);
      });
    }
  });

  describe("validateConfig runtime validator", () => {
    for (const { desc, rule, accept } of RULE_VALUE_TABLE) {
      it(`${accept ? "accepts" : "rejects"}: ${desc}`, () => {
        if (accept) {
          expect(() => validateConfig(configWithRule(rule))).not.toThrow();
        } else {
          expect(() => validateConfig(configWithRule(rule))).toThrow();
        }
      });
    }
  });

  // --- Category 6: unknown policy keys ---
  describe("unknown policy keys are rejected", () => {
    it("rejects unknown top-level key via WeighinConfigSchema", () => {
      expect(WeighinConfigSchema.safeParse({ unknown_key: true }).success).toBe(
        false,
      );
    });

    it("rejects unknown top-level key via validateConfig", () => {
      expect(() => validateConfig({ unknown_key: true })).toThrow();
    });

    it("rejects unknown metric key in function thresholds via validateConfig", () => {
      expect(() =>
        validateConfig({
          thresholds: { functions: { hello: { cpu_instruction: "ignore" } } },
        }),
      ).toThrow(/Unrecognized key/);
    });

    it("rejects unknown nested key via WeighinConfigSchema", () => {
      const result = WeighinConfigSchema.safeParse({
        thresholds: { functions: { hello: { cpu_instruction: "ignore" } } },
      });
      expect(result.success).toBe(false);
    });
  });

  // --- Category 7: blank and whitespace-only function selectors ---
  describe("blank and whitespace-only function selectors are rejected", () => {
    it("rejects blank string function selector via WeighinConfigSchema", () => {
      const result = WeighinConfigSchema.safeParse({
        thresholds: {
          functions: { "": { cpu_instructions: "ignore" } },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects blank string selector via validateConfig", () => {
      expect(() =>
        validateConfig({
          thresholds: {
            functions: { "": { cpu_instructions: "ignore" } },
          },
        }),
      ).toThrow();
    });

    it("rejects blank limit function selector via validateConfig", () => {
      expect(() =>
        validateConfig({
          limits: { functions: { "": { cpu_instructions: 100 } } },
        }),
      ).toThrow();
    });
  });

  // --- Category 8: valid function and global overrides ---
  describe("valid function and global overrides are accepted", () => {
    it("accepts valid per-function thresholds", () => {
      expect(() =>
        validateConfig({
          thresholds: {
            global: {
              fail_on_any_regression: false,
              max_allowed_cpu_increase_pct: 5,
            },
            functions: {
              hello: {
                cpu_instructions: "strict_zero_tolerance",
                memory_bytes: "ignore",
              },
              another_fn: { events_count: "allow_10_percent_increase" },
            },
          },
        }),
      ).not.toThrow();
    });

    it("accepts global fail_on_any_regression via validateConfig", () => {
      expect(() =>
        validateConfig({
          thresholds: { global: { fail_on_any_regression: true } },
        }),
      ).not.toThrow();
    });
  });

  // --- Category 9: valid absolute limits ---
  describe("valid absolute limits are accepted", () => {
    it("accepts valid global and function limits", () => {
      expect(() =>
        validateConfig({
          limits: {
            global: { cpu_instructions: 500000 },
            functions: { hello: { memory_bytes: 65536 } },
          },
        }),
      ).not.toThrow();
    });

    it("accepts zero as an absolute limit value", () => {
      expect(() =>
        validateConfig({ limits: { global: { cpu_instructions: 0 } } }),
      ).not.toThrow();
    });

    it("rejects negative absolute limit value", () => {
      expect(() =>
        validateConfig({ limits: { global: { cpu_instructions: -1 } } }),
      ).toThrow(/greater than or equal to 0/);
    });
  });

  // --- Category 11: fail-closed diagnostics (schema compatibility only) ---
  describe("fail-closed schema properties", () => {
    it("rejects a boolean string for fail_on_any_regression", () => {
      expect(() =>
        validateConfig({
          thresholds: {
            global: { fail_on_any_regression: "true" as unknown as boolean },
          },
        }),
      ).toThrow();
    });

    it("rejects a negative max_allowed_cpu_increase_pct", () => {
      expect(() =>
        validateConfig({
          thresholds: { global: { max_allowed_cpu_increase_pct: -1 } },
        }),
      ).toThrow(/greater than or equal to 0/);
    });
  });

  // --- Category 12: file-context diagnostics ---
  describe("file-context diagnostics", () => {
    it("formatZodError includes the file name", () => {
      const result = WeighinConfigSchema.safeParse({ bad_key: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error, "custom-policy.toml");
        expect(msg).toContain("custom-policy.toml");
        expect(msg).toContain("bad_key");
      }
    });

    it("validateConfig error includes 'weighin.toml' in message", () => {
      try {
        validateConfig({ bad_key: true });
        expect.fail("should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("weighin.toml");
        expect((err as Error).message).toContain("bad_key");
      }
    });
  });
});
