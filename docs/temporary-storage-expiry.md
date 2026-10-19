# Controlled Temporary-Storage Expiry Boundary Proof

This document and the archived evidence in [`docs/experiments/temporary-storage-expiry`](experiments/temporary-storage-expiry/) make temporary-storage TTL expiry behavior and measurement boundaries explicit across controlled ledgers (`940`, `949`, `950`, `951`, `960`), capturing both accepted live/evicted execution paths and fail-closed rejected boundary paths without manipulating claimed provenance or implementing restore/archive operations.

## Scope & Protocol Semantics

In Soroban Protocol 28, `ContractDataDurability.temporary()` entries (`env.storage().temporary()`) have distinct lifecycle rules at their TTL boundary (`liveUntilLedgerSeq` / `live_until`):

1. **Inclusive Live Boundary (`ledger_seq <= live_until`)**:
   - A temporary entry with `live_until = 950` is **live** at ledgers `940`, `949`, and at the exact boundary ledger `950` (`ledger_seq == live_until`, remaining TTL `0`).
   - Both Stellar RPC and the native simulation helper ([`native/simulation/src/main.rs`](../native/simulation/src/main.rs)) accept the entry as live when `live_until >= header.ledger_seq` (failing closed only when `ttl < header.ledger_seq`).
2. **Post-Expiry Eviction (`ledger_seq > live_until`)**:
   - Once the ledger advances past `live_until` (e.g. `ledger_seq = 951 > 950`), a temporary entry is **permanently evicted** from live ledger state.
   - Unlike `persistent()` entries, expired `temporary()` entries are never written to the hot archive and **cannot be restored** via `RestoreFootprintOp`.
   - When `getLedgerEntries` omits the evicted temporary key at `ledger_seq = 951`, `measureInvocation` records `{ key, xdr: null }` in the snapshot:
     - If the contract handles `env.storage().temporary().get(&key) == None` (cache-miss / re-initialization), execution succeeds along the post-expiry branch with a larger write footprint and higher compute/memory cost despite identical WASM bytes.
     - If the contract requires the expired temporary entry without a fallback initialization branch, RPC `simulateTransaction` traps (`HostError: Error(Storage, MissingValue)`) and WeighIn fails closed before invoking the native helper.
3. **Fail-Closed Rejection of Stale Expired Entries (`live_until < header.ledger_seq` with `xdr != null`)**:
   - If a snapshot supplies non-null entry XDR with `live_until < header.ledger_seq` (for example `live_until = 950` at `ledger_seq = 951`), [`native/simulation/src/main.rs`](../native/simulation/src/main.rs) rejects the snapshot immediately (`archived ledger state is unsupported`) without emitting a measurement or fabricating provenance.

## Proof-Only Contract & Fixed Interface

The isolated proof fixture in [`tests/fixtures/temporary-storage-expiry/`](../tests/fixtures/temporary-storage-expiry/) preserves the reference invocation signature `hello(env: Env, to: Symbol) -> Vec<Symbol>` and argument `Symbol("world")` (`case_id: "id:world"`), branching solely on whether the temporary storage entry `symbol_short!("temp_ttl")` is live (`Some`) or expired/evicted (`None`) ([`source/contract/src/lib.rs`](experiments/temporary-storage-expiry/source/contract/src/lib.rs)):

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

