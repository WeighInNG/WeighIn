## 🔴 WeighIn Benchmark Report

**5 threshold violations** — comparing `live-950` → `expd-951`

### ❌ Violations

- **`id:temporary-storage-expiry-suite / id:reference-contract / hello / id:world` / CPU Instructions**: cpu_instructions increased by 40872 (strict zero tolerance)
- **`id:temporary-storage-expiry-suite / id:reference-contract / hello / id:world` / Events + Return XDR Bytes**: event_data_bytes increased by 20 (fail_on_any_regression)
- **`id:temporary-storage-expiry-suite / id:reference-contract / hello / id:world` / Ledger Write Bytes**: ledger_write_bytes increased by 84 (fail_on_any_regression)
- **`id:temporary-storage-expiry-suite / id:reference-contract / hello / id:world` / Write Footprint Entries**: ledger_write_entries increased by 1 (fail_on_any_regression)
- **`id:temporary-storage-expiry-suite / id:reference-contract / hello / id:world` / Memory Bytes**: memory_bytes increased by 64512 (fail_on_any_regression)

### Contract `id:temporary-storage-expiry-suite / id:reference-contract`

Runtime addresses: BASE `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ` → HEAD `CCCJJJDJ5HS676PYT6DCMY4RJVOAQMUOWBG5OQBVYTXNLWOFX4UF2ZKJ`

#### `hello / id:world`

Compute source: soroban-simulation 28.0.1; protocol 28.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| 🔴 | CPU Instructions | 278,610 | 319,482 | +40,872 | +14.7% | 400,000,000 |
| 🔴 | Memory Bytes | 1,132,400 | 1,196,912 | +64,512 | +5.7% | 41,943,040 |
| ⚪ | Footprint Entries (RO + RW) | 3 | 3 | ±0 | — | 400 |
| ⚪ | Disk Read Bytes | 0 | 0 | ±0 | — (BASE 0) | 200,000 |
| 🔴 | Write Footprint Entries | 0 | 1 | +1 | — (BASE 0) | 200 |
| 🔴 | Ledger Write Bytes | 0 | 84 | +84 | — (BASE 0) | 132,096 |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Successful Contract/System Events | 0 | 0 | ±0 | — (BASE 0) | No independent limit |
| 🔴 | Events + Return XDR Bytes | 56 | 76 | +20 | +35.7% | 16,384 |

- **Historical Read Bytes unavailable**: BASE: Protocol 28 exposes historical-data fees, not a historical read consumption resource; HEAD: Protocol 28 exposes historical-data fees, not a historical read consumption resource
- **Contract Data (instance) unavailable**: BASE: No verified instance-only post-invocation size and corresponding limit mapping; HEAD: No verified instance-only post-invocation size and corresponding limit mapping
- **Tx Size Bytes unavailable**: BASE: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted; HEAD: Simulation estimates a maximum envelope; no signed benchmark transaction is submitted

<details><summary>Snapshot and metric provenance</summary>

Snapshot ledgers: BASE 950 → HEAD 951.
Compute config SHA256: BASE `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5` → HEAD `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `f25ca8bd0fedd14d040a09568e8ae83eed8115c86e7524add4f211c171da6384` → HEAD `a6e26abb742dc859aeb98b7faa9b7d4c4d94d290f4a671393353f2f3aa6878c2`.
Resource limits SHA256: BASE `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9` → HEAD `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`.
Helper SHA256: BASE `8b732e17decc370b0a57def5ba14546f48c788158aae520fffa5708117dc6c73` → HEAD `8b732e17decc370b0a57def5ba14546f48c788158aae520fffa5708117dc6c73`.
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