# Deployment-condition experiment

This experiment addresses issue #55. It compares the same logical invocation under three explicitly recorded setup conditions:

| Condition | Exact setup state immediately before measurement |
| --- | --- |
| `cold_code` | The exact WASM is not uploaded and the instance does not exist. The measurement performs the upload and instance creation. |
| `uploaded_code` | The exact WASM was uploaded in a separate, confirmed setup transaction; the instance does not exist. The measurement creates a fresh instance without uploading WASM. |
| `reused_instance` | The exact WASM is already uploaded and the same instance identity is reused for the measurement. |

Each sample records the deployment salt, deployer public key, contract ID, setup transaction hash, inclusion ledger, WASM SHA-256, invocation fingerprint, calibration/configuration fingerprint, and all benchmark metrics. The setup receipt is retained separately from the measurement receipt so an uploaded-code sample cannot be mislabeled as cold code.

The comparison key is the logical fixture and invocation, not the runtime contract ID. All three conditions must use the same WASM, arguments, calibration, SDK/helper versions, and network configuration. Contract IDs and salts may differ for isolated cold/uploaded samples; a reused-instance series must retain the same instance identity.

The verifier in `tests/experiments/deployment-condition-analysis.cjs` is fail-closed. It requires at least five completed samples per condition and rejects changed WASM, arguments, calibration, missing samples, duplicate sample IDs, invalid salts, missing setup receipts, and condition flags that do not match the declared condition. A metric that is unavailable is retained with `null` values and a reason; it is never silently treated as zero.

The verifier summarizes each metric with its observed values, minimum, maximum, range, mean, and population standard deviation. It does not claim universal determinism, cross-machine determinism, or mainnet behavior. Those claims require separate evidence.

## Execution record

The experiment must be run against the pinned standalone test network and toolchain described by the repository before its output is used as evidence. Raw sanitized RPC/setup/measurement captures and the verifier output belong in the experiment artifact directory. Until that run is completed, this document describes the protocol only and is not a claim that the three-condition experiment has passed.
