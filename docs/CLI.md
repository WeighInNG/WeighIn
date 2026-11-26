
# WeighIn CLI Reference

The `weighin` command-line interface provides a standalone way to measure
Soroban smart contract resource consumption using existing contract WASM
artifacts and a compatible Stellar RPC endpoint.

The CLI is defined in `src/cli.ts` and is published as the `weighin` binary.

## Installation

### Option 1: Install globally

```bash
npm install -g weighin
```

Verify the installation:

```bash
weighin --version
```

Display available options:

```bash
weighin --help
```

### Option 2: Run with npx

You can run WeighIn without installing it globally:

```bash
npx weighin --help
```

Run a measurement:

```bash
npx weighin
```

The CLI uses the current working directory to resolve fixture files,
WASM paths, and output files.

## Command Syntax

```bash
weighin [options] [fixtures.json] [results.json]
```

### Positional Arguments

| Argument | Description | Default |
|---|---|---|
| `fixtures.json` | Path to the fixture declaration file | `weighin-fixtures.json` |
| `results.json` | Path where measurement results are written | `weighin-results.json` |

Both positional arguments are optional.

Examples:

```bash
# Use both default paths
weighin

# Specify a fixture file
weighin ./weighin-fixtures.json

# Specify a fixture file and output file
weighin ./weighin-fixtures.json ./results.json
```

## Command-Line Options

The following options are supported by the current CLI implementation.

| Option | Description | Default |
|---|---|---|
| `--rpc-url <url>` | Standalone Stellar RPC endpoint | `http://localhost:8000/rpc` |
| `--output <path>` | Results output file; use `-` for stdout | `weighin-results.json` |
| `--helper-path <path>` | Path to an existing compatible native simulation helper | Automatically provisioned helper |
| `--json-stdout` | Write JSON measurement results to stdout | Disabled |
| `--stdout` | Alias for `--json-stdout` | Disabled |
| `--allow-cross-target-substitution` | Allow cross-target WASM substitution | Disabled |
| `--help`, `-h` | Display CLI help | — |
| `--version` | Display installed package version | — |
| `--` | End option parsing; treat remaining tokens as positional arguments | — |

### RPC Endpoint

The default RPC endpoint is:

```text
http://localhost:8000/rpc
```

To use another compatible standalone RPC endpoint:

```bash
weighin --rpc-url http://localhost:8000/rpc
```

The endpoint must be compatible with the network and protocol requirements
of the current measurement implementation.

Public Stellar network endpoints and unsupported protocol configurations
are outside the currently verified measurement scope.

### Output File

Specify a custom output path:

```bash
weighin weighin-fixtures.json --output results.json
```

The CLI writes the measurement results as formatted JSON.

To write JSON directly to stdout:

```bash
weighin weighin-fixtures.json --json-stdout
```

The following is also supported:

```bash
weighin weighin-fixtures.json --stdout
```

Alternatively, use `-` as the output destination:

```bash
weighin weighin-fixtures.json --output -
```

When JSON stdout mode is enabled, diagnostic and progress messages are
redirected to stderr so stdout contains the JSON result.

### Native Simulation Helper

WeighIn uses a compatible native Soroban simulation helper.

To provide an existing helper executable:

```bash
weighin weighin-fixtures.json \
  --rpc-url http://localhost:8000/rpc \
  --helper-path ./path/to/simulation-helper
```

The executable must be compatible with the current WeighIn measurement
implementation.

### Cross-Target WASM Substitution

By default, WeighIn does not silently substitute a WASM artifact built for
a different target when the declared artifact is missing.

The following option explicitly enables that behavior:

```bash
weighin weighin-fixtures.json --allow-cross-target-substitution
```

Use this option only when the substitution is intentional.

## Running Against Stellar Quickstart

WeighIn requires a compatible standalone Stellar RPC endpoint.

The following example uses a local Stellar Quickstart container.

