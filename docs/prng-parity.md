# Bounded PRNG-Dependent Parity Boundary Proof

This document and the archived evidence in [`docs/experiments/prng-parity`](experiments/prng-parity/) prove the documented random-dependent parity boundary (`weighin-backlog:U02` / issue `#171`) with a bounded PRNG-dependent Soroban contract (`env.prng().gen_range::<u64>(1..=16)`).

The proof verifies both sides of the native replay parity contract without silently overriding the PRNG seed or fabricating zeroed metrics:

1. **Justified Matching Condition**: When RPC simulation and native `soroban-simulation` replay share the same 32-byte zero base seed (`FIXED_NATIVE_PRNG_SEED = [0; 32]`) at the captured ledger snapshot, both executions draw the identical pseudorandom value (`draw = 11`), produce byte-for-byte identical `transaction_data_xdr`, `retval_xdr`, and `contract_events_xdr`, and preserve genuine nonzero measured metrics across all 8 supported dimensions.
2. **Fail-Closed Parity Rejection**: Whenever RPC simulation and native replay diverge on PRNG draws (or when a malformed non-32-byte seed is supplied to the native helper), `measureInvocation` in [`src/simulation.ts`](../src/simulation.ts) rejects the invocation fail-closed with structured `SimulationParityDetails` rather than blending incompatible RPC footprint/event resources with native CPU/memory measurements or silently forcing a custom seed.

## Scope Boundary vs. Ledger-Dependent Variation (`#77`)

- **This proof (`#171` / `U02`)** isolates **randomness and recording-auth replay parity (`env.prng()`)** at a single fixed snapshot (`ledger = 910`, `timestamp = 1791435852`). The proof contract contains zero `env.ledger()` calls.
- **Nearby proof (`docs/ledger-variation.md` / `#77` / `H03`)** isolates **cross-ledger resource variation (`env.ledger().sequence()` and `env.ledger().timestamp()`)** across advancing ledgers with zero PRNG calls.

## Proof Contract & Fixed Interface

The isolated fixture in [`tests/fixtures/prng-parity/`](../tests/fixtures/prng-parity/) exposes `sample_prng(env: Env, label: Symbol) -> Vec<u64>` ([`source/contract/src/lib.rs`](experiments/prng-parity/source/contract/src/lib.rs)):

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

#[contract]
pub struct PrngParityContract;

