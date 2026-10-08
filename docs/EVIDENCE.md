# WeighIn Evidence

## What this document proves

Recorded experiments show configured BASE/HEAD contracts being built, measured,
paired by logical benchmark identity, compared, reported and evaluated against
policy. A changed WASM/runtime address does not prevent comparison. Conclusions
apply to the fixtures and environments below. This page distinguishes real live
experiments, frozen replay tests and expected-negative hosted verification.

## Tested environment

The retained [hosted environment](experiments/hosted-comparison/regression/environment.json)
records the actual producer checkout, not just a branch name:

| Setting | Hosted comparison proof |
|---|---|
| Workflow / reviewed head | [Run 37777040210](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210), head `36294f695c7e5a46268e0087910299b6f3c60b33` |
| Actual producer checkout | `d0959ab25ccf827b2955c1cd0cda53e477a3c8f4` (GitHub PR merge checkout) |
| Node | 24.21.0 |
| Rust | 1.95.0, compiler commit `59807616e`, 2026-04-14 |
| Stellar CLI | 28.1.0, commit `c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd` |
| Contract Soroban SDK | 28.0.0, locked Cargo dependencies |
| JavaScript Stellar SDK | 16.0.1, pinned in the reviewed producer's package.json/lockfile |
| Native simulation / host | 28.0.1; helper SHA256 `e7785adc8b991dfd83dc28b12bde717384dc76229cc53c19971db7867db313ea` |
| Network / RPC | Standalone quickstart, `http://localhost:8000/rpc`; hosted RPC software version not separately recorded |
| Protocol / passphrase | 28 / `Standalone Network ; February 2017` |
| Image | `stellar/quickstart@sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5` |
| Target / build | `wasm32v1-none`; `stellar contract build --locked --optimize=true` |
| Action bundle SHA256 | `104be8ef72ebc176986f577a4479d040be7684f4e1a9f5a4e0928eeee32591a0` |

Sources/locks, WASMs, reports, process exits, raw RPC/native IO and SHA256 manifests
are retained under [hosted-comparison](experiments/hosted-comparison/).
The [workflow metadata](experiments/hosted-comparison/workflow-run.json) identifies
the three public jobs. The fixture harness creates temporary Git BASE/HEAD commits;
those IDs are experiment inputs, not public project revisions.

The separate five-run experiment used Node 22.23.2/npm 10.9.8, the same Rust/CLI/
contract and JavaScript SDK versions, and RPC 29.0.0 running protocol 28. Its
[environment record](experiments/repeatability/completed/environment.json)
explicitly identifies a copied working-tree snapshot, not an exact clean commit.
The source snapshot hash is
`9b8f8aa35dba73f8997e90fcec0626cd281fd8a9636a891c489e22ae3f35d654`.
It is not relabeled as a measurement of later code or dependency upgrades.

## 1. Logical BASE/HEAD comparison

The hosted regression compares fixture `path:weighin-fixtures.json`, contract
`id:reference-contract`, function `hello`, case
`args:[{"type":"symbol","value":"world"}]`.

| Diagnostic | BASE | HEAD |
|---|---|---|
| WASM SHA256 | `718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668` | `5878fa37dfcec8eaebc72111dfdbfa92447cb735bd88d23dcaf0e8edf9f7f3e8` |
| WASM bytes | 776 | 871 |
| Runtime contract ID | `CDU7C6WWP7LOIFCN3VSH2HR2DQWOQ4C3KZLQXZMRLDNADYHEM7LIFIOH` | `CDEGPA6YAUBVXGFIFKJGHYSXFWXY5ZV5T7EQTBYUFOMOZWMPPTA3TQNV` |

The [actual diff](experiments/hosted-comparison/regression/diff.json) contains a
matched logical benchmark and no added/removed contracts. Its second declaration
is the temporary historical path bridge; both declarations point to the same
modern build output. This proves two configured identities, not two independent
stateful contract deployments. [The report](experiments/hosted-comparison/regression/summary.md)
shows logical labels and both runtime addresses.

`tests/comparison-identity.test.cjs` exercises changed WASM/address pairing,
unrelated contracts/functions, multiple cases, additions/removals, improvements,
regressions and duplicate rejection. [Identity rules](comparison-identity.md)
explain why filename/address guessing is avoided.

## 2. Build reproducibility

Five independent clean reference builds started with verified-empty Cargo target
directories. Every output was **776 bytes**, SHA256
`718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668`:
byte-for-byte equality was observed for those five builds.