### Step 1: Start Stellar Quickstart

Ensure Docker is installed and running.

Start a local Quickstart container:

```bash
docker run --rm -d \
  --name stellar-quickstart \
  -p 8000:8000 \
  stellar/quickstart:latest --local
```

For reproducible environments, prefer the same reviewed, immutable image
digest used by your project's CI workflow rather than relying on `latest`.

### Step 2: Wait for RPC Health

Check that the RPC endpoint is healthy:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc
```

Wait until the response reports:

```json
{
  "status": "healthy"
}
```

The RPC service must also expose the network and protocol configuration
required by WeighIn.

### Step 3: Prepare Contract WASM

Build the Soroban contract using a compatible Stellar CLI and Rust toolchain.

For example:

```bash
stellar contract build --locked --optimize=true
```

The default WeighIn builder uses the modern `wasm32v1-none` target.

Ensure that the WASM path declared in your fixture file points to an existing
built artifact.

The standalone CLI measures existing WASM artifacts. It does not compile
your Soroban contracts.

### Step 4: Prepare Fixture Declarations

Create or update `weighin-fixtures.json`.

Example:

```json
{
  "id": "greeting-suite",
  "contracts": [
    {
      "id": "greeting",
      "wasm_path": "contract/target/wasm32v1-none/release/contract_test.wasm",
      "invocations": [
        {
          "id": "hello-world",
          "function_name": "hello",
          "args": [
            {
              "type": "symbol",
              "value": "world"
            }
          ]
        }
      ]
    }
  ]
}
```

Replace the WASM path, function name, and arguments with values matching
your own Soroban contract.

See the [Integration Guide](INTEGRATION-GUIDE.md) for a complete fixture
setup walkthrough.

### Step 5: Run the Measurement

Execute:

```bash
weighin weighin-fixtures.json \
  --rpc-url http://localhost:8000/rpc \
  --output weighin-results.json
