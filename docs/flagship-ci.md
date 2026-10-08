# Internal flagship CI proof

The prepared [workflow](../.github/workflows/flagship-proof.yml) runs three
independent scenarios on Ubuntu x64, Node 24, Rust 1.95.0, Stellar CLI 28.1.0,
SDK 28.0.0 and the pinned protocol-28 standalone image. Public execution has not
yet been verified. Local results must not be described as a hosted workflow run.

## Recorded local result (2026-10-08)

[Evidence](experiments/flagship-ci/completed/summary.json) records genuine
Node 24.21.0 runs from producer `398d32d5b808f2b1e4efb3fefa0726354e873e25`.
Control CPU is 266,842 on both sides, all eight measured deltas zero, exit 0.
The intentional write raises CPU to 309,171 (+42,329) and write bytes from 0 to 88:
report-only exits 0; strict CPU exits 1 with two violations for the two temporary
bridge declarations. Both logical identities pair; return XDR is unchanged.
Control WASM is 776 bytes; regression WASM is 871 bytes with a different hash and
runtime address. Source/producer hashes, raw captures, reports and checksums are
retained alongside the summary. Native helper and prior contract caches are
reused explicitly. The owned fresh sidecar was stopped.

Root gates pass (154 Node assertions, 15 native assertions, build/bundle, package
dry-run, native formatting). All 169 assertions also pass under Node 24. Initial
test development selected outdated two-metric evidence and failed; the corrected
schema-4 tests pass. Existing npm audit findings (one moderate/four high) and an
SDK Buffer deprecation warning remain. Hosted jobs/artifact uploads are pending.

| Scenario | Temporary HEAD | CPU policy | Required Action exit |
| --- | --- | --- | --- |
| control | Same source as BASE | Strict zero tolerance | 0 |
| regression | Add one persistent write, preserve hello arguments/return | Report only | 0, with positive CPU/write-byte delta |
| threshold | Same intentional write | Strict zero tolerance | 1, with CPU violations |

The harness copies the current contract sources/lock/toolchain/fixtures into an
isolated Git repository and creates temporary BASE/HEAD commits and a local bare
origin. Production fetch/worktree creation, optimized locked source builds,
deployment, RPC capture, native simulation, comparison, policy enforcement and
the bundled Action process all execute. Forwarding observers retain real IO;
they substitute no responses. Both current fixture identities remain configured;
this does not retire the historical identity bridge or prove historical migration
anew. The artificial regression never enters production contract source.

The threshold process exits 1 after its evidence passes validation. GitHub's
`continue-on-error` applies only to that expected negative-test step; the next
step requires its original `outcome` to be `failure` and requires a verified
policy result. A missing baseline, startup error, unmatched identity, unavailable
CPU, unchanged WASM, wrong report or absent verification marker fails the suite.
The overall verification job is expected to be green after proving the failed
benchmark step. This is an expected-failure test, not an ordinary application job
allowed to ignore policy failures. The core application benchmark remains intact.
The consumer example self-check uses `./` inside WeighIn's own repository so a
proposal tests its checkout; copies in other repositories still use the published
remote Action. The cached public main contains the older removed-RPC-cost reader;
its current remote state has not been refreshed or asserted.

Artifacts retain exact temporary input sources, commit IDs, built BASE/HEAD WASMs,
BASE/HEAD build hashes, diff, Action outputs, Markdown report, raw RPC/native
inputs/outputs, process exit/logs, environment/producer hashes and a checksum
manifest for 30 days.
Only the evidence directory is uploaded; private runner directories/deployer
seeds are excluded. No GitHub token is passed to the benchmark, so no comment is
posted. The job summary also includes the real benchmark report.

## Local reproduction

Install the pinned Rust/toolchain target, Docker and checksum-verified CLI as in
the workflow; use Node 24 for matching the hosted runtime. From this checkout:

```sh
npm ci
npm test
npm run test:native
npm run build
npm run bundle
bash scripts/start-local-network.sh
node tests/experiments/verify-flagship-ci.cjs control /tmp/flagship-control
node tests/experiments/verify-flagship-ci.cjs regression /tmp/flagship-regression
node tests/experiments/verify-flagship-ci.cjs threshold /tmp/flagship-threshold
docker stop stellar-quickstart
```

Use new evidence paths. The threshold command is expected to exit 1; check its
`verification.json` for `VERIFIED`, `action_exit: 1`, positive CPU deltas and CPU
violations. Do not treat an arbitrary nonzero exit as a successful experiment.
Optional `WEIGHIN_EXPERIMENT_CARGO_TARGET_DIR` reuses a Cargo target cache;
`WEIGHIN_EXPERIMENT_RPC_URL` selects a provisioned compatible local sidecar.
The native helper is built by `test:native` and then used with an explicit path.
This suite shares caches across revisions; it is not a clean-build repeatability
or installed-package/default-provisioning proof (see prior dedicated evidence).

Linux x64/protocol28/standalone scope and existing auth/random/archived/state
limitations apply. Three metrics remain explicitly unavailable. Hosted runtime,
runner disk/time budgets, downloads and artifact retention require a real public
run before being claimed as verified. External-project proof remains separate.
