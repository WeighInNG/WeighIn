## 🔴 WeighIn Benchmark Report

**1 threshold violation** — comparing `main` → `acb803be`

### ❌ Violations

- **`path:weighin-fixtures.json / wasm:contract/target/wasm32v1-none/release/contract_test.wasm / hello / args:[{"type":"symbol","value":"world"}]` / CPU Instructions**: cpu_instructions increased by 42329 (strict zero tolerance)

### Contract `path:weighin-fixtures.json / wasm:contract/target/wasm32v1-none/release/contract_test.wasm`

Runtime addresses: BASE `CDZ3DUPJTGCVB6MIRQSES2JETYT3GGI4PZ2FEK23MKVAK3GVLJL6BPOQ` → HEAD `CBHH5NBAFV2DQ4TQZOCLCCW2F2YBENDY3GMDRUIIX4KIQVV6QAF37XEG`

#### `hello / args:[{"type":"symbol","value":"world"}]`

Compute source: soroban-simulation 28.0.1; protocol 28.
Snapshot ledgers: BASE 302 → HEAD 294; compute config SHA256: `5e0aaa432815c17b201e2eeb5591a85e2355d758dc9a3989e58d7319096cf6b5`.
Full config SHA256: BASE `78e6e21a1395eb8d3e4fb4d9db11c39c9d241046a8ed184e22e18e29570a9590` → HEAD `78e6e21a1395eb8d3e4fb4d9db11c39c9d241046a8ed184e22e18e29570a9590`.

| | Metric | Base | Head | Delta | Change | Limit |
|---|---|---|---|---|---|---|
| 🔴 | CPU Instructions | 266,842 | 309,171 | +42,329 | +15.9% | 400,000,000 |
| 🔴 | Memory Bytes | 1,123,942 | 1,192,553 | +68,611 | +6.1% | 41,943,040 |
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