# Escrow benchmark baseline

`weighin-fixtures.json` defines one existing escrow entrypoint:
`escrows_for_participant(participant, 0, 10)`. The participant is a fixed public
address with no escrow records in a fresh local network. The expected result is
an empty page with total zero and no next cursor. The call requires no
authorization, tokens, private identities, or deployed testnet state.

The fixture declares stable IDs for the fixture, escrow package, and case. Both
revisions must contain this configuration before WeighIn can compare them.
`weighin.toml` enforces strict zero tolerance for CPU increases in this function;
other resource deltas can be reported without blocking the comparison.

The proposed execution environment is Linux x64, Rust 1.95.0, Stellar CLI 28.1.0
with optimization, and a pinned protocol-28 standalone RPC. WeighIn selects
`soroban-forge-escrow` from Cargo metadata, builds BASE and HEAD with locked
dependencies, and measures the fresh artifacts. This is an execution-resource
benchmark; it does not benchmark wall-clock time.

## Enable the workflow after establishing BASE

Merge the fixture and policy first. Add the separate WeighIn workflow afterward,
so its first comparison can find the same fixture in BASE. The workflow pins
WeighIn to commit `c32c0791f8991c54f2795d4f3b0c891063982e31`, uses read-only
repository permissions, and retains a Markdown report, JSON diff, and result.

A manual run compares the checked-out revision against that exact same commit.
It should report zero change in all measured resources. A pull-request run
compares the exact PR HEAD and BASE commits and fails when the configured CPU
policy is violated. Infrastructure or missing-baseline failures also fail the
Action and do not establish a passing comparison.

For an intentional regression proof, use a temporary branch that adds bounded,
redundant storage reads inside this entrypoint while preserving its returned
page. A successful proof requires changed WASM hashes and runtime addresses,
the same logical fixture identity, a positive CPU delta, a visible violation,
and a failed benchmark job. Close that experiment without merging the redundant
reads into the contract.

## Optimizer variation before rollout

The local pilot found two different optimized WASMs from byte-identical
unoptimized compiler output using Stellar CLI 28.1.0. Their empty-page CPU
measurements differed by two instructions; their return XDR and the other seven
measured resources were identical. Controlled Action comparisons still showed
zero change, and the intentional regression increased CPU by 114,084.

The exact optimizer environment causing this variation is not yet established.
The strict-zero policy can report a benign two-instruction increase. Hold the
workflow rollout until a deterministic build configuration is verified, or the
remaining variation is explicitly documented and accounted for in the chosen
policy. This fixture does not establish portable byte-for-byte build determinism.

## Scope

This fixture covers the empty participant-index query only. It does not prove
funded escrow settlement, token transfers, authorization flows, populated
pagination, or performance on public networks. WeighIn's current measurement
path reports eight resource metrics and marks three unavailable fields as null
with reasons; this policy requires only measured CPU. See the pinned
[measurement documentation](https://github.com/WeighInNG/WeighIn/blob/c32c0791f8991c54f2795d4f3b0c891063982e31/docs/metric-provenance.md).

This pilot does not complete the all-contract flows requested by issues #338 or
#348. Those broader integrations need their own representative fixtures.
