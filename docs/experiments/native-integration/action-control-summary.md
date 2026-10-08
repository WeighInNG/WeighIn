## 🟢 WeighIn Benchmark Report

**All thresholds passed** — comparing `main` → `temporar`

### Contract `id:integration-suite / id:greeting`

Runtime addresses: BASE `CB33U7HZTCYZIQANL4PGKAZVNTQW3JYLZO4SICFV3OE72NHOQYT7KR63` → HEAD `CB33U7HZTCYZIQANL4PGKAZVNTQW3JYLZO4SICFV3OE72NHOQYT7KR63`

#### `hello / id:world`

Compute source: soroban-simulation 28.0.1; protocol 28.
Snapshot ledgers: BASE 135 → HEAD 133; compute config SHA256: `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `146b94da220a6e0c3beb3afcd32534045bd5474b792be697299549c0ba6da75e` → HEAD `146b94da220a6e0c3beb3afcd32534045bd5474b792be697299549c0ba6da75e`.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| ⚪ | CPU Instructions | 270,219 | 270,219 | ±0 | — | 400,000,000 |
| ⚪ | Memory Bytes | 1,125,761 | 1,125,761 | ±0 | — | 41,943,040 |
| ⚪ | Ledger Read Entries | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Ledger Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Ledger Write Entries | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Ledger Write Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Historical Read Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Contract Data (instance) | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Tx Size Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Events Count | Unavailable | Unavailable | Unavailable | — | Unavailable |
| ⚪ | Event Data Bytes | Unavailable | Unavailable | Unavailable | — | Unavailable |

- **Ledger Read Entries unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric
- **Ledger Read Bytes unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric
- **Ledger Write Entries unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric
- **Ledger Write Bytes unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric
- **Historical Read Bytes unavailable**: BASE: No verified transaction-level historical read consumption source; HEAD: No verified transaction-level historical read consumption source
- **Contract Data (instance) unavailable**: BASE: No verified instance-size measurement from the immutable invocation snapshot; HEAD: No verified instance-size measurement from the immutable invocation snapshot
- **Tx Size Bytes unavailable**: BASE: Simulation does not submit a signed benchmark transaction; HEAD: Simulation does not submit a signed benchmark transaction
- **Events Count unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric
- **Event Data Bytes unavailable**: BASE: Consumption/limit semantics are not yet verified for this metric; HEAD: Consumption/limit semantics are not yet verified for this metric

---

<details><summary>Known measurement gaps</summary>

- **Unavailable metrics** are shown explicitly; configured policies requiring them fail.
- **Compute** uses protocol-matched native simulation and captured network cost settings.
- **WASM build determinism**: cross-CI-run hash equality has not yet been verified
  in two separate GitHub Actions runs. Snapshot repeatability does not prove build repeatability.

</details>

<!-- weighin-report -->