import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/threshold";
import {
  WeighinConfigSchema,
  FixturesSpecSchema,
  formatZodError,
  validatePrimitiveArg,
} from "../src/config";
import { parseFixtures } from "../src/identity";
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
    expect(() => loadConfig("weighin.toml")).toThrow(
      "Unsupported threshold rule",
    );
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

  describe("primitive argument validation in fixtures", () => {
    it("accepts valid primitive values in fixtures", () => {
      const fixture = {
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              {
                function_name: "test",
                args: [
                  { type: "bool", value: true },
                  { type: "bool", value: false },
                  { type: "u32", value: 0 },
                  { type: "u32", value: 4294967295 },
                  { type: "i32", value: -2147483648 },
                  { type: "i32", value: 2147483647 },
                  { type: "string", value: "" },
                  { type: "string", value: "hello" },
                  { type: "symbol", value: "" },
                  { type: "symbol", value: "A".repeat(32) },
                  { type: "symbol", value: "test_symbol_123" },
                ],
              },
            ],
          },
        ],
      };
      const res = FixturesSpecSchema.safeParse(fixture);
      expect(res.success).toBe(true);
    });

    it("rejects invalid primitives with precise path in Zod error", () => {
      const cases = [
        {
          arg: { type: "bool", value: "true" },
          expectedMessage: "Invalid value for bool: must be boolean",
        },
        {
          arg: { type: "u32", value: -1 },
          expectedMessage: "Invalid value for u32: out of bounds",
        },
        {
          arg: { type: "u32", value: 4294967296 },
          expectedMessage: "Invalid value for u32: out of bounds",
        },
        {
          arg: { type: "u32", value: 1.5 },
          expectedMessage: "Invalid value for u32: must be integer",
        },
        {
          arg: { type: "u32", value: "100" },
          expectedMessage: "Invalid value for u32: must be number",
        },
        {
          arg: { type: "i32", value: 2147483648 },
          expectedMessage: "Invalid value for i32: out of bounds",
        },
        {
          arg: { type: "i32", value: -2147483649 },
          expectedMessage: "Invalid value for i32: out of bounds",
        },
        {
          arg: { type: "i32", value: -1.5 },
          expectedMessage: "Invalid value for i32: must be integer",
        },
        {
          arg: { type: "string", value: 123 },
          expectedMessage: "Invalid value for string: must be string",
        },
        {
          arg: { type: "symbol", value: "a".repeat(33) },
          expectedMessage:
            "Invalid value for symbol: length exceeds maximum 32 bytes",
        },
        {
          arg: { type: "symbol", value: "bad-symbol" },
          expectedMessage:
            "Invalid value for symbol: contains invalid characters",
        },
      ];

      for (const { arg, expectedMessage } of cases) {
        const fixture = {
          contracts: [
            {
              wasm_path: "contract.wasm",
              invocations: [{ function_name: "test", args: [arg] }],
            },
          ],
        };
        const res = FixturesSpecSchema.safeParse(fixture);
        expect(res.success).toBe(false);
        if (!res.success) {
          const formatted = formatZodError(res.error, "fixtures.json");
          expect(formatted).toContain("contracts.0.invocations.0.args.0.value");
          expect(formatted).toContain(expectedMessage);
        }
      }
    });

    it("rejects JSON exponent overflow as parsed-input case", () => {
      // Exponent notation resulting in overflow beyond u32: 1e40
      const fixture1 = JSON.stringify({
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              { function_name: "test", args: [{ type: "u32", value: 1e40 }] },
            ],
          },
        ],
      });
      expect(() => parseFixtures(fixture1, "fixtures.json")).toThrow(
        /Invalid value for u32: out of bounds/,
      );

      // Fractional exponent: 1e-5 (0.00001)
      const fixture2 = JSON.stringify({
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              { function_name: "test", args: [{ type: "u32", value: 1e-5 }] },
            ],
          },
        ],
      });
      expect(() => parseFixtures(fixture2, "fixtures.json")).toThrow(
        /Invalid value for u32: must be integer/,
      );

      // JSON exponent overflow to Infinity: 1e400 parses as Infinity
      const parsedInfinity = JSON.parse(
        '{"contracts":[{"wasm_path":"contract.wasm","invocations":[{"function_name":"test","args":[{"type":"u32","value":1e400}]}]}]}',
      );
      const res = FixturesSpecSchema.safeParse(parsedInfinity);
      expect(res.success).toBe(false);
      if (!res.success) {
        const formatted = formatZodError(res.error, "fixtures.json");
        expect(formatted).toContain("contracts.0.invocations.0.args.0.value");
        expect(formatted).toContain("Invalid value for u32: must be number");
      }
    });

    it("parseFixtures includes fixture and argument path in error message", () => {
      const raw = JSON.stringify({
        contracts: [
          {
            wasm_path: "contract.wasm",
            invocations: [
              {
                function_name: "test",
                args: [{ type: "u32", value: -5 }],
              },
            ],
          },
        ],
      });
      expect(() => parseFixtures(raw, "path/to/my-fixtures.json")).toThrow(
        /Invalid WeighIn configuration in path\/to\/my-fixtures\.json:[\s\S]*- contracts\.0\.invocations\.0\.args\.0\.value: Invalid value for u32: out of bounds/,
      );
    });
  });
});
