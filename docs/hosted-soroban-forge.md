# Hosted external validation — Soroban Forge

## Attribution and scope

[Soroban Forge](https://github.com/Meet-hybrid/soroban-forge) is the external
Soroban test target. These runs executed in the public
[WeighInNG fork](https://github.com/WeighInNG/soroban-forge), with maintainer
permission communicated by the integration owner. Permission to test does not
imply official adoption or endorsement of WeighIn.

The proof covers only the real escrow **fresh-deployment empty participant-query
path**, `soroban-forge-escrow::escrows_for_participant(participant, 0, 10)`.
It does not prove funded settlement, populated pagination, deposit, release,
authorization security, public-network costs or the entire Forge application.
No upstream PR, production merge, tag or release was created for this proof.

## Immutable source lineage

| Revision | SHA / purpose |
|---|---|
| U: inspected upstream | [`07d7935234e9c86816116471121998b871b68439`](https://github.com/Meet-hybrid/soroban-forge/commit/07d7935234e9c86816116471121998b871b68439) |
| B: unchanged contract plus configuration | [`261ab6dae6c7aedb32ae94b8475c62dad27a3eb5`](https://github.com/WeighInNG/soroban-forge/commit/261ab6dae6c7aedb32ae94b8475c62dad27a3eb5) |
| Initial control harness, rejected before jobs | [`3e267634d5f0b351d8e1af008650018e79d30419`](https://github.com/WeighInNG/soroban-forge/commit/3e267634d5f0b351d8e1af008650018e79d30419) |
| C: corrected control harness | [`78efe5019da2313a478420444440d8843cbbb174`](https://github.com/WeighInNG/soroban-forge/commit/78efe5019da2313a478420444440d8843cbbb174) |
| R: one proof-only redundant read | [`6dc3c4a7fe99ee43a173c451fdc41dec37f88dff`](https://github.com/WeighInNG/soroban-forge/commit/6dc3c4a7fe99ee43a173c451fdc41dec37f88dff) |
| Pinned WeighIn engine | [`bbbe9001bbd375fd6a1ff75be5da2593c86fff20`](https://github.com/WeighInNG/WeighIn/commit/bbbe9001bbd375fd6a1ff75be5da2593c86fff20) |

B is a direct child of U, adding only fixture, policies and proof scripts/docs.
Contract sources, manifests, Cargo.lock, toolchain, SDK and release profile are
unchanged. C's additional changes affect only workflow/harness/docs. R changes
only `crates/escrow/src/lib.rs`. The [retained graph](experiments/hosted-soroban-forge/graph.json)
records parents and changed paths; the original failed commit remains in history.

The original upstream revision has no fixture: WeighIn reads the BASE fixture
before building. B supplies the required identical configuration without changing
contract behavior. Control compares **B → C**; both regression and threshold
compare **C → R**. The two proof branches point to the exact same R revision.

## Tested environment and build

| Setting | Actual evidence |
|---|---|
| Runner | Ubuntu 24.04, Linux x64 |
| Node / npm | 24.21.0 / 11.19.0 |
| Contract compiler | Rust **1.95.0**, independently decoded from both WASMs' `contractmetav0` `rsver`; Action passes `rust-toolchain: 1.95.0` |
| Root version probe | Rust **1.99.0**: Forge's `stable` toolchain file resolves the unqualified probe; this is distinct from the compiler selected for the build |
| Native helper | Built with explicit `cargo +1.95.0`; official simulation/host 28.0.1 |
| Stellar CLI | 28.0.0, commit `300aaf69ab100536678bdb641428b06f06b318ea` |
| Contract / JS SDK | Locked Soroban SDK 28.0.0 / Stellar SDK 16.0.1 |
| Network | Standalone protocol 28, `Standalone Network ; February 2017`; runner RPC `http://localhost:8000/rpc` |
| RPC software version | Not independently recorded; protocol and captured configuration are retained |
| Image | `stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5` |
| Target | `wasm32v1-none` |

Build command in each revision:

```bash
CARGO_TARGET_DIR=target stellar contract build \
  --package soroban-forge-escrow --locked --profile release --optimize=false
```

Artifact: `target/wasm32v1-none/release/soroban_forge_escrow.wasm`.
This preserves Forge's current CI build mode through supported `build-command`,
rather than replacing it with WeighIn's optimized default. Custom builds bypass
default build guards; this experiment separately verifies source, deployed bytes
and hashes. Source/profile/locks remain fixed. The helper cache is permitted;
these three runs are not a new five-clean-build or portable-determinism claim.

[Tool probes](experiments/hosted-soroban-forge/control/tool-versions.txt),
[compiler metadata verification](experiments/hosted-soroban-forge/wasm-metadata.json)
and [tool hashes](experiments/hosted-soroban-forge/control/tool-hashes.txt) are retained.
The engine bundle SHA256 is
`88a84534eabc00599094cd212252dfa98c63fded479f1d626d311a8239a83466`;
helper SHA256 is
`e7785adc8b991dfd83dc28b12bde717384dc76229cc53c19971db7867db313ea`.

## Invocation, identity and return

Args: public address `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`,
u32 cursor `0`, u32 limit `10`. The address needs no funded account or signing
seed. The selected public view needs no auth, token or prior escrow. A missing
participant index produces a valid successful empty page.

Logical identity in all scenarios:

```text
(id:soroban-forge-escrow-proof, id:escrow,
 escrows_for_participant, id:empty-participant-page)
```

Exactly one case pairs; no contract or benchmark additions/removals occur.
All six BASE/HEAD returns decode to `{ids: [], total: 0, next_cursor: null}`.
Return XDR and successful ordered events match real RPC/native simulation.

| Scenario | BASE runtime contract ID | HEAD runtime contract ID |
|---|---|---|
| Control | `CBG3T2MINGHXHWSGFWSASW6HU3XOFKNH5DN72RNNXXIGTHO6ZYF4AVNA` | `CBG3T2MINGHXHWSGFWSASW6HU3XOFKNH5DN72RNNXXIGTHO6ZYF4AVNA` |
| Regression | `CBJRHPPA4J7EBZQXMVN5DW23KNHUEHY3OHTBTVYTIYGMET5OQUL32BT4` | `CDTHY36UJL23LAAMX5WLM6XKZ33RBROHUP5UXDUFJC7ENZ3HNUKPXZA5` |
| Threshold | `CAI4NYXT57SHIA53HAIZTBL2GGLMBMSYTEPID2GUBFG7DEWAK6S33YU2` | `CBVEKDY6N33O6CB2SCH26J5O53ZO6W7USJLYSM275H2OZ7Q7F6C5UHBF` |

Each hosted job owns its standalone network/deployer; runtime addresses may vary
between jobs. They do not define logical comparison identity.

## Control, regression and policy outcomes

| Scenario | CPU BASE → HEAD | Delta | Actual Action exit / output | Enclosing job |
|---|---:|---:|---|---|
| Control B → C | 569098 → 569098 | 0 | 0 / `pass` | Success |
| Report-only C → R | 569098 → 583332 | +14234 (+2.501151%) | 0 / `pass` | Success |
| Strict CPU C → R | 569098 → 583332 | +14234 (+2.501151%) | 1 / `fail` | Success after expected-failure verification |

Control has zero deltas on all eight comparable metrics. The regression changes
only one location in the real public function:

```rust
// PROOF ONLY: redundant participant-index existence check.
let _ = env
    .storage()
    .persistent()
    .has(&DataKey::ParticipantIndex(participant.clone()));
```

[Exact source patch](experiments/hosted-soroban-forge/regression/source-change.patch)
and [retained BASE/HEAD sources](experiments/hosted-soroban-forge/source/) show the
change. It adds host/storage/key-processing work without changing the interface,
return, auth or storage state. Actual metering—not an estimate—shows the increase.

| Resource | BASE | R | Delta |
|---|---:|---:|---:|
| CPU cost-model instructions | 569098 | 583332 | +14234 |
| Memory cost-model bytes | 1226298 | 1226978 | +680 |
| RO+RW footprint entries | 3 | 3 | 0 |
| Disk read bytes | 0 | 0 | 0 |
| RW footprint entries | 0 | 0 | 0 |
| Write bytes | 0 | 0 | 0 |
| Successful contract/system events | 0 | 0 | 0 |
| Events+return XDR bytes | 84 | 84 | 0 |

The same key is accessed again: footprint size measures distinct keys, not host
call count. Historical read bytes, instance-only size and signed transaction size
remain unavailable/null with reasons; no unavailable metric is a measured zero.
Both independent regression/threshold jobs reproduced these values.

| Artifact | SHA256 | Bytes |
|---|---|---:|
| B/C WASM | `10b761dd75460dbc44083b488783660f518c71ac9e43fdf45a72bf07e5748f98` | 45889 |
| R WASM | `ac6869dc7c7d32865bdafb5e2c2948f6929c58749e047ed4c4fa03dd9759e0cc` | 45908 |

Strict policy:

```toml
[thresholds.functions.escrows_for_participant]
cpu_instructions = "strict_zero_tolerance"
```

One CPU violation was reported: `cpu_instructions increased by 14234 (strict zero tolerance)`.
**WeighIn returned the expected policy failure; the enclosing verifier job
remained green because it was asserting that the failure occurred.**

The original Action outcome is `failure`; GitHub's continued step conclusion is
`success`. A pure forwarding exit observer records actual Node exit 1 in
[process-exit.json](experiments/hosted-soroban-forge/threshold/process-exit.json).
The subsequent mandatory verifier checks real diff, source, return/native/RPC
parity and the exact CPU policy violation. Missing reports, empty diffs, build or
network failures cannot establish success. [Verification](experiments/hosted-soroban-forge/threshold/verification.json),
[report](experiments/hosted-soroban-forge/threshold/report.md) and
[selected job log](experiments/hosted-soroban-forge/threshold/selected-job-log.txt)
retain the failure. No claim is made that the enclosing job/run was red.

## Public hosted evidence and durable archive

| Scenario | Run | Job | Artifact |
|---|---|---|---|
| Control | [37864288478](https://github.com/WeighInNG/soroban-forge/actions/runs/37864288478) | [113607202958](https://github.com/WeighInNG/soroban-forge/actions/runs/37864288478/job/113607202958) | [weighin-escrow-control-37864288478-1](https://github.com/WeighInNG/soroban-forge/actions/runs/37864288478/artifacts/11587129440) |
| Regression | [37864749630](https://github.com/WeighInNG/soroban-forge/actions/runs/37864749630) | [113608690883](https://github.com/WeighInNG/soroban-forge/actions/runs/37864749630/job/113608690883) | [weighin-escrow-regression-37864749630-1](https://github.com/WeighInNG/soroban-forge/actions/runs/37864749630/artifacts/11587697704) |
| Threshold | [37865108512](https://github.com/WeighInNG/soroban-forge/actions/runs/37865108512) | [113609862970](https://github.com/WeighInNG/soroban-forge/actions/runs/37865108512/job/113609862970) | [weighin-escrow-threshold-37865108512-1](https://github.com/WeighInNG/soroban-forge/actions/runs/37865108512/artifacts/11587896762) |

Artifacts expire after 30 days and may require login. Their downloaded contents
are durably retained in [hosted-soroban-forge](experiments/hosted-soroban-forge/),
with [SHA256 manifest](experiments/hosted-soroban-forge/sha256.json), real source,
WASMs, full raw RPC/native captures, reports, environment hashes, original process
exits and workflow/job/artifact metadata. Storage layout is normalized; original
artifact file bytes are preserved. Selected log excerpts are labelled as excerpts.
No private runtime key directories, Docker state or signing seeds are retained.

Native input hashes link each reported provenance record to its captured replay.
Compute is official native consumption; RPC budgets are not called consumption.
IO metrics are independently recomputed from RPC transaction-resource XDR;
return/events require full parity. `tests/hosted-external-evidence.test.cjs` checks
the archive manifest, all three real exits, logical identities, deployed hashes,
source change and every supported metric against those raw sources.

## Workflow safety and preserved failures

Fork settings disabled **Release** (package/release publishing) and **ForgeBot**
(comment/status writes). Scheduled **Security Audit** remained `disabled_fork`;
an attempted redundant disable returned 403 because it was already inactive.
Ordinary **CI** was preserved with its original main/integration triggers; those
jobs were not invoked on proof branches. The new proof has `contents: read`, no
comment token and no upstream secrets. [Settings snapshots](experiments/hosted-soroban-forge/workflow-safety.json)
and [empty secret inventory](experiments/hosted-soroban-forge/secrets-inventory.json)
are retained. Upstream and fork main stayed at U. Proof branches stay isolated.

The [first workflow run](https://github.com/WeighInNG/soroban-forge/actions/runs/37864180813)
failed validation before jobs: `runner.temp` is unavailable in job-level env.
The next ordinary commit moved TMPDIR setup into a step and adjusted control
harness ancestry checks for a sequence of workflow repairs. No contract or metric
changed. [Failure metadata](experiments/hosted-soroban-forge/failures/) is retained;
no history was rewritten. A local YAML validation command initially passed a
Buffer instead of text to the parser; correcting UTF-8 reading passed with no
source change. GitHub also emitted non-blocking Node20 action-runtime migration
warnings; the jobs themselves ran the configured Node24 environment.

## Reproduction and boundaries

From a clean WeighIn checkout with Node24:

```bash
npm ci
npm run build
node --test tests/hosted-external-evidence.test.cjs
```

This independently verifies retained real evidence; it does not run a new live
benchmark. For fresh hosted execution, an authorized fork maintainer can rerun
the exact public workflows:

```bash
gh run rerun 37864288478 --repo WeighInNG/soroban-forge
gh run rerun 37864749630 --repo WeighInNG/soroban-forge
gh run rerun 37865108512 --repo WeighInNG/soroban-forge
```

Other developers can copy B/C/R proof refs into their own isolated public fork,
disable inherited release/comment workflows, and run the
[exact committed workflow](https://github.com/WeighInNG/soroban-forge/blob/78efe5019da2313a478420444440d8843cbbb174/.github/workflows/weighin-escrow-proof.yml).
It provisions the checksum-verified CLI, compiler, helper and network; source
checks require B, unchanged C, and exactly the one-read R patch. Keep baseline and
control refs at their recorded SHAs. Never merge R into a production branch or
create a release/tag from it. Reruns create new evidence cohorts; do not relabel
the retained run records as results of those reruns.

This is separate from the [historical local optimized eight-read experiment](external-soroban-forge.md).
Its values and older engine attribution remain unchanged. Current hosted proof
uses CLI28.0 unoptimized mode and a single redundant read. See
[known limitations](KNOWN_LIMITATIONS.md) for state setup, auth, protocol/platform
and custom-build boundaries. No new WeighIn product functionality was required.
