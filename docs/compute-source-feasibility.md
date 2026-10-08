# Measured compute source feasibility

Date: 2026-10-07. Outcome at this stage: **source feasible**.
The subsequent [native integration](native-measurement.md) supersedes the
production blocker described below; this report preserves the spike results.

This approved experiment used a temporary Rust helper, not a production
measurement replacement. No contract regression was added to product code.

## Environment and source

- Repository SHA `59db63a7b895dcc5ca763e3c668990fec40850fb`, branch
  `test/no-op-baseline`, with prior uncommitted Stage 1A/1B changes.
- Dedicated quickstart image
  `sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5`.
- RPC 29.0.0, Core v29.0.0, protocol 28, captured ledger 229.
- Rust 1.95.0; `soroban-simulation` and `soroban-env-host` exactly 28.0.1.
- Host features `recording_mode` and `testutils`, matching the tested RPC's
  [preflight manifest](https://github.com/stellar/stellar-rpc/blob/8a40169717723697e430c1e51c21ef0bf244ecda/cmd/stellar-rpc/lib/preflight/Cargo.toml).
- SDK 16.0.1 for JS; bundled contract SDK 25.3.1. Previously built temporary
  `wasm32v1-none` release artifacts were reused, not rebuilt in this stage.

CPU and memory come directly from `simulated_instructions` and
`simulated_memory` in the official library. These are Soroban cost-model meters,
not hardware instruction counts or process RSS. Limits come from the captured
network configuration: 400,000,000 instructions and 41,943,040 memory bytes.

Both versions share the exact captured ledger entries, extensions, TTL metadata,
network configuration, header and zero-filled 32-byte PRNG seed. The capture
distinguishes queried absence from uncaptured keys. The helper uses recording
auth mode `(true, true)`; this bundled fixture requires no authorization.

Initial host feature/auth choices produced different budgets from RPC. Matching
RPC's feature flags and auth mode produced exact transaction-data parity. These
settings must be recorded as measurement inputs in any production adapter.

## Results

HEAD adds one temporary persistent write before the unchanged `hello` return:

```rust
env.storage().persistent().set(&symbol_short!("bench"), &to);
```

| Value | BASE | Temporary HEAD | Delta |
| --- | ---: | ---: | ---: |
| Consumed CPU instructions | 270,219 | 314,046 | +43,827 (+16.22%) |
| Consumed memory bytes | 1,125,761 | 1,193,705 | +67,944 |
| Read-write footprint entries | 0 | 1 | +1 |
| Transaction write bytes | 0 | 88 | +88 |
| Contract events | 0 | 0 | 0 |

BASE WASM SHA256:
`949a7203657f6e37d8171facef42797af7f53d1158f070a7d04fcb91479329b2`.
HEAD WASM SHA256:
`17fbea6f1abb98b3f80099dab37b5ef78354decf8e23f37e5efecc69627c8082`.
Runtime addresses differ; the public fixture parser produces the same
`(fixture_id, logical_id, function_name, case_id)` tuple. The declared fixture
WASM key still contains `wasm32-unknown-unknown`; it is a comparison identifier,
while the actual resolved artifacts above were built for `wasm32v1-none`.

- Five fresh helper processes per revision returned identical complete outputs.
- Increasing instruction leeway to 5,000,000 left both consumed meters unchanged.
  BASE instruction budget changed from 320,219 to 5,270,219; HEAD from 364,046
  to 5,314,046.
- Entire transaction-data XDR, footprint and return value match each revision's
  raw RPC simulation at the same ledger. Raw RPC exposes no CPU/memory meters;
  this is resource/context corroboration, not direct RPC compute verification.
- Eight negative checks rejected malformed input/output, a missing output meter,
  missing config, uncaptured contract state, protocol mismatch, a failed function
  invocation and an invalid seed. Native failures emitted no successful JSON.
  The two output failures were tested in the experiment's transport validator.
- The existing threshold evaluator detected one strict-zero-tolerance CPU
  violation using the genuine measured delta.

## Integration boundary and validation

The existing `diffBenchmarks` rejects partial CPU/memory records with
`Cannot read properties of undefined (reading 'consumed')`: it requires all
eleven metrics. Unsupported metrics were not filled with guessed or zero values.
The threshold proof therefore supplied a measured CPU delta directly to
`enforceThresholds`; it does **not** prove the complete production diff, report,
Action, CLI or CI failure path.

`requireComputeConsumption` remains a deliberate unavailable-compute error.
Production WeighIn still cannot emit these measurements. Native helper
provisioning, snapshot discovery, protocol support and explicit metric
availability are integration prerequisites. Auth-dependent, archived-state and
random-dependent contracts remain outside this auth-free fixture proof.

Validation commands passed:

- `cargo build --release --locked --manifest-path /tmp/weighin-compute-spike/helper/Cargo.toml`
- `node /tmp/weighin-compute-spike/verify.cjs` (live capture verification)
- `npm test` (includes TypeScript build; both existing test files pass)

Native execution and dependency access needed sandbox escalation in this
environment. No npm dependencies, product code, bundle or CI files changed in
this stage. No fresh install/bundle gate is claimed. Snapshot repeatability does
not establish repeated clean-build or live-network repeatability.

## Saved evidence and offline replay

[Evidence directory](experiments/compute-source-spike/) contains full immutable
inputs, raw RPC captures, outputs, five-run results, negative diagnostics,
threshold input/violation, provenance and a checksummed capture manifest.
The helper source, manifest and lockfile are inert evidence artifacts, not a
production crate. No private keys are included.

From the repository root, with Rust 1.95.0, Python 3, build tools and dependency
access, copy the archived source into a new temporary crate and replay it:

```bash
evidence="$PWD/docs/experiments/compute-source-spike"
spike_dir=$(mktemp -d /tmp/weighin-compute-replay.XXXXXX)
mkdir -p "$spike_dir/src"
cp "$evidence/helper-source.rs" "$spike_dir/src/main.rs"
cp "$evidence/helper-Cargo.toml" "$spike_dir/Cargo.toml"
cp "$evidence/helper-Cargo.lock" "$spike_dir/Cargo.lock"
cargo +1.95.0 build --release --locked --manifest-path "$spike_dir/Cargo.toml"
python3 "$evidence/replay.py" "$spike_dir/target/release/weighin-compute-spike"
```

Replay uses only saved snapshots, requires no running RPC or secret, and verifies
five runs, saved outputs, raw RPC XDR/return parity, leeway independence and a
positive measured delta. The original verification harness is archived for
inspection; its absolute temporary paths are historical, not portable replay
instructions. It records the additional identity, negative and threshold checks.

## Next proposed stage

Approve a narrow production integration: versioned native helper and lockfile,
validated Node transport, consistent snapshot capture, compute provenance,
explicit unavailable metrics throughout diff/report/threshold consumers, and
Linux runtime provisioning. A configured unavailable metric must fail explicitly.
Prove it with the real control/regression and threshold exit path. This required
subset of metric semantics comes before the broader Stage 3 audit; general
toolchain modernization and baseline-policy repair remain separate stages.
