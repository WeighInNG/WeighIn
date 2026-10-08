# Internal flagship CI proof

The prepared [workflow](../.github/workflows/flagship-proof.yml) runs three
independent scenarios on Ubuntu x64, Node 24, Rust 1.95.0, Stellar CLI 28.1.0,
SDK 28.0.0 and the pinned protocol-28 standalone image. Public execution has not
yet been verified. Local results must not be described as a hosted workflow run.

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
allowed to ignore policy failures. Existing application CI is unchanged.

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
