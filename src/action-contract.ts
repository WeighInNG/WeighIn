/**
 * Canonical Action contract specifications for WeighIn Actions.
 * Enforces parity between metadata declarations (action.yml, comment/action.yml)
 * and runtime input/output wiring.
 */

export const SUPPORTED_MAIN_ACTION_INPUTS = [
  "fixtures-path",
  "config-path",
  "trusted-policy-ref",
  "trusted-policy-path",
  "rpc-url",
  "github-token",
  "metadata-path",
  "base-ref",
  "rust-toolchain",
  "report-path",
  "build-command",
  "skip-build",
] as const;

export type MainActionInput = (typeof SUPPORTED_MAIN_ACTION_INPUTS)[number];

export const MAIN_ACTION_INPUT_DEFAULTS: Record<MainActionInput, string> = {
  "fixtures-path": "weighin-fixtures.json",
  "config-path": "weighin.toml",
  "trusted-policy-ref": "",
  "trusted-policy-path": "",
  "rpc-url": "http://localhost:8000/rpc",
  "github-token": "",
  "metadata-path": "",
  "base-ref": "",
  "rust-toolchain": "",
  "report-path": "",
  "build-command": "",
  "skip-build": "false",
};

export const SUPPORTED_MAIN_ACTION_OUTPUTS = ["result", "diff-json"] as const;

export type MainActionOutput = (typeof SUPPORTED_MAIN_ACTION_OUTPUTS)[number];

export const SUPPORTED_COMMENT_ACTION_INPUTS = [
  "report-path",
  "metadata-path",
  "github-token",
] as const;

export type CommentActionInput =
  (typeof SUPPORTED_COMMENT_ACTION_INPUTS)[number];

export const SUPPORTED_COMMENT_ACTION_OUTPUTS = [] as const;

export type CommentActionOutput =
  (typeof SUPPORTED_COMMENT_ACTION_OUTPUTS)[number];

/**
 * Reviewable exception list for optional conditional outputs.
 * Declares outputs that are emitted only under specific runtime conditions or events,
 * and documents the condition under which each output is emitted.
 *
 * Unconditional outputs must be present on every execution path (both success and failure).
 */
export interface ConditionalOutputRule {
  readonly name: string;
  readonly condition: string;
  readonly description: string;
}

export const OPTIONAL_CONDITIONAL_OUTPUTS: {
  readonly main: readonly ConditionalOutputRule[];
  readonly comment: readonly ConditionalOutputRule[];
} = {
  // Both main action outputs (`result`, `diff-json`) are unconditional:
  // emitted on both successful comparison and failure paths.
  main: [],
  // Comment action declares no outputs.
  comment: [],
};

/**
 * Normalize an environment variable key to standard Action input name format (kebab-case).
 * Strips the INPUT_ prefix, converts to lowercase, and replaces underscores with hyphens.
 */
export function normalizeInputKey(key: string): string {
  if (!key.startsWith("INPUT_")) return "";
  return key.slice(6).toLowerCase().replace(/_/g, "-");
}

/**
 * Validate that all INPUT_* environment variables in the environment correspond
 * to supported declared Action inputs. Throws an actionable error if any unsupported
 * inputs are detected, preventing metadata and runtime drift.
 */
export function validateSupportedInputs(
  supported: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const supportedSet = new Set(
    supported.map((s) => s.toLowerCase().replace(/_/g, "-")),
  );
  const unsupported: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("INPUT_")) {
      const rawName = key.slice(6);
      if (!rawName) continue;
      const normalized = rawName.toLowerCase().replace(/_/g, "-");
      if (!supportedSet.has(normalized)) {
        unsupported.push(rawName);
      }
    }
  }

  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported Action input: ${unsupported.join(", ")}. Supported inputs are: ${supported.join(", ")}`,
    );
  }
}