Rust/CLI/source/locks were fixed; incremental compilation/compiler wrappers were
disabled; build jobs were two; `RUSTFLAGS`/`CARGO_ENCODED_RUSTFLAGS` were unset.
Downloaded dependencies were cached and fetched offline, but compiled reference
artifacts were not reused. The native helper and audit contract were reused.
See [runs](experiments/repeatability/completed/runs.json),
[verification](experiments/repeatability/completed/verification.json),
[checksummed manifest](experiments/repeatability/manifest.json) and
[method](repeatability.md). `tests/repeatability-evidence.test.cjs` checks source,
empty-target records, all five WASMs and their measurements. This establishes
bounded local reproducibility, not universal cross-runner determinism.

## 3. Measurement repeatability

Seven cases were measured five times each on one advancing pinned network:
**35 live invocations**. Each of the eight supported resource fields had range
and population standard deviation **zero for each case**. Three unsupported
fields remained null. The reference `hello` was 266,842 CPU / 1,123,942 memory
units in all five samples. Nonzero reads/writes/events and a larger return were
covered by the six-case audit artifact, which was reused rather than clean-built
five times.

Snapshots spanned ledgers 833–1101; full snapshot/config hashes changed, while
compute calibration and resource caps remained fixed. See the
[metric table](experiments/repeatability/completed/metrics.csv),
[analysis](experiments/repeatability/completed/analysis.json) and
[all conditions/failed setup attempts](repeatability.md). This does not prove
failure-free RPC service or stability for ledger/time/state-sensitive contracts.

## 4. Intentional regression detection

The only intentional source change is one persistent write before the unchanged
return in `hello(Env, Symbol)`:

```rust
env.storage().persistent().set(&symbol_short!("bench"), &to);
```

[BASE source](experiments/hosted-comparison/regression/base/contract/src/lib.rs)
and [HEAD source](experiments/hosted-comparison/regression/head/contract/src/lib.rs)
retain the exact change. It existed only in the isolated experiment.

| Resource | BASE | HEAD | Absolute delta | Percentage |
|---|---:|---:|---:|---:|
| CPU cost-model instructions | 266842 | 309171 | +42329 | +15.862945% |
| Memory cost-model bytes | 1123942 | 1192553 | +68611 | +6.104496% |
| RO+RW footprint entries | 2 | 3 | +1 | +50% |
| Write footprint entries | 0 | 1 | +1 | Undefined (BASE zero) |
| Write bytes | 0 | 88 | +88 | Undefined (BASE zero) |

Disk read bytes and event count stayed zero; events+return bytes stayed 44.
The hashes above changed, but logical pairing remained intact and CPU regression
was reported. Report-only policy correctly exited 0 with positive deltas.
[Verification](experiments/hosted-comparison/regression/verification.json) and
[process capture](experiments/hosted-comparison/regression/process.json) prove it.

