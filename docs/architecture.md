# Architecture

WeighIn is a Node.js-based GitHub Action built in TypeScript. Its goal is to benchmark Soroban smart contracts on pull requests and detect regressions in resource consumption.

## Problem Being Solved
Soroban smart contracts are billed based on exact resource footprint metrics: CPU instructions, memory bytes, ledger I/O, and events. Unintended changes to these metrics can cause unexpected fee increases. WeighIn automatically catches these regressions in CI before they are merged.

## High-Level Architecture
The action's execution flow is primarily orchestrated by `src/action.ts`, broken down into modular responsibilities:

1. **Git/Worktree Strategy**:
   To avoid expensive deep clones, WeighIn uses a `git worktree` approach. It creates a temporary directory and checks out the base branch of the PR. This ensures both the base code and the PR code are available on disk simultaneously.

2. **Benchmark Lifecycle**:
   - The action parses `weighin-fixtures.json` to determine which WASM files to build and which functions to invoke.
   - It runs `cargo build --target wasm32-unknown-unknown` in the respective contract directories for both the base and head branches.

3. **Soroban RPC Interaction**:
   - Implemented in `src/measurement.ts`.
   - The action uses the `@stellar/stellar-sdk` to craft simulated transactions corresponding to the functions listed in the fixtures.
   - It submits these via RPC (`simulateTransaction`) to a local Soroban standalone network (usually provided by `stellar/quickstart`).
   - The RPC simulation returns the precise resource footprint of the execution (CPU, memory, etc.).

4. **Base vs Head Comparison**:
   - Implemented in `src/diff.ts`.
   - Once both branches are benchmarked, the results are zipped together and the absolute and percentage differences are calculated.

5. **Threshold Evaluation**:
   - Implemented in `src/threshold.ts`.
   - WeighIn reads `weighin.toml` to load user-defined limits (e.g., maximum memory allowed) and regression rules (e.g., maximum 5% increase in CPU instructions).
   - If the calculated differences violate these rules, the threshold module surfaces these as violations.

6. **PR Comment Generation**:
   - Implemented in `src/comment.ts`.
   - Finally, the action generates a rich Markdown table detailing the before/after metrics and highlights any threshold violations. It posts this directly to the GitHub PR.

## Important Boundaries/Failure Modes
- **RPC Availability**: The action expects a healthy Soroban RPC running at `rpc-url`. If the container takes too long to start, the action fails gracefully.
- **Uncommitted Bundles**: Since GitHub Actions executes the `bundled/index.js` file, any TS changes must be bundled. Out-of-sync bundles are a common failure mode and should be caught by CI.
