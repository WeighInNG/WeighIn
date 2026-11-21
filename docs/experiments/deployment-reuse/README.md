# Standalone deployment reuse experiment

Two independent protocol-28 Quickstart ledgers each ran `hello(Symbol("world"))`
three times through WeighIn. Every invocation used the same 776-byte WASM
from the [repeatability study](../repeatability/completed/run-1-reference.wasm),
the same fixture and invocation account, and the same native helper.
The fixed logical contract and case IDs were independent of deployment
addresses and WASM hash.

| Condition | Code entry before measurement | Instance entry before measurement |
| --- | --- | --- |
| Cold | Absent | Absent |
| Uploaded | Present from the cold run | Absent for the second deployer |
| Reused | Present | Present at the second deployer's address |

The runner derives the salt as SHA-256 of the WASM digest bytes and uses the
deployer's public key and standalone network passphrase to derive the
instance address. The uploaded condition exercises the normal measurement
path, which submits an upload again before creating the new instance. The
reused condition submits neither transaction. All measured invocations are
simulations. The only ledger writes are on the two disposable chains.

## Results

The minimum and maximum were equal in each condition for all eight measured
metrics. The table reports the value observed in both samples per condition.

| Metric | Cold | Uploaded | Reused |
| --- | ---: | ---: | ---: |
| CPU instructions | 266,842 | 266,842 | 266,842 |
| Memory bytes | 1,123,942 | 1,123,942 | 1,123,942 |
| Ledger read entries | 2 | 2 | 2 |
| Ledger read bytes | 0 | 0 | 0 |
| Ledger write entries | 0 | 0 | 0 |
| Ledger write bytes | 0 | 0 | 0 |
| Contract events | 0 | 0 | 0 |
| Event and return bytes | 44 | 44 | 44 |

Historical data read bytes, the contract data hard limit, and transaction
size were unavailable in all six samples. [The range data](ranges.json)
retains each sample, availability and each reported cap. [Raw evidence](samples.json)
retains the RPC deployment probes, submission responses, native snapshots
and outputs, and RPC/native return parity. Full configuration hashes are
recorded per sample. Fee-window and ledger metadata can differ across ledgers.
The verifier requires identical compute calibration and caps across both
ledgers and matches full configuration within each ledger.

For this protocol, helper, fixture and pair of ledgers, deployment reuse did
not change measured invocation consumption. The experiment measures the
invocation after deployment and does not measure the cost of upload, creation,
archival restoration, or the wall-clock performance of a warmed runtime.

## Reproduce

Run `npm ci`, `npm run build` and `npm run build:helper` from the repo root.
Start two new owned Quickstart containers with the digest in
[container-identities.txt](container-identities.txt). Use `--local
--enable-soroban-rpc --protocol-version 28`, publish port 8000 on
loopback ports 18057 and 18058, and wait until both RPCs report healthy.
Then run the harness with a new output directory.

```sh
node tests/experiments/verify-deployment-reuse.cjs /tmp/weighin-deploy-reuse \
  http://127.0.0.1:18057/rpc http://127.0.0.1:18058/rpc
node --test tests/deployment-reuse-evidence.test.cjs
```

The harness creates temporary signing keys, omits them and signed submission
envelopes from the evidence, and deletes its key directory on exit. Stop
the two containers you started when the run finishes.
