# Optimizer temporary-storage investigation

## Result

The previously unexplained two-instruction difference is reproducible by changing
only `TMPDIR`. On this machine, the system `/tmp` cannot store the optimizer's
convergence files: bounded writes at 40,912, 45,889 and 65,536 bytes fail with
`EDQUOT` and leave zero-byte files. Workspace temporary storage completes all
three writes. This identifies a storage-dependent failure mode, not evidence of
random variation under the tested healthy configuration.

The pinned optimizer nevertheless reports success with either temporary directory.
Its convergence algorithm serializes the module to a temporary file, reads that
file's length, then stops when the next length is greater than or equal to the
previous length. The underlying Binaryen writer writes through a C++ stream.
Zero-byte convergence files therefore explain early termination after the first
pass. This mechanism is inferred from the exact dependency source plus the
storage probes; syscall tracing was unavailable (`strace` is not installed).

Primary sources: [Stellar CLI 28.1 optimizer](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/commands/contract/optimize.rs),
[wasm-opt 0.116.1 convergence](https://docs.rs/crate/wasm-opt/0.116.1/source/src/run.rs),
and [Binaryen writer](https://github.com/WebAssembly/binaryen/blob/version_116/src/wasm/wasm-io.cpp).
The Stellar build and diagnostic optimize command call the same optimizer.

## Executed proof

Source: Soroban Forge `07d7935234e9c86816116471121998b871b68439`, SDK 28.0.0.
Engine: unchanged WeighIn `c32c0791f8991c54f2795d4f3b0c891063982e31`.
CLI: official 28.1.0 binary; Rust 1.95.0; Node 24.13.1; protocol 28 pinned standalone.
Input WASM: 45,889 bytes, SHA256
`20f9c2653ba0ba912773dbe6869bbf21082c9ac0e41d495ff5d2c138c6a466f1`.
Cargo caches were reused: these are repeated builds, not five cold builds.

| Mode | Optimizations/builds | Distinct output hashes | Bytes | CPU in five fresh live runs |
| --- | --- | --- | --- | --- |
| Direct optimize, constrained system temp | 5 | 1 (`f6edc17c…`) | 40,912 | 565,373 each |
| Direct optimize, healthy workspace temp | 5 | 1 (`103874c7…`) | 40,904 | 565,371 each |
| Full build, constrained system temp | 5 | 1 (`f6edc17c…`) | 40,912 | Same artifact as above |
| Full build, healthy workspace temp | 5 default + 5 single worker | 1 (`103874c7…`) | 40,904 | Same artifact as above |

Twenty direct optimizer runs with default/1/2/4 workers all produced `f6edc17c…`
under the constrained system temp. Additional output/input path variants and full
build variants also repeated five times per condition. Changing path spelling or
worker count did not explain the difference; changing temporary storage did.
There were 80 successful optimizer/full-build invocations in total.

Every one of the ten fresh live measurements verifies deployed WASM hash, CPU,
raw RPC/native transaction-data and return-XDR parity. All return values match.
Within each storage mode all eight measured values repeat exactly:

| Metric | System-temp artifact | Workspace-temp artifact |
| --- | --- | --- |
| CPU | 565,373 | 565,371 |
| Memory | 1,225,140 | 1,225,140 |
| Ledger read entries | 3 | 3 |
| Ledger write entries | 0 | 0 |
| Read bytes | 0 | 0 |
| Write bytes | 0 | 0 |
| Events | 0 | 0 |
| Event and return data bytes | 84 | 84 |

Three unsupported metrics retain null values and reasons. The cross-mode CPU
difference is -2, with every other comparable metric unchanged. No threshold was
loosened. The owned network was stopped and its startup signing seed redacted;
private deployer keys are excluded from evidence.

## Evidence and reproduction

[Retained evidence](experiments/optimizer-repeatability/) includes executed scripts,
per-run commands/results/logs, both distinct WASMs, storage probes, and ten live
measurements with raw IO. The scripts record this machine's absolute paths;
adapt those paths and provide the pinned CLI/helper/local RPC to rerun them.
The deprecated standalone optimize subcommand was used only to isolate the
optimizer, not as a replacement product build path. Do not deliberately exhaust
another machine's temporary storage to reproduce the constrained case.

Verify the retained evidence from the repository root after dependency installation:

```sh
node tests/experiments/verify-optimizer-repeatability.cjs
```

The verifier checks five runs per relevant build/optimizer condition, all ten live
measurements, actual deployed code, native/RPC parity, matching returns and the
complete retained artifact SHA256 inventory. It validates recorded evidence;
it does not itself perform fresh builds or contact RPC.

## Remaining dependency

Healthy temporary storage bounds this observed variation in the tested pinned
Linux environment. This does not prove portable determinism, clean-build
repeatability, or robustness to storage failure during a build.

Before strict-zero external publication, add a narrow default-build safeguard:
use a shared healthy temporary-storage policy for BASE and HEAD; verify a real
write/flush/read round trip and fail visibly on storage failure. A preflight alone
cannot guarantee capacity throughout optimization. Prove the safeguard with
behavior tests and five repeated end-to-end controls, then rerun the intentional
regression and strict threshold. No production build change is included here.

## Validation

Lint and typecheck passed. The default test run failed 38 Node tests because of
system temporary-storage errors; the unchanged suite passed all 157 Node and 52
Vitest tests with healthy TMPDIR. Build, bundle, tracked bundle equality, verifier
syntax and retained evidence checks passed. Dependency files/native source were
unchanged; npm ci and the native unit suite were not rerun in this investigation.
Both failure and successful rerun logs are retained.

## Implemented follow-up

[Stage 6C](build-storage-safeguard.md) adds the default-build storage safeguard
and verifies five actual Action controls plus regression/threshold reruns locally.
The investigation above remains the evidence for the failure mode; the follow-up
documents exactly which storage failures are detected and the residual limitation.
Publication/hosted external validation remains pending.
