// SPDX-License-Identifier: Apache-2.0
import * as core from "@actions/core";
import { buildContracts } from "./build";
import { trackedExec } from "./cancellation";

/**
 * Parse an optional boolean Action input.
 * When omitted or empty, returns defaultValue (defaults to false).
 * Validates boolean spelling according to the pinned Actions toolkit YAML 1.2 Core Schema
 * (true | True | TRUE | false | False | FALSE), rejecting invalid non-boolean strings.
 */
export function parseOptionalBooleanInput(
  name: string,
  defaultValue = false,
): boolean {
  const raw = core.getInput(name);
  if (!raw) {
    return defaultValue;
  }
  return core.getBooleanInput(name);
}

/** Select the default modern builder or an explicit custom/prebuilt mode. */
export async function buildForRevision(
  fixturesPath: string,
  worktreeRoot: string,
  rustToolchain: string,
  buildCommand: string,
  skipBuild: boolean,
): Promise<void> {
  if (buildCommand && skipBuild)
    throw new Error("build-command and skip-build cannot be used together");
  if (skipBuild) {
    core.info("skip-build is enabled; using configured precompiled WASM");
    return;
  }
  if (buildCommand) {
    core.info(`Executing custom build command in ${worktreeRoot}`);
    try {
      const env = rustToolchain
        ? { ...process.env, RUSTUP_TOOLCHAIN: rustToolchain }
        : (process.env as Record<string, string>);
      await trackedExec("sh", ["-c", buildCommand], {
        cwd: worktreeRoot,
        env,
      });
    } catch (error: any) {
      throw new Error(`Custom build command failed: ${error.message}`);
    }
    return;
  }
  await buildContracts(fixturesPath, worktreeRoot, rustToolchain);
}
