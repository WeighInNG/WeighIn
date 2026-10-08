# Architecture

WeighIn is a TypeScript GitHub Action and CLI for comparing configured Soroban
benchmarks between a base revision and HEAD. It builds each revision, executes
the same fixture cases against a local Soroban RPC, records resource metrics,
compares logical benchmark identities, evaluates policy, and writes a Markdown
report. The Action exits unsuccessfully when a required comparison fails or a
configured threshold is violated.

## Benchmark lifecycle

1. `src/action.ts` resolves the configured fixture and policy from the HEAD
   workspace and checks that the supplied RPC is healthy.
2. The HEAD revision is built and measured. The base ref is fetched into a
   detached Git worktree, then built and measured using the same fixture
   declaration and RPC.
3. `src/build.ts` selects Cargo packages from fixture WASM paths and builds
   them with the optimized Stellar CLI contract build command. The default
   target is `wasm32v1-none`. An explicit custom build command or prebuilt-WASM
   mode can be selected through Action inputs.
4. `src/measurement.ts` deploys each selected WASM and invokes configured
   functions through Soroban RPC simulation and the native snapshot-measurement
   helper. Runtime contract IDs and WASM hashes describe each deployment and
   artifact; they do not define whether two benchmark cases are logically the
   same.
5. `src/identity.ts` derives stable fixture, contract, and case identities.
   `src/diff.ts` pairs records using those identities and the function name,
   then calculates metric deltas. Runtime contract IDs remain in results for
   diagnostics.
6. `src/threshold.ts` validates relative regression policies and configured
   absolute limits. Required comparisons, invalid inputs, and unavailable
   policy metrics fail closed.
7. `src/comment.ts` renders the report. The Action can write a Markdown report
   and PR metadata as artifacts; the separate `comment/` Action posts it with a
   narrowly scoped token in a fork-safe workflow.

## Measurement boundaries

Resource values come from the local Soroban simulation environment and the
native measurement adapter. Their provenance, limits, and unavailable fields
are retained in result records and reports. See
[Metric provenance](metric-provenance.md) for which values are measured,
derived, or unavailable. A successful comparison describes the configured
fixtures and local simulation environment; it does not claim equivalence to
all public networks or production validator settings.

## Build and workflow boundaries

The Action expects the caller to provide a healthy Soroban RPC endpoint and a
compatible Stellar CLI/Rust toolchain. The bundled GitHub Action runs from
`bundled/index.js`; `npm run bundle` regenerates its runtime artifact. CI checks
formatting, types, tests, bundle freshness, and the configured benchmark proof.
