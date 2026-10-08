# Hosted benchmark comparison proof

The [workflow](../.github/workflows/flagship-proof.yml) runs real isolated control,
intentional persistent-write regression and strict-threshold scenarios. See
[Evidence](EVIDENCE.md) for the exact public jobs, environments, hashes, source
changes, resource values and retained raw RPC/native artifacts.

[Run 37777040210](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210)
verified all three scenarios at reviewed head `36294f695c7e5a46268e0087910299b6f3c60b33`.
The actual PR merge checkout is recorded in each environment file.
[The merged-main run](https://github.com/WeighInNG/WeighIn/actions/runs/37778374229)
also passed at `eaeea48ca77d1ff74c3a4cdee5f158a44fb4819e`.

| Scenario | CPU BASE → HEAD | Action/harness exit | Result |
|---|---|---:|---|
| Control with strict CPU policy | 266842 → 266842 | 0 | Eight supported deltas zero |
| Intentional write, report only | 266842 → 309171 | 0 | +42329 CPU; write bytes 0 → 88 |
| Intentional write, strict CPU | 266842 → 309171 | 1 | Two violations for temporary bridge declarations |

The threshold step uses `continue-on-error` only for the expected negative case.
A mandatory next step checks the original failure outcome and verified real
policy evidence. GitHub's displayed step conclusion and the enclosing verification
job are successful after this expected failure is proven. Ordinary benchmark
jobs fail normally; this is not an exception for application policy violations.

The harness uses actual Git fetch/worktrees, locked optimized SDK28 contract
builds, real deployment, RPC snapshots, native consumption, logical diff and the
bundled Action process. IO observers do not substitute responses. Temporary
persistent-write HEAD never enters production contract source; keys remain in
private runner directories. BASE/HEAD share build caches, so this is distinct
from the [five-clean-build experiment](repeatability.md).

Historical [local proof](experiments/flagship-ci/completed/summary.json) remains
unchanged with its original producer/hashes. Hosted copies are retained under
[hosted-comparison](experiments/hosted-comparison/) because uploaded artifacts
expire after 30 days. New source/dependency validation must identify its own
bundle rather than reuse earlier producer claims.

For clean-checkout commands, see [Reproduction](EVIDENCE.md#reproduction).
[Known limitations](KNOWN_LIMITATIONS.md) includes Linux x64/protocol28/standalone,
auth/random/state, unavailable metrics and unverified external-repository CI.
