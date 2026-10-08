# Stage 1B follow-up: measured compute source design

Status: DESIGN COMPLETE; temporary source feasibility passed on 2026-10-07.
Production integration has now been implemented for Linux x64/protocol 28; see
[native measurement](native-measurement.md). The source feasibility results are in
[the experiment report](compute-source-feasibility.md).

## Recommendation

Prove a small temporary Rust executable using Stellar's `soroban-simulation`
library before integrating it into WeighIn. It provides metered simulation
compute and preserves the current behavior of not submitting benchmark
invocations. The executable boundary avoids native Node bindings.

The next approved execution should be a feasibility experiment, not a broad
architecture rewrite. Promote the helper into the repository only after its
real measurements, state consistency, and packaging requirements are proven.

## Source evidence

The official simulation result exposes `simulated_instructions` and
`simulated_memory`, obtained from the host's consumed budget meters before
transaction resource adjustments:
[simulation implementation](https://github.com/stellar/rs-soroban-env/blob/main/soroban-simulation/src/simulation.rs).
These are Soroban cost-model units, not native processor instruction counts or
process RSS/peak RAM.

The exact previously tested RPC revision already uses those values internally:
[preflight conversion](https://github.com/stellar/stellar-rpc/blob/8a40169717723697e430c1e51c21ef0bf244ecda/cmd/stellar-rpc/lib/preflight/src/shared.rs).
Its response formatter omits them. Its
[dependency pins](https://github.com/stellar/stellar-rpc/blob/8a40169717723697e430c1e51c21ef0bf244ecda/Cargo.toml)
select `soroban-simulation` / `soroban-env-host` 28.0.1 for protocol 28 and
29.0.0 for protocol 29. Match the runtime protocol, not the contract's compile-time
Soroban SDK version.

At the design stage, source availability was established but compilability was not. Attempts to
query publication metadata for 28.0.1 received HTTP 403 from crates.io, and no
dependency installation or compilation was performed in this design stage.
The subsequent feasibility experiment resolved and locked both 28.0.1 crates,
built the helper, and verified real metered compute. Dependency access is no
longer an observed blocker for this environment.

## Options considered

| Source | Compute meaning | Required changes | Decision |
| --- | --- | --- | --- |
| Standard `simulateTransaction` response | No measured compute fields in the tested version | Cannot restore values with a JS parser change | Insufficient |
| Transaction resource instructions / IO byte sum | Submission budget / ledger IO | Would change the metric meaning | Do not use for consumed CPU/memory |
| Official Rust simulation library | Metered simulated CPU/memory | Small native helper, immutable snapshot, runtime packaging | Recommended feasibility path |
| Applied transaction Core diagnostics | Metered applied execution | Submit benchmark transactions, enable diagnostics, isolate/reset state | Viable alternative with different benchmark semantics |
| Modified RPC exposing internal meters | Metered simulation compute | Maintain custom RPC protocol/image/fork | Larger operational burden |

Core emits diagnostic events with topics `core_metrics/cpu_insn` and
`core_metrics/mem_byte` when `ENABLE_SOROBAN_DIAGNOSTIC_EVENTS` is enabled:
[Core implementation](https://github.com/stellar/stellar-core/blob/master/src/transactions/InvokeHostFunctionOpFrame.cpp).
[getTransaction](https://github.com/stellar/stellar-rpc/blob/8a40169717723697e430c1e51c21ef0bf244ecda/cmd/stellar-rpc/internal/methods/get_transaction.go)
returns diagnostic events; the installed JS SDK decodes them. This source route
is supported by code inspection, not by a new live experiment. It would commit
fixture writes and could change subsequent benchmark state, so it should not
silently replace simulation.

## Smallest proposed integration, after feasibility

1. Keep existing fixture parsing, argument conversion, WASM deployment, logical
   comparison identity, diff calculation and threshold rules.
2. After deployments, capture an immutable invocation snapshot and its network
   configuration. Use the existing invocation/source account XDR; the helper
   receives no secret key and submits no transactions.
3. Invoke one Rust process with a versioned JSON input containing host-function
   XDR, source-account XDR, ledger context, config entries, ledger entries/TTL
   metadata, explicit queried absences, and a recorded PRNG seed/auth mode.
4. Implement the library's `SnapshotSource` interface over that immutable map.
   A key confirmed absent returns absence. A key never captured is an incomplete
   snapshot error, not an invented absent entry.
5. Return consumed CPU/memory, transaction resource budgets, return value,
   footprint/state changes and provenance from the same simulation execution.
   Keep adjusted resource budgets separate from consumed compute.
6. Replace `requireComputeConsumption` only after the verified source works.
   Validate helper output as finite, nonnegative integers. Missing fields,
   unsupported protocols, failed host calls and helper errors remain failures.
7. Add measurement provenance: source/library version, helper identity, protocol,
   ledger/snapshot/config hashes, PRNG seed and auth mode. Preserve all logical
   identity fields and runtime contract ID. Explicitly version/document the
   result schema if these fields become required.

Use one consistent source for the helper's compute and its simulated resources.
Do not combine local meters and a separate live RPC simulation's IO without
proving identical state/context. Other existing metric meanings remain subject
to the deferred Stage 3 audit.

## Snapshot and environment boundaries

The standard
[getLedgerEntries API](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries)
reads current state; it does not offer a historical-ledger selector. Capture all
entry batches and configuration against a common reported ledger, verify the
matching header, and retry the entire capture on ledger drift. The initial
feasibility proof uses a dedicated local network without competing transactions.

Start with the recorded RPC footprint, then expand the requested keys when the
helper identifies uncaptured reads, repeating the consistent capture. Include
contract code/instance entries, dependencies, full ledger entry data and
extensions, last-modified ledger, and `liveUntilLedgerSeq`. Preserve raw response
extension fields that the installed SDK parser may omit. Network configuration
must provide cost parameters, compute limits and archival settings; ledger
context supplies protocol, sequence, close time, reserve and network ID.

For BASE and HEAD, use the same ledger/config/context/seed after both versions
are deployed. Each case starts from its captured pre-invocation state; simulated
writes are discarded. Never overlay one revision's writes onto the other.
Archived/missing state that cannot be reconstructed is an explicit unsupported
case in the initial spike. Record that boundary rather than suggesting arbitrary
network contracts are already supported.

Fix the simulation auth mode to match the existing RPC request's effective
behavior. For the initial auth-free bundled contract, no signatures are needed.
Record a deterministic seed: the tested RPC preflight chooses a random seed,
so random-dependent fixtures cannot be expected to match it exactly. A fixed seed
defines a benchmark environment, not production-network randomness.

## Proof gate for the proposed feasibility experiment

Use the pinned quickstart image and previously built temporary BASE/HEAD WASMs.

1. Compile a protocol-matched helper in a temporary directory with a Cargo.lock.
   Record actual resolved versions and binary SHA256.
2. Capture complete immutable state after deployment. Run the real hello fixture
   and record the library's consumed CPU/memory, return value and resources.
3. Cross-check return value, footprint and adjusted resource fields with the raw
   RPC response for the same ledger/context and auth-free deterministic fixture.
   Raw RPC cannot directly verify CPU/memory it does not expose.
4. Change only instruction leeway. Require unchanged consumed CPU/memory while
   the returned transaction budget changes. Do not recover CPU by subtracting
   padding from an RPC budget.
5. Repeat the exact unchanged snapshot/helper invocation five times. Require
   identical metered compute and resource values, or investigate differences.
6. Run temporary persistent-write HEAD from equivalent pre-invocation state.
   Require changed WASM/address, identical logical identity, a positive measured
   resource delta and detection by the existing threshold evaluator once real
   results are adapted into the comparison schema.
7. Exercise missing entry/config, protocol mismatch, malformed output and failed
   host invocation. Require explicit failures, with no successful zero records.

Do not promise CPU specifically increases until it is measured. The persistent
write has already produced an IO increase; if compute fails to increase,
investigate and choose a deterministic fixture change based on evidence.

## Production integration gate

Only after the feasibility proof passes, approve a narrow integration patch:
helper crate/lock, Node adapter, result provenance, behavior tests, action bundle,
and required runtime provisioning. The current Action contains only a bundled JS
entry point; the helper must have an explicit build/install path for CLI and
Action consumers. Start with a clearly scoped Linux runner path, or choose
cross-platform distribution before claiming wider support. A missing helper
must fail explicitly.

The feasibility proof exposed one prerequisite to that patch: the current diff
requires all eleven metrics and rejects honest partial measurements. Add explicit
availability semantics through measurement, diff, report and threshold consumers;
do not populate unverified metrics with zero to satisfy the schema. Thresholds
configured for unavailable metrics must produce an explicit policy failure.
This required subset of Stage 3 now precedes the integrated regression proof.

Build/toolchain modernization, baseline-policy repair, general metric auditing,
public CI delivery and appeal work remain separate stages. A local helper proof
does not establish that the GitHub Action fails a real CI job on a regression.