const TEMP_KEY: Symbol = symbol_short!("temp_ttl");
const TEMP_TTL_THRESHOLD: u32 = 16;
const TEMP_TTL_EXTEND_TO: u32 = 64;

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {
        let sequence = env.ledger().sequence();
        let mut out = vec![&env, symbol_short!("Hello"), to];
        if let Some(_cached_seed_ledger) = env.storage().temporary().get::<Symbol, u32>(&TEMP_KEY) {
            out.push_back(symbol_short!("live"));
        } else {
            env.storage().temporary().set(&TEMP_KEY, &sequence);
            env.storage()
                .temporary()
                .extend_ttl(&TEMP_KEY, TEMP_TTL_THRESHOLD, TEMP_TTL_EXTEND_TO);
            out.push_back(symbol_short!("expired"));
            out.push_back(symbol_short!("reinit"));
        }
        out
    }
}
```

### Invariant Controls

Across all five accepted runs ([`runs.json`](experiments/temporary-storage-expiry/runs.json)), the following inputs are held strictly constant:
- **Source Snapshot SHA-256**: `89d4fdc953badf8540b9521f7ff2ee9b8974ec6d1083e9133bf29a80146523b6`
- **Compiled WASM SHA-256**: `8b732e17decc370b0a57def5ba14546f48c788158aae520fffa5708117dc6c73`
- **Runtime Contract ID**: `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ`
- **Temporary Storage Key (`ContractDataDurability.temporary()`, `Symbol("temp_ttl")`)**: `AAAABgAAAAGElKRp6eXv+fifhiZjkU1cCDKOsE3XQDXE7tXZxb8oXQAAAA8AAAAIdGVtcF90dGwAAAAA`
- **Temporary Entry `live_until` Boundary**: Ledger `950`
- **Logical Identity**: `("id:temporary-storage-expiry-suite", "id:reference-contract", "hello", "id:world")`
- **Protocol & Calibration**: Protocol 28, `soroban-simulation 28.0.1`, compute config SHA-256 `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`, resource limits SHA-256 `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`
- **Auth & PRNG Seed**: `recording(true,true)`, host features `["recording_mode", "testutils"]`, fixed 32-byte zero seed (`[0; 32]`), no PRNG calls

## Accepted Paths Across the Expiry Boundary (`expiry-boundary.json` & `metrics.csv`)

The controlled progression steps across pre-expiry ledgers (`940`, `949`), the exact inclusive TTL boundary (`950`), the first post-expiry ledger (`951`), and a subsequent post-expiry snapshot (`960`) ([`expiry-boundary.json`](experiments/temporary-storage-expiry/expiry-boundary.json) and [`metrics.csv`](experiments/temporary-storage-expiry/metrics.csv)):

| Run | Ledger | Timestamp | Temporary Entry State | `live_until` | Remaining TTL | Return Value | CPU | Memory | RO+RW Entries | Disk Read Bytes | RW Entries | Write Bytes | Events | Events+Return Bytes |
|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 940 | 1791435800 | `live_pre_boundary` | `950` | `10` | `["Hello", "world", "live"]` | 278,610 | 1,132,400 | 3 | 0 | 0 | 0 | 0 | 56 |
| 2 | 949 | 1791435845 | `live_pre_boundary` | `950` | `1` | `["Hello", "world", "live"]` | 278,610 | 1,132,400 | 3 | 0 | 0 | 0 | 0 | 56 |
| 3 | 950 | 1791435850 | `live_exact_boundary` | `950` | `0` | `["Hello", "world", "live"]` | 278,610 | 1,132,400 | 3 | 0 | 0 | 0 | 0 | 56 |
| 4 | 951 | 1791435855 | `expired_evicted_reinitialized` | `null` | `null` | `["Hello", "world", "expired", "reinit"]` | 319,482 | 1,196,912 | 3 | 0 | 1 | 84 | 0 | 76 |
| 5 | 960 | 1791435900 | `expired_evicted_reinitialized` | `null` | `null` | `["Hello", "world", "expired", "reinit"]` | 319,482 | 1,196,912 | 3 | 0 | 1 | 84 | 0 | 76 |

### Diff & Threshold Enforcement Across the Boundary

1. **Pre-Expiry Control (`control-diff.json`, Ledger 940 → 949)**:
   Both snapshots read the live temporary entry (`live_until = 950 > ledger_seq`), yielding zero deltas across all 8 measured metrics (`hasRegression: false`) and zero threshold violations.
2. **Exact Inclusive TTL Boundary (`boundary-live-diff.json`, Ledger 940 → 950)**:
   At `ledger_seq = 950 == live_until`, the temporary entry remains live (`ttl_remaining = 0`), yielding zero deltas across all 8 measured metrics (`hasRegression: false`) and zero threshold violations.
3. **Cross-Expiry Transition (`expiry-diff.json` & `violations.json`, Ledger 950 → 951)**:
   Advancing by a single ledger from `950` (live) to `951` (evicted `xdr: null`) shifts `temp_ttl` from `readOnly` to `readWrite`, reports `hasRegression: true` (`CPU +40,872` / `+14.67%`, `memory +64,512`, `RW entries +1`, `write bytes +84`, `events+return bytes +20`), and enforces all **5 configured threshold violations** under [`weighin.toml`](experiments/temporary-storage-expiry/source/weighin.toml) without suppressing regressions on the unchanged WASM artifact.

## Rejected Paths & Cross-Boundary Drift Handling (`rejected-paths.json`)

All rejected expiry-boundary paths and cross-boundary drift captures are archived in [`rejected-paths.json`](experiments/temporary-storage-expiry/rejected-paths.json) with claimed provenance left unmanipulated:

| Case ID | Boundary Scenario | Ledger / `live_until` | Outcome | Observed Guard / Error | Measurement / Provenance Emitted |
|---|---|---|---|---|---|
| `stale_expired_temporary_entry_snapshot` | Snapshot at ledger `951` supplies non-null temporary entry XDR with `live_until = 950` (`live_until < header.ledger_seq`) | `951` / `950` | `REJECTED` | `Simulation helper failed: Error: archived ledger state is unsupported` | `false` / `false` |
| `required_expired_temporary_entry_rpc_failure` | Contract requires expired temporary entry at ledger `951` with no fallback initialization path | `951` / `950` | `REJECTED` | `RPC simulation failed: HostError: Error(Storage, MissingValue)` (`helper_invocations: 0`) | `false` / `false` |
| `cross_boundary_rpc_native_parity_mismatch` | RPC returns pre-expiry cached result while ledger `951` snapshot has evicted the expired temporary entry | `951` / `950` | `REJECTED` | `Local simulation disagrees with RPC at captured ledger [transaction-data disagreement ...; return-value disagreement ...]` | `false` / `false` |
| `persistent_cross_boundary_ledger_drift_exhaustion` | `simulateTransaction` runs at ledger `950` (live) and `getLedgerEntries` drifts to ledger `951` (expired) across all 30 attempts | `950 → 951` | `REJECTED` | `Unable to capture a complete consistent snapshot after 30 attempts (last cause: ledger_drift...)` (`helper_invocations: 0`) | `false` / `false` |
| `single_cross_boundary_drift_recapture_at_951` | Attempt 1 simulates at ledger `950` and drifts to `951`; Attempt 2 recaptures full consistent state at ledger `951` | `950 → 951` | `ACCEPTED_AFTER_FULL_RECAPTURE` | Discards Attempt 1 (`950`); emits authentic `provenance.ledger = 951` matching Run 4 without backdating provenance | `true` (`ledger: 951`) |

## TTL-Dependent Measurement Scope & Unavailable Outcomes

- **Single-Ledger Snapshot Scope**: WeighIn measures resource consumption at the single ledger recorded in `provenance.ledger`. It does not simulate multi-ledger TTL decay, synthesize `ExtendFootprintTtlOp` or `RestoreFootprintOp` preambles, or project future archival/expiry state.
- **No Restore for Temporary Storage**: Temporary storage entries (`ContractDataDurability.temporary()`) have no archived state and cannot be restored once `ledger_seq > live_until`.
- **Unavailable Outcomes**:
  1. **Schema-4 Unsupported Metrics**: `historical_data_read_bytes`, `contract_data_hard_limit`, and `tx_size_bytes` remain explicitly `unavailable` (`consumed: null`, `limit: null`) with their documented protocol reasons in all accepted live and post-expiry runs.
  2. **Fail-Closed Expiry Rejections**: When a snapshot contains stale expired state (`live_until < header.ledger_seq`), when an expired required temporary entry traps in RPC simulation, when RPC and native simulation disagree across the expiry boundary, or when cross-boundary ledger drift exhausts retry attempts, WeighIn fails closed and emits **no measurement record and no provenance** rather than coercing metrics to `0` or `unavailable`.

## Archived Evidence & Reproduction

The archive in [`docs/experiments/temporary-storage-expiry/`](experiments/temporary-storage-expiry/) retains:
- [`environment.json`](experiments/temporary-storage-expiry/environment.json): Toolchain, protocol, calibration hashes, temporary storage key XDR, `live_until` boundary (`950`), and invariant controls.
- [`expiry-boundary.json`](experiments/temporary-storage-expiry/expiry-boundary.json) & [`metrics.csv`](experiments/temporary-storage-expiry/metrics.csv): Step-by-step ledger inputs, TTL state, XDR return values, and measured metrics across ledgers `940`–`960`.
- [`runs.json`](experiments/temporary-storage-expiry/runs.json), [`rpc.json`](experiments/temporary-storage-expiry/rpc.json), [`native.json`](experiments/temporary-storage-expiry/native.json), & [`rejected-paths.json`](experiments/temporary-storage-expiry/rejected-paths.json): Full schema-4 measurement records, raw RPC simulation responses, native simulation inputs/outputs, and rejected boundary records.
- [`analysis.json`](experiments/temporary-storage-expiry/analysis.json): Repeatability series statistics showing `REPEATABILITY_VARIATION_FOUND` with `wasm_stable: true`.
- [`control-diff.json`](experiments/temporary-storage-expiry/control-diff.json), [`boundary-live-diff.json`](experiments/temporary-storage-expiry/boundary-live-diff.json), [`expiry-diff.json`](experiments/temporary-storage-expiry/expiry-diff.json), [`policy.json`](experiments/temporary-storage-expiry/policy.json), [`violations.json`](experiments/temporary-storage-expiry/violations.json), & [`summary.md`](experiments/temporary-storage-expiry/summary.md): Pre-expiry, exact-boundary, and post-expiry diffs, policy evaluation, and rendered markdown report.
- [`verification.json`](experiments/temporary-storage-expiry/verification.json) & [`sha256.json`](experiments/temporary-storage-expiry/sha256.json): Verification record and SHA-256 manifest verified by [`tests/temporary-storage-expiry.test.cjs`](../tests/temporary-storage-expiry.test.cjs).

To regenerate and verify the controlled experiment archive:

```bash
npm run build
node tests/experiments/verify-temporary-storage-expiry.cjs /tmp/weighin-temporary-storage-expiry
node --test tests/temporary-storage-expiry.test.cjs tests/documentation.test.cjs
```
