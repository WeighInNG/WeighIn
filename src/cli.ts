#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runMeasurement } from "./measurement";
import { parseFixtures } from "./identity";
import { diffBenchmarks, type DiffResult } from "./diff";
import { enforceThresholds, loadConfig } from "./threshold";
import { discoverSdkAssociations, formatSdkVersions } from "./sdk-version";
import { redactEndpointSecrets, sanitizeEndpoint } from "./endpoint";

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
  verbose: boolean;
  dryRun: boolean;
  allowCrossTargetSubstitution: boolean;
  baseFixturesPath?: string | null;
}

export interface ListIdentitiesOptions {
  fixturesPath: string;
  json: boolean;
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "list-identities"; options: ListIdentitiesOptions }
  | { kind: "measure"; options: CliOptions };

const DEFAULT_FIXTURES_PATH = "weighin-fixtures.json";
const DEFAULT_OUTPUT_PATH = "weighin-results.json";
const DEFAULT_RPC_URL = "http://localhost:8000/rpc";

export const USAGE = "Usage: weighin [options] [fixtures.json] [results.json]";

export const LIST_IDENTITIES_USAGE =
  "Usage: weighin list-identities [--json] <fixtures.json>";

export const HELP_TEXT = `${USAGE}

Measure Soroban contract resource usage from an existing fixtures file.
The command only measures: it does not build contracts, compare BASE/HEAD
revisions, enforce thresholds or post comments.

Positional arguments:
  fixtures.json         Fixtures file to measure (default: ${DEFAULT_FIXTURES_PATH})
  results.json          Results file to write (default: ${DEFAULT_OUTPUT_PATH})

Options:
  --rpc-url <url>       Standalone Stellar RPC endpoint (default: ${DEFAULT_RPC_URL})
  --output <path>       Results file, or - for JSON on stdout (default: ${DEFAULT_OUTPUT_PATH})
  --helper-path <path>  Use an existing compatible native simulation helper
  --json-stdout         Write JSON results to stdout instead of a file
  --stdout              Alias for --json-stdout
  --allow-cross-target-substitution
                        Allow cross-target WASM substitution
  --dry-run             Validate config, fixtures, and WASM paths without RPC
  --                    Treat remaining arguments as positional paths
  -h, --help            Show this help and exit
  --version             Show the installed package version and exit

Subcommands:
  list-identities       Print the resolved logical identity tuple for every
                        invocation in a fixture file (offline; no measurement)`;

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
export function parseArgs(
  rawArgs: string[] = process.argv.slice(2),
): CliCommand {
  // The list-identities subcommand is dispatched before full option parsing.
  if (rawArgs[0] === "list-identities") {
    const subArgs = rawArgs.slice(1);
    let fixturesPath: string | null = null;
    let json = false;
    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i];
      if (arg === "--json") {
        json = true;
      } else if (arg === "--help" || arg === "-h") {
        return { kind: "help" };
      } else if (arg.startsWith("--")) {
        throw new Error(`Unknown option: ${arg}`);
      } else if (fixturesPath === null) {
        fixturesPath = arg;
      } else {
        throw new Error(`Unexpected argument: ${arg}`);
      }
    }
    if (fixturesPath === null) {
      throw new Error(
        `${LIST_IDENTITIES_USAGE}\nlist-identities requires a fixtures file path`,
      );
    }
    return {
      kind: "list-identities",
      options: { fixturesPath, json },
    };
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
      if (arg === "--stdout" || arg === "--json-stdout") {
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

    // Track positionals explicitly instead of inferring them from a value.
    positionalCount++;
    if (positionalCount === 1) {
      fixturesPath = arg;
    } else if (positionalCount === 2) {
      if (arg === "-") {
        jsonStdout = true;
      } else if (!baseFixturesPath) {
        // Second positional is treated as output path when no base comparison
        // is configured; it falls back to baseFixturesPath only when a base
        // fixtures path is explicitly needed for comparison mode.
        positionalOutputPath = arg;
      } else {
        // baseFixturesPath already set (comparison mode); second positional is
        // ignored for output but still tracked as a positional argument.
      }
    } else if (positionalCount === 3 && baseFixturesPath) {
      // Third positional is the output path
      positionalOutputPath = arg;
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

  // list-identities is an offline subcommand: reads the fixture file, resolves
  // identities using the same parser as measurement, and writes the result.
  // It never contacts RPC, provisions helpers, or performs builds.
  if (command.kind === "list-identities") {
    const { fixturesPath, json } = command.options;
    try {
      const raw = fs.readFileSync(fixturesPath, "utf8");
      const fixturePath = path.relative(
        process.cwd(),
        path.resolve(fixturesPath),
      );
      const identified = parseFixtures(raw, fixturePath);
      const tuples: Array<{
        fixture_id: string;
        logical_id: string;
        function_name: string;
        case_id: string;
      }> = [];
      for (const contract of identified.contracts) {
        for (const invocation of contract.invocations) {
          tuples.push({
            fixture_id: identified.fixture_id,
            logical_id: contract.logical_id,
            function_name: invocation.function_name,
            case_id: invocation.case_id,
          });
        }
      }
      if (json) {
        process.stdout.write(JSON.stringify(tuples, null, 2) + "\n");
      } else {
        for (const t of tuples) {
          process.stdout.write(
            `${t.fixture_id}\t${t.logical_id}\t${t.function_name}\t${t.case_id}\n`,
          );
        }
      }
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
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
    verboseLog(
      verbose,
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

      const diff = diffBenchmarks(baseResults, headResultsArray);
      config = loadConfig("weighin.toml");
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

    if (allPassed) {
      console.log(
        `✔ ${totalBenchmarks} ${benchmarkLabel} passed, 0 ${violationLabel}`,
      );
    } else {
      console.log(
        `✖ ${passedCount} ${benchmarkLabel} passed, ${violationCount} ${violationLabel} detected`,
      );
    }

    // Write results file if not jsonStdout
    if (jsonStdout) {
      process.stdout.write(JSON.stringify(headResults, null, 2) + "\n");
    } else if (outputPath) {
      fs.writeFileSync(
        outputPath,
        JSON.stringify(headResults, null, 2),
        "utf8",
      );
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
