# Contributing to WeighIn

Welcome to WeighIn! We appreciate your interest in contributing. WeighIn is a critical tool for Soroban developers to track resource footprint regressions in CI.

## Project Overview

WeighIn is a GitHub Action written in TypeScript. It automates benchmarking Soroban smart contracts by building them and simulating transactions against a local Stellar RPC network. The primary output is a detailed Markdown table posted on Pull Requests.

## Prerequisites

To develop WeighIn locally, you need:
- [Node.js](https://nodejs.org/) 24 or later
- [npm](https://www.npmjs.com/) 10+
- [Docker](https://www.docker.com/) (to run the local Soroban RPC via `stellar/quickstart`)
- [Rust](https://www.rust-lang.org/tools/install) (to build the dummy contracts during integration tests)

## Repository Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/WeighInNG/WeighIn.git
   cd WeighIn
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   *Note: We commit `package-lock.json` to ensure reproducible builds. Do not remove it.*

## Running the Build

To compile the TypeScript source to standard JavaScript:
```bash
npm run build
```

To bundle the action into a single file for GitHub Actions execution:
```bash
npm run bundle
```
You **must** run `npm run bundle` and commit the updated `bundled/index.js` file whenever you modify the TypeScript source code. GitHub Actions executes the bundled file directly.

## Running Tests

*Note: A formal unit test suite is planned but not currently implemented.*

Integration testing is performed by running the action against the dummy contract inside the `contract/` directory using the provided `scripts/start-local-network.sh`. 

## How the Benchmark Flow Works

1. **Compilation:** The action checks out both the base and head branches using `git worktree` to avoid expensive re-clones, and builds the WASM contracts using `cargo build --target wasm32-unknown-unknown`.
2. **Simulation:** The action reads `weighin-fixtures.json`, constructs Stellar transactions, and simulates them via the `@stellar/stellar-sdk` RPC client against the provided local RPC.
3. **Diffing:** It collects resource footprints (CPU instructions, memory, etc.), diffs them, and compares against `weighin.toml` rules.
4. **Reporting:** It formats a Markdown comment and posts it via the GitHub API.

## How the Source Tree is Organized

- `src/action.ts`: Action entry point. Handles inputs, git commands, and orchestrating the pipeline.
- `src/measurement.ts`: Contains RPC simulation logic and parses resource metrics.
- `src/diff.ts`: Calculates the difference between two sets of metrics.
- `src/threshold.ts`: Loads configuration and checks diffs against the limits.
- `src/comment.ts`: Generates the Markdown report.

## PR Expectations

When submitting a pull request:
1. Explain **what** changed and **why**.
2. If introducing new logic, explain how it was tested locally.
3. Run `npm run build` and `npm run bundle`, and commit the generated `bundled/index.js` along with your TypeScript source changes.
4. Maintainers will review the code, and if requested, make updates. CI will run the action against the internal dummy contract.

We look forward to your contributions!
