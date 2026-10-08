# Default build storage safeguard: local proof

WeighIn's default Stellar builder now checks its temporary storage before building
and before accepting the fresh output. The CLI's TMPDIR/TMP/TEMP point to the
verified owned output directory. BASE and HEAD use the same caller-selected root
policy. Quota/truncation failures stop the build; stale configured artifacts are
not accepted after such failures. No fallback, threshold relaxation, metric/schema
change, new input or artificial contract regression is included in the product.

Implementation: `2185c603312df25b87b80f825f8495befe10894e`.
Executed bundle SHA256:
`104be8ef72ebc176986f577a4479d040be7684f4e1a9f5a4e0928eeee32591a0`.

## Real external-project rerun

The public Soroban Forge source is pinned to
`07d7935234e9c86816116471121998b871b68439` (SDK 28.0.0). The fixture queries
`escrows_for_participant` for an empty participant page. The isolated regression
adds eight redundant bounded persistent has calls and preserves its returned XDR.
This modification exists only in private experimental history and retained proof.

Node24.13.1, Rust1.95.0, official checksum-verified Stellar CLI28.1.0, wasm32v1-none,
and the pinned protocol28 standalone image were used. Each run executes the
committed bundle against actual isolated Git revisions, fetch/worktrees, locked
optimized contract builds, deployment, live RPC/native simulation, diff and report.
The unchanged source-matching native helper was reused. Cargo caches were reused;
these runs do not prove five cold builds or portable build determinism.

| Run | BASE CPU | HEAD CPU | Delta | Action exit |
| --- | --- | --- | --- | --- |
| Control 1 | 565,371 | 565,371 | 0 | 0 |
| Control 2 | 565,371 | 565,371 | 0 | 0 |
| Control 3 | 565,371 | 565,371 | 0 | 0 |
| Control 4 | 565,371 | 565,371 | 0 | 0 |
| Control 5 | 565,371 | 565,371 | 0 | 0 |
| Regression, report only | 565,371 | 679,455 | +114,084 | 0 |
| Regression, strict CPU | 565,371 | 679,455 | +114,084 | 1 |

All five controls have identical BASE/HEAD WASM hashes across runs:
`103874c717632bb9b51d3ff6effc9869433fcbdf8e3c719c927eb7b6aa14f398`.
All eight measured resources repeat without differences: CPU565371, memory1225140,
read entries3, write entries0, read bytes0, write bytes0, events0, and event/return
bytes84. Three unavailable metrics retain null values and reasons.

Both regression runs pair the same logical benchmark despite different WASM
hashes and runtime addresses. CPU rises 20.1786% and memory rises5440 bytes. The
strict run reports exactly one CPU policy violation and the real Action exits1.
All cases verify deployed code, native CPU, raw RPC/native transaction-data and
return-XDR parity, and matched protocol/compute/resource settings. The network's
rolling live-state-size window changed between runs, so full configuration hashes
are not identical. The verifier decodes every config entry and permits only that
recorded window variation; all other settings agree. The first aggregate check
required the full config hash to agree and failed; inspection isolated the actual
changed entry before narrowing the check. No fee or identical-snapshot guarantee
is inferred from the stable measured resource values. Returns
are unchanged between each BASE/HEAD pair.

## Storage and validation proof

Five new behavior tests prove environment preservation and directory isolation for
two builds; pre-build flush failure; truncated probe contents; post-build flush
failure despite successful CLI exit; and missing temporary-root rejection. Failure
cases verify stale destinations remain unchanged and owned directories are cleaned.
A real invocation against this machine's failing system /tmp is rejected before
optimization. Its Node24 diagnostic describes an unknown write error; the storage
investigation independently recorded errno122/EDQUOT.

npm ci, lint, typecheck, all162 Node +52 Vitest tests, build, bundle and package
dry-run passed with healthy TMPDIR. Fifteen native assertions passed against the
verified cached helper. The first storage-verification assertion expected the
literal word quota, which Node24 did not emit; the corrected diagnostic assertion
passed. Both logs are retained. Native source/lock and dependency files unchanged.
The dependency audit still reports eleven preexisting vulnerabilities; no unrelated
dependency repair is included.

[Evidence](experiments/build-storage-safeguard/) retains seven scenario proofs,
source/config/WASM/report inputs, raw RPC/native IO, process exits, checksums, and
validation logs. The owned network was stopped; Docker startup seeds are redacted
and private runtime keys are excluded. Verify all seven recorded runs after
installing dependencies/building TypeScript:

```sh
node tests/experiments/verify-build-storage-proof.cjs
```

Fresh runs use `tests/experiments/verify-external-soroban-forge.cjs` with a healthy
absolute TMPDIR, the pinned CLI on PATH, a matching WEIGHIN_HELPER_PATH, and
WEIGHIN_EXPERIMENT_RPC_URL pointing at the pinned network. Use separate fresh
output directories for each run. The threshold harness intentionally exits1 only
after writing a VERIFIED result. No GitHub token or fabricated measurement is used.

## Boundaries and next dependency

Pre/post probes do not reserve build capacity or exclude a transient failure
confined to the optimizer interval. Provide healthy storage throughout the run.
Custom/prebuilt modes remain caller-owned. See [build policy](contract-build.md)
and [storage investigation](optimizer-repeatability.md).

The configured local flagship path is proven. This change and its external proof
have not been pushed; hosted validation of the safeguard and public external
control/regression/threshold runs remain pending. The prepared external workflow
must pin the reviewed published safeguard revision before delivery. General
stateful fixture sequences, public-network equivalence, documentation truth
alignment, and the final appeal review remain separate work.
