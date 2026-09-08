import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/threshold";
import {
  WeighinConfigSchema,
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
    expect(() => loadConfig("weighin.toml")).toThrow("Invalid enum value");
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
      expect(formatZodError(res.error, "fix.json")).toContain(
        "Invalid enum value",
      );
    }
  });
});