## 5. Threshold enforcement

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
```

Expected: +42,329 CPU violates the rule; actual: Action/harness **exit 1**, output
`result: fail`, and two CPU violations (one per temporary bridge declaration).
See [threshold verification](experiments/hosted-comparison/threshold/verification.json),
[outputs](experiments/hosted-comparison/threshold/outputs.txt),
[report](experiments/hosted-comparison/threshold/summary.md) and
[process](experiments/hosted-comparison/threshold/process.json).
The unchanged strict-policy control had eight zero resource deltas and exit 0:
[control verification](experiments/hosted-comparison/control/verification.json).

In the [hosted threshold job](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210/job/113310405470),
only the expected-negative benchmark step uses `continue-on-error`. A mandatory
subsequent step requires its original outcome `failure`, verified policy evidence
and actual exit 1. GitHub shows the continued step's conclusion as successful;
the enclosing verification job/run is green. This is proof of a genuine failed
benchmark process, not a claim that the enclosing job/run finished red.
Ordinary consumer jobs do not have that exception and fail on policy violation.

## 6. Raw measurement provenance

| Metric | Source / transformation | Unavailable behavior or assumption |
|---|---|---|
| CPU | Native `simulated_instructions`, copied without budget adjustment | Cost-model consumption; RPC exposes no direct consumed CPU |
| Memory | Native `simulated_memory`, copied directly | Metered memory units, not process RSS |
| Read entries | Count distinct RO+RW footprint keys | Includes queried absence, not repeated host reads |
| Disk read bytes | Parity-accepted resources `diskReadBytes` | Classic full-entry XDR on supported live-state path; live Soroban reads contribute zero |
| Write entries | RW footprint length | No-op writes/deletion count |
| Write bytes | Resources `writeBytes`, encoded RW postimages | No-op postimages count; deletion adds zero bytes |
| Events | Successful non-diagnostic contract/system event count | No independent count cap |
| Events+return bytes | Encoded full ContractEvents plus returned ScVal size | Includes XDR padding/overhead, not payload-only bytes |
| Historical read / instance-only size / signed transaction size | No verified consumption mapping | Null with explicit reasons; required policies fail |

Every measured cap comes from the same captured protocol-28 network configuration;
event count instead has null limit and a reason. Helper input/config/header/state
hashes and the seed/auth/features are retained. Full transaction-data/return/
ordered-event parity with RPC is required; mismatches fail.

[Raw RPC](experiments/hosted-comparison/regression/rpc.json) and
[native inputs/outputs](experiments/hosted-comparison/regression/native.json)
corroborate the hosted result. `tests/public-evidence.test.cjs` independently
checks manifest integrity, native input hashes, compute values and raw RPC parity.
The [six-case raw IO/event audit](experiments/metric-provenance/verification.json)
and `tests/native/metric-provenance.test.cjs` cover nonzero fields. For upstream
source/cap mappings and schema migration, see [metric provenance](metric-provenance.md).

## 7. Hosted CI evidence

- [Control job](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210/job/113310405872): unchanged source, strict CPU policy, Action exit 0.
- [Regression job](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210/job/113310405899): real temporary persistent write, changed hashes/addresses, positive deltas.
- [Threshold verification job](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210/job/113310405470): verified real policy-failure exit 1.
- [Core CI on reviewed head](https://github.com/WeighInNG/WeighIn/actions/runs/37777040190): formatting, types, real tests, bundle freshness, native replay, contract build and benchmark.
- [Core CI on merged main](https://github.com/WeighInNG/WeighIn/actions/runs/37778374074) and [proof on merged main](https://github.com/WeighInNG/WeighIn/actions/runs/37778374229) succeeded at `eaeea48ca77d1ff74c3a4cdee5f158a44fb4819e`.
- [PR #1 delivered comment](https://github.com/WeighInNG/WeighIn/pull/1#issuecomment-6056259444), [comment workflow](https://github.com/WeighInNG/WeighIn/actions/runs/37775914155), and [saved equality verification](experiments/comment-workflow-activation/verification.json): posted body equals the downloaded report.
- [Merged PR-only guard](https://github.com/WeighInNG/WeighIn/pull/12) and [main comment workflow](https://github.com/WeighInNG/WeighIn/actions/runs/37778805362): non-PR producer correctly skipped; [metadata](experiments/hosted-comparison/main-comment-guard.json).

GitHub artifacts have 30-day retention and may require login. The retained copies
and manifests above preserve evidence after expiration. These hosted runs predate
the later dependency/docs changes; they are not hosted validation of every future
commit. New validation results must identify their own source/bundle.

## Reproduction

From a clean checkout with Node 24, Rust 1.95.0/`wasm32v1-none`, Docker and the
checksum-verified CLI installed as in the [proof workflow](../.github/workflows/flagship-proof.yml):

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:native
npm run bundle
bash scripts/start-local-network.sh
node tests/experiments/verify-flagship-ci.cjs control /tmp/weighin-proof-control
node tests/experiments/verify-flagship-ci.cjs regression /tmp/weighin-proof-regression
node tests/experiments/verify-flagship-ci.cjs threshold /tmp/weighin-proof-threshold
# Expected exit 1 ONLY for a verified CPU policy violation:
node - <<'NODE'
const assert = require('node:assert/strict');
const proof = require('/tmp/weighin-proof-threshold/verification.json');
assert.equal(proof.status, 'VERIFIED');
assert.equal(proof.action_exit, 1);
assert.equal(proof.result, 'fail');
assert.ok(proof.violations.length > 0);
assert.ok(proof.violations.every(v => v.metric === 'cpu_instructions' && v.delta > 0));
NODE
docker stop stellar-quickstart
```

Run the expected-failure command interactively or capture its exit explicitly in
CI; a shell with `set -e` otherwise stops before the verification/cleanup commands.
Use new evidence destinations per attempt. The harness makes isolated temporary
Git revisions and a local bare origin, executes real builds/RPC/native/Action,
and never changes the production contract or posts GitHub comments. BASE/HEAD
share a Cargo cache; this is not another five-cold-build experiment. Use healthy
owned `TMPDIR` storage. [Repeatability](repeatability.md) gives the separate
five-build/five-sample experiment.

## Known boundaries

See [Known limitations](KNOWN_LIMITATIONS.md). Local external-contract evidence
is documented separately; no hosted external-repository result is claimed here.
