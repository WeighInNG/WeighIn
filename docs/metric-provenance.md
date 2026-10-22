Schema 4 introduced audited consumption and cap provenance: measured metrics add
`limit_source`, or `limit_reason` when there is no independent cap, and provenance
adds `resource_limits_sha256` and the optional `source_account`, the account that
invoked the measured call. Current measurements emit
`ContractBenchmark.schema_version: 5`, which preserves the same logical tuple,
runtime diagnostics and provenance fields, and adds an allowlist binding every
metric to its audited semantic mapping. The helper input/output transport remains
schema 1: its existing footprint/IO/event fields are sufficient for this audit.

These exact labels are part of the schema-5 contract; a nonblank label is not
evidence by itself. Runtime validation and the generated JSON Schema enforce
the source and cap mapping for each metric independently, before records can be
compared, including unmatched records:

| Metric | Approved `source` | Approved `limit_source` or `limit_reason` |
|---|---|---|
| `cpu_instructions` | `soroban-simulation.simulated_instructions` | `ConfigSettingContractComputeV0.txMaxInstructions` |
| `memory_bytes` | `soroban-simulation.simulated_memory` | `ConfigSettingContractComputeV0.txMemoryLimit` |
| `ledger_read_entries` | `SorobanResources.footprint.readOnly.length + readWrite.length` | `ConfigSettingContractLedgerCostExtV0.txMaxFootprintEntries` |
| `ledger_read_bytes` | `SorobanResources.diskReadBytes (identity adjustment)` | `ConfigSettingContractLedgerCostV0.txMaxDiskReadBytes` |
| `ledger_write_entries` | `SorobanResources.footprint.readWrite.length` | `ConfigSettingContractLedgerCostV0.txMaxWriteLedgerEntries` |
| `ledger_write_bytes` | `SorobanResources.writeBytes (identity adjustment)` | `ConfigSettingContractLedgerCostV0.txMaxWriteBytes` |
| `events_count` | `successful non-diagnostic ContractEvents.length` | `Protocol 28 has no independent event-count cap` (`limit: null`) |
| `event_data_bytes` | `sum(successful non-diagnostic ContractEvent XDR bytes) + return ScVal XDR bytes` | `ConfigSettingContractEventsV0.txMaxContractEventsSizeBytes` |
| `historical_data_read_bytes` | Unavailable; reason: `Protocol 28 exposes historical-data fees, not a historical read consumption resource` | No cap (`limit: null`) |
| `contract_data_hard_limit` | Unavailable; reason: `No verified instance-only post-invocation size and corresponding limit mapping` | No cap (`limit: null`) |
| `tx_size_bytes` | Unavailable; reason: `Simulation estimates a maximum envelope; no signed benchmark transaction is submitted` | No cap (`limit: null`) |