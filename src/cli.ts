#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runMeasurement } from "./measurement";
import { parseFixtures } from "./identity";
import { discoverSdkAssociations, formatSdkVersions } from "./sdk-version";
import { redactEndpointSecrets, sanitizeEndpoint } from "./endpoint";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown_commit";
  }
}

const USAGE =
  "Usage: weighin [<fixtures.json> [<output.json>]] [--rpc-url <url>] [--output <path>] [--stdout] [--allow-cross-target-substitution]";

class UsageError extends Error {}

export interface CliOptions {
  fixturesPath: string;
  outputPath: string | null;
  rpcUrl: string;
  jsonStdout: boolean;
  allowCrossTargetSubstitution: boolean;
}

/**
 * Strict grammar: at most two positionals (fixtures, then legacy output), the
 * single-value options --rpc-url and --output, the --stdout flag (alias
 * --json-stdout) and the --allow-cross-target-substitution flag, in any order.
 * Before "--", every argument starting with "-" other than a lone "-" is an
 * option; after it, all are positional. An output path of "-" selects JSON
 * stdout mode. Anything ambiguous is rejected instead of guessed: grammar
 * errors throw UsageError (exit 2), while JSON stdout mode combined with an
 * output file keeps its plain Error (exit 1).
 */
export function parseArgs(
  rawArgs: string[] = process.argv.slice(2),
): CliOptions {
  const positionals: string[] = [];
  const options: { "--rpc-url"?: string; "--output"?: string } = {};
  let stdoutFlag: string | undefined;
  let allowCrossTargetSubstitution = false;
  let optionsEnded = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (optionsEnded || arg === "-" || !arg.startsWith("-")) {
      positionals.push(arg);
    } else if (arg === "--") {
      optionsEnded = true;
    } else if (arg === "--stdout" || arg === "--json-stdout") {
      // The two spellings are one option, so giving both is a repetition.
      if (stdoutFlag !== undefined) {
        throw new UsageError(`duplicate option ${arg}`);
      }
      stdoutFlag = arg;
    } else if (arg === "--allow-cross-target-substitution") {
      if (allowCrossTargetSubstitution) {
        throw new UsageError(`duplicate option ${arg}`);
      }
      allowCrossTargetSubstitution = true;
    } else if (arg === "--rpc-url" || arg === "--output") {
      if (options[arg] !== undefined) {
        throw new UsageError(`duplicate option ${arg}`);
      }
      const value = rawArgs[i + 1];
      // An argument beginning with "--" is never consumed as a value.
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new UsageError(`option ${arg} requires a value`);
      }
      options[arg] = value;
      i++;
    } else {
      throw new UsageError(`unknown option ${arg}`);
    }
  }

  if (positionals.length > 2) {
    throw new UsageError(`unexpected extra argument ${positionals[2]}`);
  }
  if (positionals.length === 2 && options["--output"] !== undefined) {
    throw new UsageError(
      "output path given both as a positional argument and with --output",
    );
  }
  if (positionals.includes("")) {
    throw new UsageError("path arguments must not be empty");
  }

  const output: string | undefined = options["--output"] ?? positionals[1];
  const jsonStdout = stdoutFlag !== undefined || output === "-";
  // Reject ambiguous combinations before network side effects
  if (jsonStdout && output !== undefined && output !== "-") {
    throw new Error(
      "Ambiguous output configuration: cannot specify both JSON stdout mode and an output file path",
    );
  }

  return {
    fixturesPath: positionals[0] ?? "weighin-fixtures.json",
    outputPath: jsonStdout ? null : (output ?? "weighin-results.json"),
    rpcUrl: options["--rpc-url"] ?? "http://localhost:8000/rpc",
    jsonStdout,
    allowCrossTargetSubstitution,
  };
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs();
  } catch (err: any) {
    if (err instanceof UsageError) {
      // Usage errors stop before Git, fixture, RPC or helper side effects.
      console.error(`weighin: ${err.message}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    console.error(err.message);
    process.exit(1);
  }

  const { fixturesPath, outputPath, rpcUrl, jsonStdout } = options;
  const gitCommit = getGitCommit();

  // When stdout mode is requested, route diagnostic and progress logs to stderr.
  // This is installed before any discovery output is produced so stdout carries
  // the JSON payload and nothing else.
  const originalLog = console.log;
  const originalInfo = console.info;
  if (jsonStdout) {
    console.log = (...args: any[]) => console.error(...args);
    console.info = (...args: any[]) => console.error(...args);
  }

  // Best-effort: resolve each fixture artifact to its owning Cargo
  // workspace/lock and report the `soroban-sdk` version declared there.
  // Filesystem only — no RPC — and reported per contract: multiple declared
  // versions are listed and unresolved associations say "unknown".
  let sdkSummary = "unknown";
  try {
    const fixturesRaw = fs.readFileSync(fixturesPath, "utf8");
    const fixturesSpec = parseFixtures(
      fixturesRaw,
      path.relative(process.cwd(), path.resolve(fixturesPath)),
    );
    const fixturesDir = path.dirname(path.resolve(fixturesPath));
    const wasmPaths = fixturesSpec.contracts.map((contract) =>
      path.resolve(fixturesDir, contract.wasm_path),
    );
    const associations = discoverSdkAssociations(wasmPaths);
    const versions = [
      ...new Set(associations.flatMap((assoc) => assoc.versions)),
    ];
    sdkSummary = formatSdkVersions(versions);
    for (const assoc of associations) {
      const relative = path.relative(process.cwd(), assoc.wasmPath);
      const lockHint = assoc.lockPath
        ? ` (lock: ${path.relative(process.cwd(), assoc.lockPath)})`
        : " (no lock found)";
      console.log(
        `SDK ${relative}: ${formatSdkVersions(assoc.versions)}${lockHint}`,
      );
    }
  } catch {
    /* ignore — SDK discovery is best-effort */
  }

  try {
    console.log(`Starting Weighin Benchmarking...`);
    console.log(`Fixtures: ${fixturesPath}`);
    console.log(`Output:   ${jsonStdout ? "stdout" : outputPath}`);
    console.log(`RPC URL:  ${sanitizeEndpoint(rpcUrl)}`);
    console.log(`Commit:   ${gitCommit}`);
    console.log(`SDK:      ${sdkSummary}`);

    const results = await runMeasurement({
      fixturesPath,
      gitCommit,
      rpcUrl,
      allowCrossTargetSubstitution: options.allowCrossTargetSubstitution,
    });

    if (jsonStdout) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    } else if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
      console.log(`Done. Results written to ${outputPath}`);
    }
  } catch (error: any) {
    const detail = String(error?.stack ?? error?.message ?? error);
    console.error(
      `Benchmarking failed: ${redactEndpointSecrets(detail, rpcUrl)}`,
    );
    process.exit(1);
  } finally {
    if (jsonStdout) {
      console.log = originalLog;
      console.info = originalInfo;
    }
  }
}

// Only run main when executed as a script
if (require.main === module) {
  main();
}
