#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runMeasurement } from "./measurement";
import { redactEndpointSecrets, sanitizeEndpoint } from "./endpoint";

const DEFAULT_FIXTURES_PATH = "weighin-fixtures.json";
const DEFAULT_OUTPUT_PATH = "weighin-results.json";
const DEFAULT_RPC_URL = "http://localhost:8000/rpc";

const HELP_TEXT = `Usage: weighin [<fixtures.json> [<output.json>]] [--rpc-url <url>] [--output <path>]
       weighin --help | -h
       weighin --version

Measure Soroban contract resource usage from prebuilt WASM artifacts and write
measurement results JSON.

Scope:
  Measurement-only command for prebuilt WASMs. The CLI does not build contracts,
  compare revisions, enforce policy thresholds, or post PR comments.

Positional arguments:
  <fixtures.json>       Fixture declaration file (default: ${DEFAULT_FIXTURES_PATH})
  <output.json>         Output measurement JSON path (default: ${DEFAULT_OUTPUT_PATH})

Options:
  --rpc-url <url>       Soroban RPC endpoint (default: ${DEFAULT_RPC_URL})
  --output <path>       Output measurement JSON path (default: ${DEFAULT_OUTPUT_PATH})
  -h, --help            Show this help message and exit
  --version             Show installed package version and exit`;

function getPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, "../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || !pkg.version.trim()) {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version.trim();
}

if (require.main === module) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (cliArgs.includes("--version")) {
    console.log(getPackageVersion());
    process.exit(0);
  }
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown_commit";
  }
}

function parseArgs(): {
  fixturesPath: string;
  outputPath: string;
  rpcUrl: string;
} {
  const args = process.argv.slice(2);
  let fixturesPath = "weighin-fixtures.json";
  let outputPath = "weighin-results.json";
  let rpcUrl = "http://localhost:8000/rpc";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rpc-url" && args[i + 1]) {
      rpcUrl = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    } else if (!args[i].startsWith("--")) {
      // Positional: first is fixtures path, second is output path
      if (fixturesPath === "weighin-fixtures.json") {
        fixturesPath = args[i];
      } else {
        outputPath = args[i];
      }
    }
  }

  return { fixturesPath, outputPath, rpcUrl };
}

async function main() {
  const { fixturesPath, outputPath, rpcUrl } = parseArgs();
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

  console.log(`Starting Weighin Benchmarking...`);
  console.log(`Fixtures: ${fixturesPath}`);
  console.log(`Output:   ${outputPath}`);
  console.log(`RPC URL:  ${sanitizeEndpoint(rpcUrl)}`);
  console.log(`Commit:   ${gitCommit}`);
  console.log(`SDK:      ${sdkVersion}`);

  try {
    const results = await runMeasurement({
      fixturesPath,
      gitCommit,
      sdkVersion,
      rpcUrl,
    });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`Done. Results written to ${outputPath}`);
  } catch (error: any) {
    const detail = String(error?.stack ?? error?.message ?? error);
    console.error(
      `Benchmarking failed: ${redactEndpointSecrets(detail, rpcUrl)}`,
    );
    process.exit(1);
  }
}

main();
