# WeighIn

WeighIn is a resource-cost benchmarking and CI regression toolkit for Soroban/Stellar smart contracts. It tracks WebAssembly (WASM) execution footprints across your pull requests to prevent unexpected gas and resource regressions.

## Why WeighIn?

In the Stellar ecosystem, Soroban smart contracts have strict resource limits (CPU instructions, memory, ledger I/O, event sizes) and fees are directly proportional to this consumption.
Resource consumption can easily change between revisions as dependencies update or code is refactored, and these changes can be difficult to notice manually.
WeighIn moves detection into CI, automatically measuring your contract's footprint on every pull request and warning you before expensive or oversized contracts are merged.

## How It Works

1. **Pull Request**: A developer opens a PR modifying a Soroban contract.
2. **Build**: WeighIn builds the WASM for both the PR branch and the base branch.
3. **Benchmark**: Using a local Soroban RPC, WeighIn simulates transactions defined in your fixtures file.
4. **Compare**: The action compares the resource consumption (CPU, memory, ledger read/writes, etc.) of the PR against the baseline.
5. **Evaluate**: WeighIn checks the results against custom thresholds defined in `weighin.toml`.
6. **Report**: A markdown table summarizing the resource diffs is posted directly on the PR.
7. **CI Result**: The action fails if any limits or regressions exceed your defined thresholds.

## Features

- **Automated Resource Benchmarking**: Measures CPU instructions, memory bytes, ledger I/O, and events.
- **Diff Generation**: Automatically checks out the base branch using a lightweight `git worktree` to produce accurate before-and-after metrics.
- **Configurable Thresholds**: Define strict limits or allowed percentage regressions using a `weighin.toml` file.
- **PR Comments**: Posts a detailed markdown report on pull requests showing exactly what changed.
- **RPC Simulation**: Accurately simulates transactions against a real Soroban standalone network.

## Installation

Add WeighIn to your GitHub Actions workflow. Because Soroban requires building untrusted Rust code from PRs, but posting comments requires write permissions, WeighIn uses a secure two-workflow setup to support PRs from forks securely.

1. **Measurement Workflow** (builds WASM, runs benchmarks, saves artifacts).
   Create `.github/workflows/weighin.yml`:

```yaml
name: WeighIn Benchmark
on:
  pull_request:
    branches: [main]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    # Default token permissions (read-only) are sufficient.
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dtolnay/rust-toolchain@master
        with:
          toolchain: "1.95.0"
          targets: wasm32-unknown-unknown

      - name: Start local Stellar network
        run: |
          docker run --rm -d -p 8000:8000 stellar/quickstart:latest --local
          sleep 30 # Wait for network to be healthy

      - name: Run WeighIn
        uses: mxrtins04/WeighIn@main
        with:
          fixtures-path: weighin-fixtures.json
          config-path: weighin.toml
          rpc-url: http://localhost:8000/rpc
          report-path: weighin-report.md
          metadata-path: pr-metadata.json

      - name: Upload Report Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: weighin-artifacts
          path: |
            weighin-report.md
            pr-metadata.json
```

2. **Comment Workflow** (securely posts the comment with elevated permissions).
   Create `.github/workflows/weighin-comment.yml`:

```yaml
name: WeighIn Comment
on:
  workflow_run:
    workflows: ["WeighIn Benchmark"]
    types:
      - completed

jobs:
  post-comment:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'success'
    permissions:
      pull-requests: write

    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: weighin-artifacts
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Post Comment
        uses: mxrtins04/WeighIn/comment@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          report-path: weighin-report.md
          metadata-path: pr-metadata.json
```

## Configuration

WeighIn is configured via action inputs and two files:

### Action Inputs

- `fixtures-path` (default: `weighin-fixtures.json`): Path to the JSON file declaring which WASM files to benchmark and functions to invoke.
- `config-path` (default: `weighin.toml`): Path to the threshold configuration file. If omitted, the action runs without enforcing regression rules (report only).
- `rpc-url` (default: `http://localhost:8000/rpc`): The Soroban RPC endpoint to use for simulation.
- `github-token` (default: `''`): GitHub token to post the benchmark diff comment on the pull request. Pass `secrets.GITHUB_TOKEN`.
- `base-ref` (default: `''`): Git ref to use as the baseline. Defaults to the PR base branch.
- `rust-toolchain` (default: `''`): Rust toolchain channel to use when building WASM.

### Fixtures File (`weighin-fixtures.json`)

Defines the contracts and functions to test:

```json
{
  "contracts": [
    {
      "wasm_path": "contract/target/wasm32-unknown-unknown/release/my_contract.wasm",
      "invocations": [
        {
          "function_name": "hello",
          "args": [{"type": "Symbol", "value": "world"}]
        }
      ]
    }
  ]
}
```

### Thresholds (`weighin.toml`)

Defines regression rules:

```toml
[limits.global]
cpu_instructions = 50000000

[thresholds.global]
fail_on_any_regression = true

[thresholds.functions.my_function]
memory_bytes = "allow_5_percent_increase"
```

## Architecture

WeighIn is built using TypeScript and runs as a Node24 GitHub Action. The core modules are:
- `action.ts`: The main entrypoint orchestrating Git checkouts, WASM compilation, and the pipeline.
- `measurement.ts`: Interacts with the Soroban RPC via `@stellar/stellar-sdk` to simulate transactions and extract resource metrics.
- `diff.ts`: Compares the benchmark metrics between the base and head branches.
- `threshold.ts`: Parses `weighin.toml` and evaluates the diffs against user-defined rules.
- `comment.ts`: Generates the markdown table posted to GitHub PRs.

## Local Development

To run the action locally, you need Node.js 24+.

```bash
# Install dependencies
npm install

# Build the TypeScript source
npm run build

# Bundle the action for distribution
npm run bundle
```

## Testing

Integration testing relies on running the action against the dummy contract in `contract/`. Currently, there is no unit test framework configured. A full unit test suite is on the roadmap.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to set up the project, run tests, and submit pull requests.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

### Configuration Validation
WeighIn strictly validates both `weighin.toml` and `weighin-fixtures.json` before any benchmarking begins. Typos in metric names or unsupported rule strings will cause the GitHub Action to fail early, protecting your CI pipeline from silently ignoring invalid threshold policies.
