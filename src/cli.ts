#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runMeasurement } from "./measurement";
import { parseFixtures } from "./identity";
import { diffBenchmarks, type DiffResult } from "./diff";
import { buildDiffSummaryRows } from "./diff-summary";
import { enforceThresholds, loadConfig } from "./threshold";
import { discoverSdkAssociations, formatSdkVersions } from "./sdk-version";
import { redactEndpointSecrets, sanitizeEndpoint } from "./endpoint";
import { runDoctor, formatDoctorReport } from "./doctor";
import { writeFileAtomically } from "./atomic-file";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown_commit";
  }
}

function verboseLog(enabled: boolean, message: string): void {
  if (enabled) {
    console.log(message);
  }
}

export interface CliOptions {
  fixturesPath: string;
  outputPath: string | null;
  rpcUrl: string;
  helperPath?: string;
  jsonStdout: boolean;
  json: boolean;
  verbose: boolean;
  dryRun: boolean;
  allowCrossTargetSubstitution: boolean;
  baseFixturesPath?: string | null;
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "validate"; fixturePath: string }
  | { kind: "measure"; options: CliOptions };

const DEFAULT_FIXTURES_PATH = "weighin-fixtures.json";
const DEFAULT_OUTPUT_PATH = "weighin-results.json";
const DEFAULT_RPC_URL = "http://localhost:8000/rpc";

export const USAGE = "Usage: weighin [options] [fixtures.json] [results.json]";

export const DOCTOR_USAGE = "Usage: weighin doctor [--rpc-url <url>]";

export const HELP_TEXT = `${USAGE}

Measure Soroban contract resource usage from existing fixture declarations.
Use --base-fixtures to compare a local BASE fixture set with the HEAD set.
The CLI uses existing WASM artifacts; it does not build contracts or post comments.

  weighin validate <fixtures.json>   Validate a fixtures file offline

Positional arguments:
  fixtures.json         Fixtures file to measure (default: ${DEFAULT_FIXTURES_PATH})
  results.json          Results file to write (default: ${DEFAULT_OUTPUT_PATH})

Options:
  --rpc-url <url>       Standalone Stellar RPC endpoint (default: ${DEFAULT_RPC_URL})
  --output <path>       Results file, or - for JSON on stdout (default: ${DEFAULT_OUTPUT_PATH})
  --helper-path <path>  Use an existing compatible native simulation helper
  --base-fixtures <path>
                        Compare a local BASE fixture set with the HEAD fixtures
  --json-stdout         Write JSON results to stdout instead of a file
  --stdout              Alias for --json-stdout
  --json                Emit only machine-readable JSON on stdout (implies --json-stdout)
  --allow-cross-target-substitution
                        Allow cross-target WASM substitution
  --dry-run             Validate config, fixtures, and WASM paths without RPC
  --                    Treat remaining arguments as positional paths
  -h, --help            Show this help and exit
  --version             Show the installed package version and exit

Subcommands:
  doctor                Check the local environment for required prerequisites
                        (read-only; exits 0 when healthy, 1 when not)`;

function readPackageVersion(): string {
  const packagePath = path.resolve(__dirname, "..", "package.json");
  const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof metadata.version !== "string" || !metadata.version.trim()) {
    throw new Error("Installed package metadata has no version");
  }
  return metadata.version;
}

export function validateFixtures(fixturePath: string): string {
  try {
    const contents = fs.readFileSync(fixturePath, "utf8");
    // Offline validation has no comparison workspace for path-based IDs.
    const identityPath = path.isAbsolute(fixturePath)
      ? path.basename(fixturePath)
      : fixturePath;
    parseFixtures(contents, identityPath);
  } catch (error) {
    throw new Error(`Validation failed for ${fixturePath}: ${String(error)}`, {
      cause: error,
    });
  }
  return `${fixturePath}: fixture is valid`;
}

