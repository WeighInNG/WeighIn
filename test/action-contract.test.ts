import { describe, expect, it } from "vitest";
import {
  SUPPORTED_MAIN_ACTION_INPUTS,
  SUPPORTED_MAIN_ACTION_OUTPUTS,
  SUPPORTED_COMMENT_ACTION_INPUTS,
  SUPPORTED_COMMENT_ACTION_OUTPUTS,
  OPTIONAL_CONDITIONAL_OUTPUTS,
  MAIN_ACTION_INPUT_DEFAULTS,
  normalizeInputKey,
  validateSupportedInputs,
} from "../src/action-contract";

describe("Action Contract Specifications", () => {
  it("defines immutable canonical lists of inputs and outputs for both entry points", () => {
    expect(SUPPORTED_MAIN_ACTION_INPUTS).toContain("fixtures-path");
    expect(SUPPORTED_MAIN_ACTION_INPUTS).toContain("skip-build");
    expect(SUPPORTED_MAIN_ACTION_INPUTS.length).toBe(12);

    expect(SUPPORTED_MAIN_ACTION_OUTPUTS).toEqual(["result", "diff-json"]);

    expect(SUPPORTED_COMMENT_ACTION_INPUTS).toEqual([
      "report-path",
      "metadata-path",
      "github-token",
    ]);

    expect(SUPPORTED_COMMENT_ACTION_OUTPUTS).toEqual([]);
  });

  it("normalizes environment keys to standard kebab-case Action inputs", () => {
    expect(normalizeInputKey("INPUT_FIXTURES-PATH")).toBe("fixtures-path");
    expect(normalizeInputKey("INPUT_RPC_URL")).toBe("rpc-url");
    expect(normalizeInputKey("INPUT_SKIP_BUILD")).toBe("skip-build");
    expect(normalizeInputKey("PATH")).toBe("");
  });

  it("validates supported inputs successfully when only declared inputs are present", () => {
    const validEnv = {
      INPUT_FIXTURES_PATH: "fixtures.json",
      INPUT_RPC_URL: "http://localhost:8000/rpc",
      "INPUT_SKIP-BUILD": "false",
      PATH: "/usr/bin",
    };
    expect(() =>
      validateSupportedInputs(SUPPORTED_MAIN_ACTION_INPUTS, validEnv),
    ).not.toThrow();
  });

  it("rejects unsupported inputs with clear actionable diagnostic message", () => {
    const invalidEnv = {
      INPUT_FIXTURES_PATH: "fixtures.json",
      INPUT_UNSUPPORTED_OPTION: "foo",
      INPUT_TYPO: "bar",
    };
    expect(() =>
      validateSupportedInputs(SUPPORTED_MAIN_ACTION_INPUTS, invalidEnv),
    ).toThrowError(/Unsupported Action input: UNSUPPORTED_OPTION, TYPO/);
  });

  it("provides reviewable exception list for optional conditional outputs", () => {
    expect(OPTIONAL_CONDITIONAL_OUTPUTS).toHaveProperty("main");
    expect(OPTIONAL_CONDITIONAL_OUTPUTS).toHaveProperty("comment");
    // Main action outputs are unconditional (result, diff-json)
    expect(Array.isArray(OPTIONAL_CONDITIONAL_OUTPUTS.main)).toBe(true);
    expect(Array.isArray(OPTIONAL_CONDITIONAL_OUTPUTS.comment)).toBe(true);
  });

  it("documents defaults for all main action inputs", () => {
    for (const input of SUPPORTED_MAIN_ACTION_INPUTS) {
      expect(MAIN_ACTION_INPUT_DEFAULTS).toHaveProperty(input);
    }
  });
});
