# Discarded Benchmark Simulation Writes Proof (#172)

## Overview

- **Fixture**: `tests/fixtures/discarded-writes/weighin-fixtures.json` (`id:discarded-writes-fixture`)
- **Contract ID**: `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ` (fresh standalone deployment at ledger `1100`)
- **WASM SHA-256**: `309dc48348de58b63f17c396fa075ba5839283abef31f4e7f52c07a87b049ead`
- **Persistent State Key XDR (`state`)**: `AAAABgAAAAGElKRp6eXv+fifhiZjkU1cCDKOsE3XQDXE7tXZxb8oXQAAAA8AAAAFc3RhdGUAAAAAAAAB`
- **Submitted Transactions**: `2` (`uploadContractWasm` and `createCustomContract`); `0` invocation transactions submitted.

## Write-Then-Read Sequence on a Fresh Deployment

| Order | Case ID | Arg | Transaction Submitted? | Simulated Write Entries / Bytes | Committed `state` Entry Before / After | Decoded Return Value |
|---|---|---|---|---|---|---|
| 1 | `id:write-seed` | `"write"` | `false` (simulated only) | `1` / `88` | `null` / `null` | `["Hello","write","wrote","seeded"]` |
| 2 | `id:read-after-write` | `"read"` | `false` (simulated only) | `0` / `0` | `null` / `null` | `["Hello","read","absent","uninit"]` |
| Control | `id:read-after-write` (when `state` is committed) | `"read"` | N/A (committed state control) | `0` / `0` | `present` / `present` | `["Hello","read","present","seeded"]` |

## Why Committed Setup Is Required

runMeasurement submits only WASM upload and contract instance creation transactions, then executes each configured fixture invocation strictly through RPC simulateTransaction and the offline native helper (measureInvocation). Because simulated ledger writes from id:write-seed are never signed, submitted, or included in a ledger, the persistent state key remains absent (entry_xdr: null) on-chain when id:read-after-write runs next. Consequently, id:read-after-write observes committed state (["Hello","read","absent","uninit"]) rather than the discarded simulated write (["Hello","read","present","seeded"]), and any case that requires pre-initialized state (mode "require") traps during simulation. Benchmarks that depend on initialized contract state or prior invocation outputs therefore require an explicit committed setup phase (#58, docs/fixture-setup-design.md) that submits and confirms setup transactions before measured simulation begins.

See [Committed fixture setup and typed dependency design](../../fixture-setup-design.md) (`#58`) for the dedicated committed-setup architecture.

## Resource Comparison: Unseeded Read (After Discarded Write) vs Committed-State Read

## 🔴 WeighIn Benchmark Report

**3 threshold violations** — comparing `4f266c5a371240a99335c3e954771791a2e229a1` → `4f266c5a`

### ❌ Violations

- **`id:discarded-writes-fixture / id:reference-contract / hello / id:read-after-write` / CPU Instructions**: cpu_instructions increased by 8740 (strict zero tolerance)
- **`id:discarded-writes-fixture / id:reference-contract / hello / id:read-after-write` / Disk Read Bytes**: ledger_read_bytes increased by 88 (strict zero tolerance)
- **`id:discarded-writes-fixture / id:reference-contract / hello / id:read-after-write` / Memory Bytes**: memory_bytes increased by 4280 (strict zero tolerance)

### Contract `id:discarded-writes-fixture / id:reference-contract`

Runtime addresses: BASE `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ` → HEAD `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ`

#### `hello / id:read-after-write`

Compute source: soroban-simulation 28.0.1; protocol 28.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| 🔴 | CPU Instructions | 274,910 | 283,650 | +8,740 | +3.2% | 400,000,000 |
| 🔴 | Memory Bytes | 1,126,840 | 1,131,120 | +4,280 | +0.4% | 41,943,040 |
| ⚪ | Footprint Entries (RO + RW) | 3 | 3 | ±0 | — | 400 |
| 🔴 | Disk Read Bytes | 1,584 | 1,672 | +88 | +5.6% | 200,000 |
| ⚪ | Write Footprint Entries | 0 | 0 | ±0 | — (BASE 0) | 200 |
| ⚪ | Ledger Write Bytes | 0 | 0 | ±0 | — (BASE 0) | 132,096 |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Successful Contract/System Events | 0 | 0 | ±0 | — (BASE 0) | No independent limit |
| ⚪ | Events + Return XDR Bytes | 72 | 72 | ±0 | — | 16,384 |

- **Historical Read Bytes unavailable**: BASE: Protocol 28 exposes historical-data fees, not a historical read consumption resource; HEAD: Protocol 28 exposes historical-data fees, not a historical read consumption resource
- **Contract Data (instance) unavailable**: BASE: No verified instance-only post-invocation size and corresponding limit mapping; HEAD: No verified instance-only post-invocation size and corresponding limit mapping
- **Tx Size Bytes unavailable**: BASE: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted; HEAD: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted

<details><summary>Snapshot and metric provenance</summary>

Snapshot ledgers: BASE 1101 → HEAD 1101.
Compute config SHA256: BASE `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5` → HEAD `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `a6e84f17da21d6b7d7770782a828e61367211c706a7c8289470e8667289d191e` → HEAD `a6e84f17da21d6b7d7770782a828e61367211c706a7c8289470e8667289d191e`.
Resource limits SHA256: BASE `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9` → HEAD `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`.
Helper SHA256: BASE `e7785adc8b991dfd83dc28b12bde717384dc76229cc53c19971db7867db313ea` → HEAD `e7785adc8b991dfd83dc28b12bde717384dc76229cc53c19971db7867db313ea`.
- **CPU Instructions** source: `soroban-simulation.simulated_instructions`; limit: `ConfigSettingContractComputeV0.txMaxInstructions`.
- **Memory Bytes** source: `soroban-simulation.simulated_memory`; limit: `ConfigSettingContractComputeV0.txMemoryLimit`.
- **Footprint Entries (RO + RW)** source: `SorobanResources.footprint.readOnly.length + readWrite.length`; limit: `ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries`.
- **Disk Read Bytes** source: `SorobanResources.diskReadBytes (identity adjustment)`; limit: `ConfigSettingContractLedgerCostV0.txMaxDiskReadBytes`.
- **Write Footprint Entries** source: `SorobanResources.footprint.readWrite.length`; limit: `ConfigSettingContractLedgerCostV0.txMaxWriteLedgerEntries`.
- **Ledger Write Bytes** source: `SorobanResources.writeBytes (identity adjustment)`; limit: `ConfigSettingContractLedgerCostV0.txMaxWriteBytes`.
- **Successful Contract/System Events** source: `successful non-diagnostic ContractEvents.length`; limit: Protocol 28 has no independent event-count cap.
- **Events + Return XDR Bytes** source: `sum(successful non-diagnostic ContractEvent XDR bytes) + return ScVal XDR bytes`; limit: `ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes`.

</details>

---

<details><summary>Known measurement gaps</summary>

- **Unavailable metrics** are shown explicitly; configured policies requiring them fail.
- **Compute** uses protocol-matched native simulation and captured network cost settings.
- **WASM build determinism**: cross-CI-run hash equality has not yet been verified
  in two separate GitHub Actions runs. Snapshot repeatability does not prove build repeatability.

</details>

<!-- weighin-report -->

