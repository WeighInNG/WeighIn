# Soroban Forge external-project proof

Status: **local control, regression, and threshold proof verified**. No external
branch was pushed, no PR was opened, and no public external-project proof is
claimed. Publication of the proposed strict-zero workflow is held on the
optimizer variation described below.

## Source and environment

- Public project: [Meet-hybrid/soroban-forge](https://github.com/Meet-hybrid/soroban-forge).
- Original source: `07d7935234e9c86816116471121998b871b68439`.
- Engine: CI-passing WeighIn commit `c32c0791f8991c54f2795d4f3b0c891063982e31`.
- Experiment harness delivery commit: `33aad73`.
- Node 24.13.1; Rust 1.95.0; checksum-verified Stellar CLI 28.1.0;
  Soroban SDK 28.0.0; `wasm32v1-none`; Linux x64.
- Pinned standalone image:
  `stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5`.
- Shared Cargo artifact/download caches and a prebuilt native helper whose
  source and lock match the verified engine. This is not a cold-install or five
  clean-build experiment. Actual bundle/helper hashes are retained in each
  verification record.

The current Cargo manifest and lock use SDK 28.0.0. Several project README and
toolchain comments still refer to SDK 27; the manifest and successful build are
the evidence used here. No external README or contract implementation was
changed in the proposed integration.

## Fixture and regression

The real escrow entrypoint is
`escrows_for_participant(fixed_public_address, 0, 10)`. On a fresh standalone
network it returns an empty participant page without authentication or token
setup. Logical identity is
`(id:soroban-forge-proof, id:escrow, escrows_for_participant, id:empty-participant-page)`.

Each scenario clones the fixed external source, adds fixture/policy/workflow
files in isolated local Git history, creates a real bare local origin, and
executes the unmodified bundled Action. The Action fetches BASE, creates a
worktree, builds both source revisions with its default locked optimized Stellar
builder, deploys both artifacts, captures live RPC state, measures with the real
native helper, compares logical identities, renders a report, and evaluates policy.
Observers record IO without substituting responses.

The artificial HEAD change adds eight redundant persistent-storage `has` calls
inside the existing participant query. It retains the interface and exactly the
same return XDR. It changes the compiled WASM and runtime address. It exists only
in isolated experiment history and evidence, and is excluded from both proposed
external delivery branches.

## Observed results

| Scenario | BASE CPU | HEAD CPU | Delta | Action exit | Verification |
| --- | ---: | ---: | ---: | ---: | --- |
| Control | 565,371 | 565,371 | 0 | 0 | All eight measured deltas zero |
| Report-only regression | 565,371 | 679,455 | +114,084 | 0 | Matched logical case; changed WASM/address |
| Strict CPU threshold | 565,371 | 679,455 | +114,084 | 1 | One genuine CPU policy violation |

The intentional CPU increase is 20.1786%. Memory increases by 5,440 bytes;
other measured resources remain unchanged. Three unavailable metrics retain
null values and reasons. Both regressions pair the original logical benchmark
and preserve the fixture result. Captured native inputs match reported provenance;
CPU values match native outputs; transaction-data and return values match the
corresponding raw RPC simulations. Captured contract-code ledger entries match
the reported build hashes.

Evidence:

- [Control verification](experiments/external-soroban-forge/completed/control/verification.json).
- [Regression verification](experiments/external-soroban-forge/completed/regression/verification.json).
- [Threshold verification](experiments/external-soroban-forge/completed/threshold/verification.json)
  and [report](experiments/external-soroban-forge/completed/threshold/summary.md).
- Each scenario retains source/config inputs, an exact source patch, actual
  BASE/HEAD WASMs, full diff, raw RPC/native IO, process status/output, report,
  local revision IDs, and SHA256 inventory. These local synthetic revision IDs
  do not identify public commits.
- [Validation record](experiments/external-soroban-forge/validation.json)
  and [native tests](experiments/external-soroban-forge/native-tests.log).

## Optimizer variation: publication dependency

An exploratory build of the unchanged external source produced optimized SHA256
`f6edc17c367984295ce7007e4099d45982d84f5fdbffae899492d0e6c547c953`
(40,912 bytes). Controlled Action BASE builds produced
`103874c717632bb9b51d3ff6effc9869433fcbdf8e3c719c927eb7b6aa14f398`
(40,904 bytes), consistently across all three scenarios. Repeating the original
build and rebuilding an unchanged relocated clone reproduced the first hash;
repeating the controlled build reproduced the second.

Both builds' **unoptimized** WASMs are byte-identical (45,889 bytes), SHA256
`20f9c2653ba0ba912773dbe6869bbf21082c9ac0e41d495ff5d2c138c6a466f1`.
The optimized code sections differ. A second real standalone measurement of
these equivalent-source artifacts gives CPU 565,373 versus 565,371, delta -2,
while the other seven measured resources and return XDR are identical. The
reverse comparison would produce a two-instruction increase under strict zero
tolerance. This is not an identity mismatch or substituted measurement.

[Raw comparison and verification](experiments/external-soroban-forge/provenance-checks/verification.json)
retain both optimized/unoptimized inputs, live RPC/native evidence, repeat build
logs, and the direct measurement script. This isolates the observed divergence
to the optimization stage; the exact environmental cause remains unresolved.
No general optimizer determinism, portable WASM hash, or external five-run
repeatability guarantee is claimed.

The approved follow-up now isolates the environmental dependency to temporary
storage: changing only TMPDIR reproduces both hashes five times; system /tmp
writes fail with EDQUOT and leave zero-byte files. Healthy workspace storage
repeats the smaller artifact. Five fresh live measurements per artifact reproduce
the exact values above and verify deployed code plus RPC/native parity.
See [optimizer investigation](optimizer-repeatability.md) for evidence and limits.

Before strict-zero publication, implement and verify a narrow default-build
storage safeguard. No production build change or threshold relaxation is included
in this investigation, and no portable/cold-build determinism guarantee is claimed.

## Proposed public integration

The existing fork is `mxrtins04/soroban-forge`. Two local delivery branches are
prepared from the fixed upstream source:

1. `test/weighin-escrow-baseline`, commit `5a9fde1`: fixture, strict CPU policy,
   and `docs/WEIGHIN.md`. This first PR establishes the identical fixture in BASE.
2. `test/weighin-escrow-workflow`, commit `44fd24f`: dependent read-only workflow,
   pinned engine/toolchain/network, exact PR HEAD/BASE refs, genuine failure
   behavior, and retained Markdown/JSON artifacts.

The second branch should be reconciled against the actual merged baseline before
publication. Once the optimizer dependency is resolved or explicitly bounded,
publish the baseline PR, obtain its maintainer merge, then publish the workflow
PR to obtain a real hosted unchanged-contract control. Finally open a clearly
temporary intentional-regression PR and retain the failed threshold job and
report. Close that regression PR without merging the artificial reads.

No publication, external merge, maintainer message, or Drips submission occurred.
This single empty-index view does not prove funded settlement, populated
pagination, token/auth workflows, public-network costs, or all-contract coverage.
It does not complete Soroban Forge issues #338/#348 or add stateful-fixture support.

## Local reproduction

Use Node24, Rust 1.95.0 plus `wasm32v1-none`, official Stellar CLI 28.1.0 on PATH,
and Docker. Build the helper from this checkout, then start the pinned standalone
network. The harness downloads the fixed public source unless
`WEIGHIN_EXTERNAL_SOURCE` points to an existing clone containing the original SHA.

```bash
npm ci
npm run build
npm run build:helper
bash scripts/start-local-network.sh
export WEIGHIN_HELPER_PATH="$PWD/native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation"
node tests/experiments/verify-external-soroban-forge.cjs control /tmp/external-control
node tests/experiments/verify-external-soroban-forge.cjs regression /tmp/external-regression
node tests/experiments/verify-external-soroban-forge.cjs threshold /tmp/external-threshold
# Last command exits 1 only after the genuine policy failure has been verified.
docker stop stellar-quickstart
```

Use fresh evidence directories. Cargo caches can be shared through
`CARGO_TARGET_DIR`; raw runtime key directories are deliberately excluded from
retained evidence. Docker startup logs redact standalone signing seeds; RPC/native evidence remains
unchanged. Two fresh owned sidecars in the recorded run required bounded
Friendbot 502 recovery and confirmed account inclusion; both were stopped.
