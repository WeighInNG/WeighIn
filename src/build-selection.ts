import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { buildContracts } from "./build";

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
      await exec.exec("sh", ["-c", buildCommand], { cwd: worktreeRoot, env });
    } catch (error: any) {
      throw new Error(`Custom build command failed: ${error.message}`);
    }
    return;
  }
  await buildContracts(fixturesPath, rustToolchain);
}
