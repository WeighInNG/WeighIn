# Discarded simulation writes proof (#172)

WeighIn executes configured benchmark invocations independently via simulation
(`simulateTransaction` and `weighin-simulation`) rather than submitting signed
invocation transactions on-chain. Only WASM upload (`uploadContractWasm`) and
contract instance creation (`createCustomContract`) are submitted during
`runMeasurement` (`src/measurement.ts`). Consequently, any ledger entries written
or modified by an earlier benchmark case are discarded at the end of that case's
simulation and do not initialize contract state for subsequent cases.

## Controlled write-then-read experiment

The controlled fixture in
[`tests/fixtures/discarded-writes/weighin-fixtures.json`](../tests/fixtures/discarded-writes/weighin-fixtures.json)
and contract
[`tests/fixtures/discarded-writes/contract/src/lib.rs`](../tests/fixtures/discarded-writes/contract/src/lib.rs)
run two sequential cases against a single fresh deployment of
`id:reference-contract`:

1. **`id:write-seed`** (`hello(env, Symbol("write"))`):
   - Calls `env.storage().persistent().set(&symbol_short!("state"), &symbol_short!("seeded"))`.
   - Simulates `1` modified ledger entry (`ledger_write_entries = 1`, `ledger_write_bytes = 88`)
     and returns `["Hello", "write", "wrote", "seeded"]`.
   - Because `runMeasurement` does not submit invocation transactions, the persistent
     `state` key remains absent (`entry_xdr: null`) in committed ledger state after
     `id:write-seed` finishes.
2. **`id:read-after-write`** (`hello(env, Symbol("read"))`):
   - Runs immediately after `id:write-seed` on the same deployed `contract_id`.
   - Reads `env.storage().persistent().get::<Symbol, Symbol>(&symbol_short!("state"))`.
   - Snapshot capture (`getLedgerEntries`) observes committed ledger state where `state`
     is still absent (`entry_xdr: null`), so the invocation returns
     `["Hello", "read", "absent", "uninit"]` rather than the discarded simulated
     write (`["Hello", "read", "present", "seeded"]`).

## Archived return values and state comparison

| Case | Mode arg | Transaction submitted? | Simulated write entries / bytes | Committed `state` entry | Archived return value (`Vec<Symbol>`) |
|---|---|---|---|---|---|
| `id:write-seed` | `"write"` | `false` (simulated only) | `1` / `88` | `null` before and after | `["Hello", "write", "wrote", "seeded"]` |
| `id:read-after-write` | `"read"` | `false` (simulated only) | `0` / `0` | `null` (absent) | `["Hello", "read", "absent", "uninit"]` |
| Committed-state control (`seeded-state-control.json`) | `"read"` | N/A (committed entry present) | `0` / `0` | `present` (`"seeded"`) | `["Hello", "read", "present", "seeded"]` |

## Why committed setup is required

In `src/measurement.ts` (`runMeasurement`) and `src/simulation.ts`
(`measureInvocation`), each invocation in `contractSpec.invocations` builds an
unsigned `invokeContractFunction` transaction and passes it to
`server.simulateTransaction(invokeTx)` and the offline `weighin-simulation`
helper. Neither step signs or submits the invocation transaction to the network.

As a result:

- Simulated writes from Case 1 (`id:write-seed`) exist only inside Case 1's ephemeral
  simulation footprint (`read_write_keys`, `write_bytes`) and are discarded immediately.
- Case 2 (`id:read-after-write`) queries live committed ledger state via `getLedgerEntries`
  and observes `entry_xdr: null` for the `state` key.
- Any subsequent case that requires Case 1's state to be present (such as
  `hello(env, Symbol("require"))`, which calls `.expect("setup required: state key not initialized in committed storage")`)
  traps during `simulateTransaction` and fails closed.

Benchmarks whose measured path depends on initialized storage or prior contract
outputs therefore require a separate committed setup phase that submits and
confirms setup transactions before measurement begins. The architecture and
scope boundary for committed fixture setup and typed return bindings are
specified in [Committed fixture setup and typed dependency design](fixture-setup-design.md) (`#58`).
This proof is strictly limited to demonstrating discarded simulation writes on
the current benchmark path and does not implement committed setup execution.

## Retained evidence and reproduction

Retained artifacts in [`docs/experiments/discarded-writes/`](experiments/discarded-writes/):

- [`verification.json`](experiments/discarded-writes/verification.json) and [`sha256.json`](experiments/discarded-writes/sha256.json)
- [`deployment.json`](experiments/discarded-writes/deployment.json) and [`environment.json`](experiments/discarded-writes/environment.json)
- [`case-sequence.json`](experiments/discarded-writes/case-sequence.json) and [`return-values.json`](experiments/discarded-writes/return-values.json)
- [`measurement-results.json`](experiments/discarded-writes/measurement-results.json), [`rpc-calls.json`](experiments/discarded-writes/rpc-calls.json), and [`native-replays.json`](experiments/discarded-writes/native-replays.json)
- [`seeded-state-control.json`](experiments/discarded-writes/seeded-state-control.json), [`rejected-paths.json`](experiments/discarded-writes/rejected-paths.json), and [`summary.md`](experiments/discarded-writes/summary.md)

Verify offline:

```bash
node tests/experiments/verify-discarded-writes.cjs
node --test tests/discarded-writes.test.cjs
```
