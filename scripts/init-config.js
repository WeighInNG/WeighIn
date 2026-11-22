#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: node scripts/init-config.js [options]\n\nOptions:\n  --force       Replace an existing weighin.toml file\n  --output PATH Write to a custom path instead of ./weighin.toml\n  --help        Show this help text`);
}

function parseArgs(argv) {
  let force = false;
  let output = "weighin.toml";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--output") {
      if (!argv[i + 1]) {
        throw new Error("--output requires a file path");
      }
      output = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { force, output };
}

const starterConfig = `# WeighIn configuration
#
# WeighIn compares configured Soroban contract benchmarks between the base and
# head revisions. Threshold rules can fail a pull request when resource usage
# exceeds the limits declared here.

[thresholds.global]
# Fail when any measured resource regresses. Set to false while establishing
# a baseline, then enable strict policy enforcement when your team is ready.
fail_on_any_regression = false

# Optional global percentage limits may be added for individual metrics:
# max_allowed_cpu_increase_pct = 10
# max_allowed_memory_increase_pct = 10

# Per-function rules provide finer control. Replace "hello" with a function
# name from weighin-fixtures.json.
# [thresholds.functions.hello]
# cpu_instructions = "strict_zero_tolerance"
# memory_bytes = "allow_10_percent_increase"
# ledger_write_bytes = "allow_5_percent_increase"
`;

try {
  const { force, output } = parseArgs(args);
  const destination = path.resolve(process.cwd(), output);

  if (fs.existsSync(destination) && !force) {
    console.error(`Refusing to overwrite existing file: ${destination}`);
    console.error("Use --force to replace it.");
    process.exitCode = 1;
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, starterConfig, { encoding: "utf8", flag: "w" });
    console.log(`Created ${destination}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
