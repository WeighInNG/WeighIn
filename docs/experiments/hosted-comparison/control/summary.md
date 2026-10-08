## 🟢 WeighIn Benchmark Report

**All thresholds passed** — comparing `main` → `082f8918`

### Contract `path:weighin-fixtures.json / id:reference-contract`

Runtime addresses: BASE `CD2A22ZSCFXNQ3KDJAOISADM55GPV4NKQPMKCOWUVPVSDZ25DJ3G2DQN` → HEAD `CD2A22ZSCFXNQ3KDJAOISADM55GPV4NKQPMKCOWUVPVSDZ25DJ3G2DQN`

#### `hello / args:[{"type":"symbol","value":"world"}]`

Compute source: soroban-simulation 28.0.1; protocol 28.
Snapshot ledgers: BASE 54 → HEAD 54; compute config SHA256: `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `03f976eab25cf4e2df2ce0e846dc0e26b9a3e351b3421925d9cc30fbeaffdf4d` → HEAD `03f976eab25cf4e2df2ce0e846dc0e26b9a3e351b3421925d9cc30fbeaffdf4d`.
Resource limits SHA256: `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| ⚪ | CPU Instructions | 266,842 | 266,842 | ±0 | — | 400,000,000 |
| ⚪ | Memory Bytes | 1,123,942 | 1,123,942 | ±0 | — | 41,943,040 |
| ⚪ | Footprint Entries (RO + RW) | 2 | 2 | ±0 | — | 400 |
| ⚪ | Disk Read Bytes | 0 | 0 | ±0 | — (BASE 0) | 200,000 |
| ⚪ | Write Footprint Entries | 0 | 0 | ±0 | — (BASE 0) | 200 |
| ⚪ | Ledger Write Bytes | 0 | 0 | ±0 | — (BASE 0) | 132,096 |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Successful Contract/System Events | 0 | 0 | ±0 | — (BASE 0) | No independent limit |
| ⚪ | Events + Return XDR Bytes | 44 | 44 | ±0 | — | 16,384 |

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

### Contract `path:weighin-fixtures.json / wasm:contract/target/wasm32-unknown-unknown/release/contract_test.wasm`

Runtime addresses: BASE `CD2A22ZSCFXNQ3KDJAOISADM55GPV4NKQPMKCOWUVPVSDZ25DJ3G2DQN` → HEAD `CD2A22ZSCFXNQ3KDJAOISADM55GPV4NKQPMKCOWUVPVSDZ25DJ3G2DQN`

#### `hello / args:[{"type":"symbol","value":"world"}]`

Compute source: soroban-simulation 28.0.1; protocol 28.
Snapshot ledgers: BASE 54 → HEAD 54; compute config SHA256: `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `03f976eab25cf4e2df2ce0e846dc0e26b9a3e351b3421925d9cc30fbeaffdf4d` → HEAD `03f976eab25cf4e2df2ce0e846dc0e26b9a3e351b3421925d9cc30fbeaffdf4d`.
Resource limits SHA256: `bd6ad7c9ae2afffe53a3d12e11fd45f0d74cd49b40be76a1ed10ace6b0f215a9`.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| ⚪ | CPU Instructions | 266,842 | 266,842 | ±0 | — | 400,000,000 |
| ⚪ | Memory Bytes | 1,123,942 | 1,123,942 | ±0 | — | 41,943,040 |
| ⚪ | Footprint Entries (RO + RW) | 2 | 2 | ±0 | — | 400 |
| ⚪ | Disk Read Bytes | 0 | 0 | ±0 | — (BASE 0) | 200,000 |
| ⚪ | Write Footprint Entries | 0 | 0 | ±0 | — (BASE 0) | 200 |
| ⚪ | Ledger Write Bytes | 0 | 0 | ±0 | — (BASE 0) | 132,096 |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Successful Contract/System Events | 0 | 0 | ±0 | — (BASE 0) | No independent limit |
| ⚪ | Events + Return XDR Bytes | 44 | 44 | ±0 | — | 16,384 |

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