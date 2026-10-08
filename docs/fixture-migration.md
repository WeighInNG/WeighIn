# Migrating the reference benchmark identity

The historical revision has no contract ID. Its identity is the complete declared
WASM path, including `wasm32-unknown-unknown`. A direct replacement with a modern
path or an explicit ID correctly reports removed/new contracts. An entirely
unmatched comparison fails closed. Adding an ID in HEAD cannot rename BASE.

## Two steps using existing fixture semantics

| Revision | Declared contracts | Identity that can compare to BASE |
| --- | --- | --- |
| Historical | Original path, no ID | Original path-derived identity |
| Bridge (current working fixture) | `reference-contract` at the modern path, plus the unchanged historical declaration | Historical path-derived identity |
| After bridge is in BASE | Only `reference-contract` at the modern path | `id:reference-contract` |

The fixture document path and `hello(Symbol("world"))` case remain unchanged.
The bridge copies the exact historical declaration; it does not infer a match
from filenames, addresses or WASM hashes. The new explicit contract ID is shown
as new in the first comparison, then becomes comparable in the second.
Reports continue to show additions/removals rather than hiding the transition.

The bridge invokes the same benchmark twice under two distinct configured
identities. This is a temporary migration cost, not an additional product metric
or contract. Remove the declaration without an ID **only after the comparison's
BASE includes `id:reference-contract`**. Retiring it against historical BASE
would restore the unmatched-comparison failure. No production retirement or
public merge has been performed by this local stage.

## The old path is an output alias

Both declarations select the same Cargo package. Production `buildContracts`
builds it once with `stellar contract build --locked --optimize=true`, then copies
the same fresh optimized WASM to both destinations. `wasm32v1-none` remains the
compiler target. The temporary old directory name does not request a legacy build
target, reuse an old binary or relax validation. Rust/toolchain/dependencies remain
the modern pins on HEAD. No Action inputs, matching logic or result schemas change.

During this bridge, raw `stellar contract build` alone creates only its normal
modern artifact. Before invoking the measurement CLI with the root fixture,
prepare **both configured destinations** with the shared builder:

```bash
npm run build
node -e "require('./dist/build').buildContracts('weighin-fixtures.json', '1.95.0').catch(error => { console.error(error); process.exitCode = 1; })"
node dist/cli.js weighin-fixtures.json --rpc-url http://localhost:8000/rpc --output weighin-results.json
```

The Action already calls this builder for both revisions. Native-helper/RPC
provisioning requirements are unchanged.

## Proof and policy expectations

`tests/fixture-migration.test.cjs` verifies direct-transition rejection, exact
historical matching, strict threshold enforcement on the matched bridge,
retirement, changed-WASM regression, visible report identities and rejection of
unrelated paths. The builder test checks identical fresh copies from one build.
Controlled meter changes in these tests are not live measurement evidence.

The explicit live harness starts from the actual repository Git revision
`59db63a7b895dcc5ca763e3c668990fec40850fb`, including SDK 21.7.7/lockfile/source. The harness explicitly checks out that
fixed historical commit after cloning, so advancing the current branch cannot
replace the historical benchmark.
It creates isolated temporary migration revisions, a local bare origin and real
fetched worktrees. Stellar builds, RPC deployment/capture, native meters, diff,
reports/policies and bundled Action processes are real. Forwarding observers save
IO without substituting responses. The production contract source is unchanged;
the intentional persistent write exists only in the temporary regression fixture.

The initial SDK upgrade comparison uses the repository's existing report-only
policy. Its measured deltas must remain visible; a passing migration is not a
claim that upgrading SDK 21.7.7 to 28.0.0 consumes exactly the same resources.
Retirement/control and intentional regression then use a strict CPU policy with
both source revisions on SDK 28.0.0.

See [verification](experiments/fixture-migration/verification.json), per-scenario
diffs/reports/process outputs, raw RPC/native captures and the source/checksum
manifest under `docs/experiments/fixture-migration/`. These prove local behavior,
not public GitHub CI, a public merged migration or an external integration.
Cargo artifacts/helper are reused and recorded; no clean-build claim is made here.

Observed local outcomes:

| Scenario | Action exit | Matched identity | CPU delta |
| --- | ---: | --- | ---: |
| Direct transition without bridge | 1 | None; comparison fails closed | Not evaluated |
| Historical BASE to bridge | 0 | Exact historical path | +64 (report-only policy) |
| Bridge to stable ID only | 0 | `id:reference-contract` | 0 (strict policy) |
| Temporary persistent-write regression | 1 | `id:reference-contract` | +42329 (strict policy) |

The migration measures CPU 266778 → 266842 across the SDK upgrade. The later
regression measures 266842 → 309171, with changed WASM and runtime address.
Historical WASM SHA256 is
`2a8c407a19d5a98d2371237783ab095c5b82ffee81633c9b7714aaad06701fd0`;
both bridge destinations contain the modern control SHA256
`718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668`.
Actual CLI command logs show `--target=wasm32v1-none` for both source revisions.
The historical artifact was also extracted from its captured ledger entry and
checked against its build hash; see [artifact analysis](experiments/fixture-migration/artifact-analysis.json).
The locally cached `origin/main` has identical contract/lock/toolchain/fixture
inputs to the tested historical revision; its policy differs only in a comment.
See [cached-main equivalence](experiments/fixture-migration/cached-main-equivalence.json).
The remote was not refreshed here; its latest state and public CI remain unverified.

The first experiment correctly demonstrated unbridged failure, then stopped
because its local bare origin did not contain the new temporary bridge commit.
Its original producer/failure/captures are saved in `attempt-1/`. The harness now
fetches that commit into the isolated origin before subsequent comparisons.
The first complete four-scenario run is saved under
`attempt-2-prevalidation-bundle/`: the later bundle gate produced a different
bundle SHA256, so all scenarios were repeated with that validated artifact.
The definitive verification identifies the exact currently checked bundle;
earlier results were not relabeled as measurements of a different artifact.
`attempt-3-friendbot-startup/` records a subsequent HEAD funding HTTP 502 before
any measurement. RPC health did not establish friendbot readiness. The experiment
now records a real disposable-account funding probe before scenarios; the Action
still funds its own deployer normally. Its negative case explicitly checks for
identity-mismatch failure rather than accepting any exit 1. Production network
startup readiness was subsequently repaired/proved in
[network readiness](network-readiness.md); no setup error is counted as
a successful identity experiment.

## Reproduce

Provision official Stellar CLI 28.1.0 on PATH, Rust 1.95.0/wasm32v1-none, the
native helper and the pinned standalone network on localhost port 18000 as in
[repeatability](repeatability.md). Then:

```bash
npm ci
npm run build
npm run build:helper
npm run bundle
node tests/experiments/verify-fixture-migration.cjs /tmp/weighin-fixture-migration-evidence
npm test
npm run test:native
```

Use a new destination per attempt. The harness needs dependency access for the
historical locked SDK; an optional `WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR` reuses an
explicit compiled cache. Private deployer seeds stay in private temporary runner
directories. Stop the owned proof container afterward. No repository commits,
pushes, GitHub comments/issues or external-project changes are performed.
