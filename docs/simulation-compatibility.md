# Stage 1B: simulation compatibility evidence

## Outcome

Investigation and explicit failure handling are implemented. Live measurement
compatibility is **blocked**, not complete. No measurement schema changed.

The tested Stellar RPC 29.0.0 / protocol 28 response does not expose measured
CPU instructions or runtime memory consumption. SDK 16.0.1 likewise exposes
neither in its parsed simulation result. The previous `simSuccess.cost` access
failed with a TypeError. WeighIn now rejects the measurement with an explicit
unavailable-compute error before producing a benchmark result.

`requireComputeConsumption` deliberately rejects every successful simulation
under the currently supported response model. This is a diagnostic guard, not a
working compute extractor. A verified measurement source is required to replace
it. Adding a legacy `cost` object does not bypass this guard.

## Sources and mapping

- Stellar removed the legacy `cost` response field for protocol 22:
  [upstream removal](https://github.com/stellar/stellar-rpc/pull/295) and
  [reason for removal](https://github.com/stellar/stellar-rpc/issues/66).
- The exact tested RPC commit's
  [formatResponse](https://github.com/stellar/stellar-rpc/blob/8a40169717723697e430c1e51c21ef0bf244ecda/cmd/stellar-rpc/internal/methods/simulate_transaction.go#L194)
  emits transaction data, events, results, fees, state changes and restore data;
  it does not emit the preflight's CPU/memory fields.
- Stellar's simulation library distinguishes unadjusted metered compute from
  adjusted transaction resources:
  [simulation result and resource adjustment](https://github.com/stellar/rs-soroban-env/blob/main/soroban-simulation/src/simulation.rs).
- Locally installed SDK files `lib/cjs/rpc/parsers.js` (`parseSuccessful`) and
  `lib/esm/rpc/api.d.ts` (`SimulateTransactionSuccessResponse`) confirm the SDK
  representation. `rpc.parseRawSimulation` was used on the captured raw result;
  raw and parsed captures are from the same RPC response.

| Value | Verified source | Assessment |
| --- | --- | --- |
| Measured CPU | None in the tested raw/parsed response | Unavailable |
| Runtime memory | None in the tested raw/parsed response | Unavailable |
| Instruction budget | `transactionData.resources().instructions()` | Adjusted submission budget; cannot substitute for consumed CPU |
| Read-only / read-write entries | `transactionData.resources().footprint()` | Raw XDR and SDK decoded counts agree |
| Disk read / write bytes | `transactionData.resources().diskReadBytes()` / `.writeBytes()` | Raw XDR and SDK decoded values agree; these are IO, not runtime memory |
| Diagnostic events | `events`, decoded as `DiagnosticEvent` | Captured invocations contain function call/return diagnostics, no measured compute |

This verifies the listed response fields. It does not complete the broader
metric semantics/limits audit. Historical bytes, instance-size fallback, event
semantics and static limits remain deferred. The docs' RPC example still showing
`cost` is insufficient evidence that the current endpoint supplies it.

## Live experiment

Saved evidence is in `tests/fixtures/stage1b/`:

- `environment.json`: immutable quickstart image, RPC/core/protocol and JS SDK.
- `build-evidence.json`: prior Stage 1A build records. Stage 1B reused these real
  artifacts and rechecked their SHA256; it did not claim fresh Cargo builds.
- `base-simulation.json`, `head-simulation.json`, `control-simulation.json`:
  exact request envelope XDR, raw RPC response and decoded SDK representation.
- `base-leeway.json`: same BASE transaction with increased instruction leeway.
- `experiment.json`: live results and explicitly blocked proof status.

The source was commit `59db63a7b895dcc5ca763e3c668990fec40850fb` plus the
pre-existing working tree edits, not two committed revisions. BASE/HEAD used
identical fixtures and Cargo.lock, Rust 1.95.0, Soroban SDK 25.3.1 and
`cargo build --release --target wasm32v1-none`. Temporary HEAD adds
`env.storage().persistent().set(&symbol_short!("bench"), &to);` before the
unchanged return value. The artificial regression is not in production source.

| Field | BASE | Unchanged control | Temporary HEAD |
| --- | ---: | ---: | ---: |
| Instruction budget | 320219 | 320219 | 364046 |
| Read-only entries | 2 | 2 | 2 |
| Read-write entries | 0 | 0 | 1 |
| Disk read bytes | 0 | 0 | 0 |
| Write bytes | 0 | 0 | 88 |
| Measured CPU / memory | Unavailable | Unavailable | Unavailable |

BASE and HEAD have distinct WASM SHA256 and runtime contract IDs. Both deployed
and returned the same `hello(world)` value. The exact BASE transaction's budget
changes from 320219 to 5270219 when instruction leeway is set to 5000000. This
directly demonstrates why budget must not be labeled consumed CPU.

No WeighIn benchmark records, measured compute diff, or live threshold proof
were produced. The live harness exits **1** and records **BLOCKED** even when its
diagnostic assertions pass. The unchanged control only verifies the listed IO
and budget fields; it is not a CPU/memory repeatability proof.

## Reproduction

Replay captured responses and test the public measurement failure behavior:

```sh
npm ci
npm test
```

For a live rerun, prepare isolated BASE/HEAD contract copies with the temporary
change above, identical fixtures and lockfiles, and build both using the recorded
Cargo command. Start a dedicated container:

```sh
docker run --rm -d --name weighin-stage1b-local -p 127.0.0.1:18000:8000 \
  stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5 --local
```

Once RPC is healthy, run the live harness (the four paths are caller supplied):

```sh
npm run build
node tests/experiments/capture-simulation.cjs \
  /path/to/base/weighin-fixtures.json /path/to/head/weighin-fixtures.json \
  /path/to/temporary/evidence /path/to/temporary/deployer.key
docker stop weighin-stage1b-local
```

The key path is shared between runs and remains private; captures contain no
secret key. Set `WEIGHIN_EXPERIMENT_RPC_URL` to use another isolated port. This
harness is explicitly invoked, excluded from `npm test`, and may fund/upload/
deploy on the selected network. It expects the local standalone passphrase.

## Next dependency

Choose and verify a source for metered CPU/memory, or explicitly approve a
changed product/schema model that supports unavailable compute and separately
named transaction budgets. Neither decision is implemented here. A functioning
live comparison remains a prerequisite for the flagship threshold proof.

## Subsequent native integration

The missing-RPC-compute finding remains true. Production measurement now uses a
protocol-matched native source rather than the old guard; see
[native measurement and schema 3](native-measurement.md). The blocked experiment
above is historical evidence, not the current supported-path outcome.
