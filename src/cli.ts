#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runMeasurement } from "./measurement";
import { redactEndpointSecrets, sanitizeEndpoint } from "./endpoint";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown_commit";
  }
}

export const DEFAULT_FIXTURES_PATH = "weighin-fixtures.json";
export const DEFAULT_OUTPUT_PATH = "weighin-results.json";
export const DEFAULT_RPC_URL = "http://localhost:8000/rpc";

export interface CliOptions {
  /** `help` and `version` print and exit before any measurement work. */
  command: "measure" | "help" | "version";
  fixturesPath: string;
  outputPath: string | null;
  rpcUrl: string;
  jsonStdout: boolean;
}

export function helpText(): string {
  return `Usage: weighin [fixtures.json] [results.json | -] [options]

Measures the Soroban resources used by the invocations in a fixtures file,
against prebuilt contract WASMs, and writes the results as JSON. The CLI only
measures: it does not build contracts, compare revisions, enforce thresholds
or post pull request comments.

Arguments:
  fixtures.json            Fixtures file (default: ${DEFAULT_FIXTURES_PATH})
  results.json | -         Results file, or - for JSON on stdout
                           (default: ${DEFAULT_OUTPUT_PATH})

Options:
  --rpc-url <url>          Soroban RPC endpoint (default: ${DEFAULT_RPC_URL})
  --output <file | ->      Results file, or - for JSON on stdout
                           (default: ${DEFAULT_OUTPUT_PATH})
  --stdout, --json-stdout  Write the JSON results to stdout and logs to stderr
  -h, --help               Show this help and exit
  --version                Show the installed WeighIn version and exit
`;
}

/** Version from the package.json next to the installed dist/ folder. */
export function packageVersion(): string {
  const manifest = path.join(__dirname, "..", "package.json");
  const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (typeof version !== "string" || version === "") {
    throw new Error(`No version in ${manifest}`);
  }
  return version;
}

export function parseArgs(
  rawArgs: string[] = process.argv.slice(2),
): CliOptions {
  let fixturesPath: string | null = null;
  let explicitOutputFile: string | null = null;
  let jsonStdout = false;
  let rpcUrl = DEFAULT_RPC_URL;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--help" || arg === "-h" || arg === "--version") {
      return {
        command: arg === "--version" ? "version" : "help",
        fixturesPath: DEFAULT_FIXTURES_PATH,
        outputPath: null,
        rpcUrl,
        jsonStdout: false,
      };
    }
    if (arg === "--rpc-url" && rawArgs[i + 1]) {
      rpcUrl = rawArgs[++i];
    } else if (arg === "--output" && rawArgs[i + 1]) {
      const target = rawArgs[++i];
      if (target === "-") {
        jsonStdout = true;
      } else {
        explicitOutputFile = target;
      }
    } else if (arg === "--stdout" || arg === "--json-stdout") {
      jsonStdout = true;
    } else if (!arg.startsWith("--")) {
      // Positional argument
      if (fixturesPath === null) {
        fixturesPath = arg;
      } else if (explicitOutputFile === null) {
        if (arg === "-") {
          jsonStdout = true;
        } else {
          explicitOutputFile = arg;
        }
      } else {
        throw new Error(`Unexpected argument: ${arg}`);
      }
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  // Reject ambiguous combinations before network side effects
  if (jsonStdout && explicitOutputFile !== null) {
    throw new Error(
      "Ambiguous output configuration: cannot specify both JSON stdout mode and an output file path",
    );
  }

  return {
    command: "measure",
    fixturesPath: fixturesPath || DEFAULT_FIXTURES_PATH,
    outputPath: jsonStdout ? null : explicitOutputFile || DEFAULT_OUTPUT_PATH,
    rpcUrl,
    jsonStdout,
  };
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  // Before any Git probe, fixture read, RPC request or helper provisioning.
  if (options.command === "help") {
    process.stdout.write(helpText());
    return;
  }
  if (options.command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  const { fixturesPath, outputPath, rpcUrl, jsonStdout } = options;
  const gitCommit = getGitCommit();

  // Best-effort: read soroban-sdk version from contract/Cargo.lock if present
  let sdkVersion = "unknown";
  try {
    const lock = fs.readFileSync("contract/Cargo.lock", "utf8");
    const m = lock.match(/name = "soroban-sdk"\nversion = "([^"]+)"/);
    if (m) sdkVersion = m[1];
  } catch {
    /* ignore */
  }

  // When stdout mode is requested, route diagnostic and progress logs to stderr
  const originalLog = console.log;
  const originalInfo = console.info;
  if (jsonStdout) {
    console.log = (...args: any[]) => console.error(...args);
    console.info = (...args: any[]) => console.error(...args);
  }

  try {
    console.log(`Starting Weighin Benchmarking...`);
    console.log(`Fixtures: ${fixturesPath}`);
    console.log(`Output:   ${jsonStdout ? "stdout" : outputPath}`);
    console.log(`RPC URL:  ${sanitizeEndpoint(rpcUrl)}`);
    console.log(`Commit:   ${gitCommit}`);
    console.log(`SDK:      ${sdkVersion}`);

    const results = await runMeasurement({
      fixturesPath,
      gitCommit,
      sdkVersion,
      rpcUrl,
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