#[contractimpl]
impl PrngParityContract {
    /// Bounded PRNG-dependent invocation used to prove WeighIn's random-dependent
    /// parity boundary (#171 / U02). Does not read `env.ledger()` (covered by #77).
    pub fn sample_prng(env: Env, label: Symbol) -> Vec<u64> {
        let draw: u64 = env.prng().gen_range::<u64>(1..=16);
        env.storage()
            .persistent()
            .set(&symbol_short!("prng_draw"), &(label.clone(), draw));
        env.events()
            .publish((symbol_short!("prng"), label), draw);

        let mut out = vec![&env, draw];
        let mut step = 1u64;
        while step <= draw {
            out.push_back(step);
            step += 1;
        }
        out
    }
}
```

Every invocation of `sample_prng` makes its return value (`Vec<u64>` of length `draw + 1`), persistent contract data write (`prng_draw`), and charged contract event (`("prng", label) -> draw`) directly dependent on the PRNG draw in `1..=16`.

### Invariant Controls

Across all archived captures ([`environment.json`](experiments/prng-parity/environment.json)), the following inputs are held strictly constant:

- **Source Snapshot SHA-256**: `e42ce724f3f79286ef564ac12300b2dc5d2f897bbcd1d5a83cb55ac05f57242b`
- **Compiled WASM SHA-256**: `fafc0efd6f95386ad90be5971adfb1daf6dc63e373c7b166aeaa3336f0056f3e`
- **Runtime Contract ID**: `CD5T4LCKOLORWNVRJ5HRAYAFP2MDZJZIWILXKKLSW6K5P3CS3VLUUSPX`
- **Logical Identity**: `("id:prng-parity-suite", "id:prng-contract", "sample_prng", "id:draw")`
- **Captured Snapshot**: Ledger `910`, close timestamp `1791435852`, Protocol `28`, `soroban-simulation 28.0.1`
- **Native Replay Seed**: `FIXED_NATIVE_PRNG_SEED` (`32` zero bytes: `[0, 0, ..., 0]`), `silent_seed_override_used: false`, `ledger_branching_used: false`

## Part 1: Justified Matching Condition (`zero_seed_parity_1` & `zero_seed_parity_2`)

When both Soroban RPC preflight and the native `soroban-simulation` helper initialize the frame PRNG from the default 32-byte zero base seed (`[0; 32]`) at ledger `910`, `env.prng().gen_range::<u64>(1..=16)` deterministically draws `11` (`return_vector = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]`).

Both independent captures in [`measurements.json`](experiments/prng-parity/measurements.json) pass the strict parity check in `measureInvocation` and produce identical genuine nonzero metrics:

| Run | Case | Native Seed | PRNG Draw | CPU Instructions | Memory Bytes | RO+RW Entries | Disk Read Bytes | RW Entries | Write Bytes | Charged Events | Events+Return Bytes |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `zero_seed_parity_1` | `[0; 32]` | `11` | 342,616 | 1,198,240 | 3 | 144 | 1 | 96 | 1 | 244 |
| 2 | `zero_seed_parity_2` | `[0; 32]` | `11` | 342,616 | 1,198,240 | 3 | 144 | 1 | 96 | 1 | 244 |

The three unsupported metrics (`historical_data_read_bytes`, `contract_data_hard_limit`, `tx_size_bytes`) remain explicitly `unavailable` (`consumed: null`, `limit: null`) with their documented Protocol 28 reasons. Comparing Run 1 → Run 2 through `diffBenchmarks` and `enforceThresholds` ([`control-diff.json`](experiments/prng-parity/control-diff.json) and [`violations.json`](experiments/prng-parity/violations.json)) yields zero metric deltas (`hasRegression: false`) and zero threshold violations.

## Part 2: Fail-Closed Parity Rejection on Divergent PRNG Draws (`rejections.json`)

Because `measureInvocation` never accepts a user-supplied or RPC-derived PRNG seed override and always passes `FIXED_NATIVE_PRNG_SEED` (`[0; 32]`) to the native helper, any invocation where RPC preflight draws from a different PRNG state diverges from native replay and is rejected fail-closed ([`rejections.json`](experiments/prng-parity/rejections.json)):

| Rejection Case | RPC PRNG Draw | Native PRNG Draw (`[0; 32]`) | `transactionData` Mismatch | `returnValue` Mismatch | `contractEvents` Mismatch | Outcome |
|---|---:|---:|:---:|:---:|:---:|---|
| `divergent_seed_full_disagreement` | `4` | `11` | `true` | `true` | `true` | Fail-closed (`transaction-data disagreement, return-value disagreement, ordered charged-event disagreement`) |
| `divergent_return_value_only` | `7` | `11` | `false` | `true` | `false` | Fail-closed (`return-value disagreement`) |
| `divergent_transaction_data_only` | `9` | `11` | `false` → `true` (`txData`) | `false` | `false` | Fail-closed (`transaction-data disagreement`) |
| `divergent_events_only` | `3` | `11` | `false` | `false` | `true` | Fail-closed (`ordered charged-event disagreement`) |
| `malformed_native_seed_rejected` | `—` | `seed: [0]` (1 byte) | `—` | `—` | `—` | Fail-closed (`PRNG seed must be exactly 32 bytes`) |

In every divergent case:
- `blended_resources_emitted` is `false` (no hybrid measurement record combining RPC footprint/events with native CPU/memory is produced).
- `silent_seed_override_used` is `false` (`parityDetails.seed` remains `[0; 32]`).
- The thrown error attaches `parityDetails` (`SimulationParityDetails`) with the SHA-256 digests of both native and RPC `transaction_data_xdr` and `contract_events_xdr` plus both `retval_xdr` payloads for diagnostic auditability.

## Archived Evidence & Reproduction

The archive in [`docs/experiments/prng-parity/`](experiments/prng-parity/) retains:
- [`environment.json`](experiments/prng-parity/environment.json): Toolchain, protocol, calibration hashes, fixed zero seed, and invariant controls.
- [`measurements.json`](experiments/prng-parity/measurements.json): Full schema-4 measurement records for the two justified zero-seed parity runs.
- [`rejections.json`](experiments/prng-parity/rejections.json): Structured fail-closed rejection records and `SimulationParityDetails` across all 5 divergence/seed failure modes.
- [`rpc.json`](experiments/prng-parity/rpc.json) & [`native.json`](experiments/prng-parity/native.json): Raw RPC JSON-RPC captures and native `soroban-simulation` stdin/stdout payloads across all 7 cases.
- [`control-diff.json`](experiments/prng-parity/control-diff.json), [`policy.json`](experiments/prng-parity/policy.json), [`violations.json`](experiments/prng-parity/violations.json), & [`summary.md`](experiments/prng-parity/summary.md): Diff, policy evaluation, and rendered markdown report for the justified matching runs.
- [`verification.json`](experiments/prng-parity/verification.json) & [`sha256.json`](experiments/prng-parity/sha256.json): Verification summary and SHA-256 manifest verified by [`tests/prng-parity.test.cjs`](../tests/prng-parity.test.cjs).

To regenerate and verify the bounded PRNG parity archive:

```bash
npm run build
node tests/experiments/verify-prng-parity.cjs
node --test tests/prng-parity.test.cjs
```