```

The output file contains the measurement records generated by WeighIn.

### Step 6: Inspect the Results

Read the generated JSON:

```bash
cat weighin-results.json
```

The records contain contract and benchmark information, resource metrics,
WASM hashes, and measurement provenance.

Unavailable metrics are represented explicitly and should not be treated
as measured zero values.

### Step 7: Stop Stellar Quickstart

When finished:

```bash
docker stop stellar-quickstart
```

## Help and Version Commands

Display the available usage information:

```bash
weighin --help
```

Display the installed package version:

```bash
weighin --version
```

Both commands are standalone and offline. They do not require a fixture
file, Git repository, RPC endpoint, or native simulation helper.

## Subcommands

### list-identities

Print the resolved logical identity tuple for every invocation declared in
a fixture file. The command is entirely offline: it reads the fixture, runs
the same identity-resolution logic used by the measurement engine, and
writes the results without contacting RPC, provisioning helpers, performing
builds, or accessing any network or Git state.

```bash
weighin list-identities [--json] <fixtures.json>
```

**Positional argument:**

| Argument | Description |
|---|---|
| `fixtures.json` | Path to the fixture file to inspect (required) |

**Options:**

| Option | Description |
|---|---|
| `--json` | Write a JSON array to stdout instead of tab-separated lines |
| `-h`, `--help` | Show the main help text and exit |

The command exits `0` on success and `1` when the fixture cannot be read
or fails schema/identity validation.

#### Tab-separated output (default)

Each line corresponds to one invocation. Fields are separated by a single
tab character in the order: `fixture_id`, `logical_id`, `function_name`,
`case_id`.

```bash
weighin list-identities weighin-fixtures.json
```

Example output for a fixture with explicit IDs:

```text
id:greeting-suite  id:greeting  hello  id:hello-world
id:greeting-suite  id:greeting  hello  id:hello-alice
```

The `id:` prefix indicates an explicit ID was declared. The `path:` and
`wasm:` prefixes indicate path-derived identities, and `args:` indicates
an argument-derived case identity.

#### JSON output

Pass `--json` to receive a JSON array of objects, one per invocation:

```bash
weighin list-identities --json weighin-fixtures.json
```

Each object has four string fields:

```json
[
  {
    "fixture_id": "id:greeting-suite",
    "logical_id": "id:greeting",
    "function_name": "hello",
    "case_id": "id:hello-world"
  },
  {
    "fixture_id": "id:greeting-suite",
    "logical_id": "id:greeting",
    "function_name": "hello",
    "case_id": "id:hello-alice"
  }
]
```

#### Identity stability

The comparison tuple is `(fixture_id, logical_id, function_name, case_id)`.
When explicit `id` values are declared on fixtures, contracts and
invocations, those IDs are stable across WASM path changes, file
reordering and code changes. Without explicit IDs, identities are derived
from the fixture file path, the WASM path and the canonicalized argument
values, and change when any of those change.

Use `list-identities` to confirm which identities will be used before
running a measurement or comparing revisions.

## Exit Codes

| Exit code | Meaning |
|---|---|
| `0` | The CLI completed successfully. |
| `1` | A runtime, configuration, argument-validation, measurement, or other execution error occurred. |

The CLI exits with code `1` when execution fails, including when an
unsupported argument is supplied or a required measurement cannot be
completed.

**Important:** The standalone CLI does not implement the complete
BASE-versus-HEAD pull request comparison. Threshold regression decisions
for pull requests are performed by the GitHub Action.

The GitHub Action exposes its own `result` output (`pass` or `fail`) and
fails the Action when its comparison or policy evaluation fails.

## Argument Validation

The CLI validates arguments before fixture loading, Git operations, and
network requests.

The following conditions are rejected:

- Unknown options.
- Missing option values.
- Duplicate scalar options such as `--rpc-url`, `--output`, and
  `--helper-path`.
- Unexpected positional arguments.
- Combining positional output paths with `--output`.
- Combining JSON stdout mode with a file output path.
- Treating a token beginning with `--` as an option value.

Use `--` to stop option parsing when a positional path begins with a dash.

Example:

```bash
weighin -- -fixtures.json results.json
```

## CLI Versus GitHub Action

The standalone CLI and GitHub Action serve different purposes.

| Capability | CLI | GitHub Action |
|---|---|---|
| Measure existing WASM files | Yes | Yes |
| Build HEAD contracts | No | Yes, by default |
| Build BASE contracts | No | Yes, by default |
| Compare BASE and HEAD | No | Yes |
| Generate resource differences | No | Yes |
| Enforce PR regression policies | No complete comparison | Yes |
| Generate PR benchmark reports | No | Yes |
| Generate PR metadata | No | Yes |
| Publish PR comments | No | Through separate comment workflow |

The GitHub Action accepts additional inputs such as `base-ref`,
`fixtures-path`, and `config-path`. These are Action inputs, not standalone
CLI options.

## Troubleshooting

### RPC is not reachable

Confirm that the Stellar Quickstart container is running:

```bash
docker ps
```

Check the RPC health endpoint:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:8000/rpc
```

### Fixture file not found

Confirm that the fixture file exists in your current working directory
or provide its relative or absolute path as the first positional argument.

### WASM artifact not found

Verify that the contract was built successfully and that `wasm_path`
points to the correct artifact relative to the fixture file.

### RPC protocol incompatibility

Ensure that the RPC endpoint uses a supported standalone network and
protocol version.

### Native helper failure

Check the helper installation and compatibility. If you already have a
compatible helper, supply it using `--helper-path`.

## Related Documentation

- [Integration Guide](INTEGRATION-GUIDE.md)
- [Configuration Reference](CONFIGURATION.md)
- [Architecture](ARCHITECTURE.md)
- [Native Measurement](native-measurement.md)
- [Contract Build](contract-build.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
