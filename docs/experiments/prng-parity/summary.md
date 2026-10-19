## 🟢 WeighIn Benchmark Report

**All thresholds passed** — comparing `zero-seed-run-1` → `zero-see`

### Contract `id:prng-parity-suite / id:prng-contract`

Runtime addresses: BASE `CD5T4LCKOLORWNVRJ5HRAYAFP2MDZJZIWILXKKLSW6K5P3CS3VLUUSPX` → HEAD `CD5T4LCKOLORWNVRJ5HRAYAFP2MDZJZIWILXKKLSW6K5P3CS3VLUUSPX`

#### `sample_prng / id:draw`

Compute source: soroban-simulation 28.0.1; protocol 28.
Snapshot ledgers: BASE 910 → HEAD 910; compute config SHA256: `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `249e6aaf6c497cb708e9966bc40d5eeb2f729c8a15eea72d37efd70ee0e9f5d1` → HEAD `249e6aaf6c497cb708e9966bc40d5eeb2f729c8a15eea72d37efd70ee0e9f5d1`.
Resource limits SHA256: `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| ⚪ | CPU Instructions | 342,616 | 342,616 | ±0 | — | 400,000,000 |
| ⚪ | Memory Bytes | 1,198,240 | 1,198,240 | ±0 | — | 41,943,040 |
| ⚪ | Footprint Entries (RO + RW) | 3 | 3 | ±0 | — | 400 |
| ⚪ | Disk Read Bytes | 144 | 144 | ±0 | — | 200,000 |
| ⚪ | Write Footprint Entries | 1 | 1 | ±0 | — | 200 |
| ⚪ | Ledger Write Bytes | 96 | 96 | ±0 | — | 132,096 |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Successful Contract/System Events | 1 | 1 | ±0 | — | No independent limit |
| ⚪ | Events + Return XDR Bytes | 244 | 244 | ±0 | — | 16,384 |

- **Historical Read Bytes unavailable**: BASE: Protocol 28 exposes historical-data fees, not a historical read consumption resource; HEAD: Protocol 28 exposes historical-data fees, not a historical read consumption resource
- **Contract Data (instance) unavailable**: BASE: No verified instance-only post-invocation size and corresponding limit mapping; HEAD: No verified instance-only post-invocation size and corresponding limit mapping
- **Tx Size Bytes unavailable**: BASE: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted; HEAD: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted
- **CPU Instructions** source: `soroban-simulation.simulated_instructions`; limit: `ConfigSettingContractComputeV0.txMaxInstructions`.
- **Memory Bytes** source: `soroban-simulation.simulated_memory`; limit: `ConfigSettingContractComputeV0.txMemoryLimit`.
- **Footprint Entries (RO + RW)** source: `SorobanResources.footprint.readOnly.length + readWrite.length`; limit: `ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries`.
- **Disk Read Bytes** source: `SorobanResources.diskReadBytes (identity adjustment)`; limit: `ConfigSettingContractLedgerCostV0.txMaxDiskReadBytes`.
- **Write Footprint Entries** source: `SorobanResources.footprint.readWrite.length`; limit: `ConfigSettingContractLedgerCostV0.txMaxWriteLedgerEntries`.
- **Ledger Write Bytes** source: `SorobanResources.writeBytes (identity adjustment)`; limit: `ConfigSettingContractLedgerCostV0.txMaxWriteBytes`.
- **Successful Contract/System Events** source: `successful non-diagnostic ContractEvents.length`; limit: Protocol 28 has no independent event-count cap.
- **Events + Return XDR Bytes** source: `sum(successful non-diagnostic ContractEvent XDR bytes) + return ScVal XDR bytes`; limit: `ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes`.

---

<details><summary>Known measurement gaps</summary>

- **Unavailable metrics** are shown explicitly; configured policies requiring them fail.
- **Compute** uses protocol-matched native simulation and captured network cost settings.
- **WASM build determinism**: cross-CI-run hash equality has not yet been verified
  in two separate GitHub Actions runs. Snapshot repeatability does not prove build repeatability.

</details>

<!-- weighin-report -->