export function parseArgs(
  rawArgs: string[] = process.argv.slice(2),
): CliCommand {
  if (rawArgs[0] === "validate") {
    const [fixturePath, extra] = rawArgs.slice(1);
    if (fixturePath === "--help" || fixturePath === "-h") {
      return { kind: "help" };
    }
    if (!fixturePath?.trim()) {
      throw new Error("validate requires a fixtures file path");
    }
    if (fixturePath.startsWith("-")) {
      throw new Error(`Unknown option: ${fixturePath}`);
    }
    if (extra !== undefined) {
      throw new Error(`Unexpected argument: ${extra}`);
    }
    return { kind: "validate", fixturePath };
  }

  let fixturesPath: string | null = null;
  let baseFixturesPath: string | null = null;
  let positionalOutputPath: string | null = null;
  let optionOutputPath: string | null = null;
  let positionalCount = 0;
  let jsonStdout = false;
  let verbose = false;
  let rpcUrl = process.env.WEIGHIN_RPC_URL?.trim() || DEFAULT_RPC_URL;
  let helperPath: string | undefined;
  let allowCrossTargetSubstitution = false;
  let endOfOptions = false;
  let json = false;
  let dryRun = false;
  const seenScalarOptions = new Set<string>();

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }

    if (!endOfOptions) {
      // A token beginning with -- is never an option value.
      const nextValue = (option: string, message?: string): string => {
        const value = rawArgs[i + 1];
        if (value === undefined || value.startsWith("--") || !value.trim()) {
          throw new Error(message ?? `${option} requires a value`);
        }
        i++;
        return value;
      };
      const markScalar = (option: string): void => {
        if (seenScalarOptions.has(option)) {
          throw new Error(`Duplicate option: ${option}`);
        }
        seenScalarOptions.add(option);
      };

      if (arg === "--help" || arg === "-h") {
        return { kind: "help" };
      }
      if (arg === "--version") {
        return { kind: "version" };
      }
      if (arg === "--rpc-url") {
        markScalar(arg);
        rpcUrl = nextValue(arg);
        continue;
      }
      if (arg === "--output") {
        markScalar(arg);
        const target = nextValue(arg);
        if (target === "-") {
          jsonStdout = true;
        } else {
          optionOutputPath = target;
        }
        continue;
      }
      if (arg === "--helper-path") {
        markScalar(arg);
        helperPath = nextValue(
          arg,
          "--helper-path requires a path to an executable",
        );
        continue;
      }
      if (arg === "--base-fixtures") {
        markScalar(arg);
        baseFixturesPath = nextValue(arg);
        continue;
      }
      if (arg === "--stdout" || arg === "--json-stdout") {
        jsonStdout = true;
        continue;
      }
      if (arg === "--json") {
        json = true;
        jsonStdout = true;
        continue;
      }
      if (arg === "-v" || arg === "--verbose") {
        verbose = true;
        continue;
      }
      if (arg === "--allow-cross-target-substitution") {
        allowCrossTargetSubstitution = true;
        continue;
      }
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg.startsWith("--")) {
        throw new Error(`Unknown option: ${arg}`);
      }
    }

    positionalCount++;
    if (positionalCount === 1) {
      fixturesPath = arg;
    } else if (positionalCount === 2) {
      if (arg === "-") {
        jsonStdout = true;
      } else {
        positionalOutputPath = arg;
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  // Reject ambiguous combinations before fixture, Git or network side effects.
  if (positionalOutputPath !== null && optionOutputPath !== null) {
    throw new Error(
      "Ambiguous output configuration: cannot specify an output file both positionally and with --output",
    );
  }
  if (
    jsonStdout &&
    (positionalOutputPath !== null || optionOutputPath !== null)
  ) {
    throw new Error(
      "Ambiguous output configuration: cannot specify both JSON stdout mode and an output file path",
    );
  }

  // If baseFixturesPath is set, ensure output is not jsonStdout (we need to write files)
  if (jsonStdout && baseFixturesPath) {
    throw new Error("Cannot use --json-stdout with base fixtures comparison");
  }

  const outputFile = optionOutputPath ?? positionalOutputPath;
  return {
    kind: "measure",
    options: {
      fixturesPath: fixturesPath ?? DEFAULT_FIXTURES_PATH,
      outputPath: jsonStdout ? null : (outputFile ?? DEFAULT_OUTPUT_PATH),
      rpcUrl,
      helperPath,
      jsonStdout,
      json,
      verbose,
      dryRun,
      allowCrossTargetSubstitution,
      baseFixturesPath,
    },
  };
}

export function runDryRun(
  fixturesPath: string,
  configPath = "weighin.toml",
): void {
  loadConfig(configPath);

  if (!fs.existsSync(fixturesPath)) {
    throw new Error(`Fixtures file not found: ${fixturesPath}`);
  }
  const fixturesRaw = fs.readFileSync(fixturesPath, "utf8");
  const resolvedFixturesPath = path.resolve(fixturesPath);
  const fixturesSpec = parseFixtures(
    fixturesRaw,
    path.relative(process.cwd(), resolvedFixturesPath),
  );

  const fixturesDir = path.dirname(resolvedFixturesPath);
  const missingWasmPaths: string[] = [];
  for (const contract of fixturesSpec.contracts) {
    const resolvedWasmPath = path.resolve(fixturesDir, contract.wasm_path);
    if (
      !fs.existsSync(resolvedWasmPath) ||
      !fs.statSync(resolvedWasmPath).isFile()
    ) {
      missingWasmPaths.push(contract.wasm_path);
    }
  }

  if (missingWasmPaths.length > 0) {
    throw new Error(`Missing WASM file(s): ${missingWasmPaths.join(", ")}`);
  }
}
async function main() {
  let command: CliCommand;
  try {
    command = parseArgs();
  } catch (err: any) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(1);
  }

  // Help and version are standalone, offline invocations: they run before any
  // fixture read, Git probe, RPC request or helper provisioning.
  if (command.kind === "help") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  if (command.kind === "version") {
    try {
      process.stdout.write(`${readPackageVersion()}\n`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }
  if (command.kind === "doctor") {
    const report = await runDoctor({ rpcUrl: command.rpcUrl });
    process.stdout.write(`${formatDoctorReport(report)}\n`);
    if (!report.healthy) {
      process.exit(1);
    }
    return;
  }

  if (command.kind === "validate") {
    try {
      console.log(validateFixtures(command.fixturePath));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const {
    fixturesPath,
    outputPath,
    rpcUrl,
    jsonStdout,
    verbose,
    dryRun,
    helperPath,
    json,
    allowCrossTargetSubstitution,
    baseFixturesPath,
  } = command.options;

  if (dryRun) {
    try {
      runDryRun(fixturesPath);
      console.log("✔ Configuration and fixtures are valid");
      return;
    } catch (error: any) {
      console.error(error?.message ?? String(error));
      process.exit(1);
    }
  }

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
    for (const assoc of json ? [] : associations) {
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
    verboseLog(
      verbose && !json,
      `Starting Weighin Benchmarking...\nFixtures: ${fixturesPath}\nOutput:   ${jsonStdout ? "stdout" : outputPath}\nRPC URL:  ${sanitizeEndpoint(rpcUrl)}\nCommit:   ${gitCommit}\nSDK:      ${sdkSummary}`,
    );

    // Measure HEAD fixtures
    const headResults = await runMeasurement({
      fixturesPath,
      gitCommit,
      rpcUrl,
      helperPath,
      allowCrossTargetSubstitution,
    });

    // Ensure headResults is an array for consistent processing
    const headResultsArray = Array.isArray(headResults)
      ? headResults
      : [headResults];

    // If base fixtures path is provided, measure base and compute diff
    let config: import("./threshold").WeighinConfig | null = null;
    let violations: import("./threshold").Violation[] = [];
    let totalBenchmarks = 0;
    let benchmarksWithViolations = new Set<string>();

    if (baseFixturesPath) {
      const baseResults = await runMeasurement({
        fixturesPath: baseFixturesPath,
        gitCommit: "unknown",
        rpcUrl,
        helperPath,
        allowCrossTargetSubstitution,
      });

      config = loadConfig("weighin.toml");
      const diff = diffBenchmarks(baseResults, headResultsArray, config);
      const summaryRows = buildDiffSummaryRows(diff);
      console.log("Benchmark diff summary:");
      console.table(summaryRows);
      violations = enforceThresholds(diff, config);

      // Count total benchmarks from head results
      totalBenchmarks = headResultsArray.flatMap(
        (c) => c.benchmarks ?? [],
      ).length;

      // Track which benchmarks have violations (by function_name + case_id)
      for (const v of violations) {
        const key = `${v.function_name ?? "unknown"}:${v.case_id ?? "no-case"}`;
        benchmarksWithViolations.add(key);
      }
    } else {
      // No base comparison: all measured benchmarks are tracked for violation counts
      totalBenchmarks = headResultsArray.flatMap(
        (c) => c.benchmarks ?? [],
      ).length;
      config = loadConfig("weighin.toml");
      violations = enforceThresholds(
        {
          contracts: [],
          hasRegression: false,
          newContracts: [],
          removedContracts: [],
        } as DiffResult,
        config,
      );
      // Without base comparison, still track violations from config enforcement
      for (const v of violations) {
        const key = `${v.function_name ?? "unknown"}:${v.case_id ?? "no-case"}`;
        benchmarksWithViolations.add(key);
      }
    }

    // Determine counts
    const violationCount = violations.length;
    const allPassed = violationCount === 0;

    // Calculate passed benchmarks: total - benchmarks with at least one violation
    const passedCount = totalBenchmarks - benchmarksWithViolations.size;

    // Display summary
    const benchmarkLabel = totalBenchmarks === 1 ? "benchmark" : "benchmarks";
    const violationLabel = violationCount === 1 ? "violation" : "violations";

    if (!json) {
      if (allPassed) {
        console.log(
          `✔ ${totalBenchmarks} ${benchmarkLabel} passed, 0 ${violationLabel}`,
        );
      } else {
        console.log(
          `✖ ${passedCount} ${benchmarkLabel} passed, ${violationCount} ${violationLabel} detected`,
        );
      }
    }

    // Write results file if not jsonStdout
    if (jsonStdout) {
      process.stdout.write(JSON.stringify(headResults, null, 2) + "\n");
    } else if (outputPath) {
      try {
        writeFileAtomically(outputPath, JSON.stringify(headResults, null, 2), {
          onCleanupError: (temporaryPath, error) =>
            console.error(
              `Could not remove temporary result file ${temporaryPath}: ${error.message}`,
            ),
        });
      } catch (error: any) {
        throw new Error(
          `Failed to write CLI results to ${outputPath}: ${error.message}`,
          { cause: error },
        );
      }
      console.log(`Done. Results written to ${outputPath}`);
    }

    // Exit code: 0 when all pass, 1 when violations occur
    if (!allPassed) {
      process.exit(1);
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
