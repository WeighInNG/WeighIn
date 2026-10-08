# WeighIn

WeighIn benchmarks configured Soroban contract functions in BASE and HEAD,
compares their resource usage, and fails a GitHub Action when a configured policy
is violated. It is for contract maintainers who want resource regressions visible
in pull requests.

**Tested scope:** Linux x64, protocol 28, a standalone Stellar network, Soroban
SDK 28.0.0, Stellar CLI 28.1.0 and Rust 1.95.0. See
[verified evidence](docs/EVIDENCE.md) and [known limitations](docs/KNOWN_LIMITATIONS.md).

## Why WeighIn

A contract change can preserve its interface while increasing metered compute,
memory, footprint or write usage. WeighIn compares repeatable fixture cases so
maintainers can review those changes and choose which increases should block CI.
These are Soroban simulation resources, not hardware performance or fee estimates.

## How It Works

```text
HEAD checkout + fetched BASE worktree
  → build each revision's configured contracts
  → deploy WASM and simulate each revision's fixtures
  → capture RPC state and measure with protocol-matched native simulation
  → pair logical benchmarks independently of runtime addresses
  → calculate resource deltas
  → enforce HEAD thresholds and absolute caps
  → write report and outputs
  → pass / fail
```

The default builder uses `stellar contract build --locked --optimize=true` and
`wasm32v1-none`. It builds the Cargo packages selected by fixture WASM paths.
The Action requires at least one matched benchmark; missing baselines, invalid
policies, incompatible provenance and required unavailable metrics fail.
The baseline is the fetched base ref, not a computed merge base.
[Architecture](docs/architecture.md) explains the implementation.

## Example Result

An actual isolated change added one persistent write to `hello` while preserving
its arguments and return value:

| Metric | BASE | HEAD | Delta |
|---|---:|---:|---:|
| CPU cost-model instructions | 266,842 | 309,171 | +42,329 (+15.86%) |
| Ledger write bytes | 0 | 88 | +88 |

The WASM hash and runtime contract address changed. The logical benchmark still
paired. Report-only execution passed; `strict_zero_tolerance` on CPU produced
violations and Action exit 1. The [hosted proof](https://github.com/WeighInNG/WeighIn/actions/runs/37777040210)
verified that expected failure. Its enclosing verification job is intentionally
green. [Exact source, hashes, reports and raw responses](docs/EVIDENCE.md) are retained.

## Quick Start

1. Put fixture declarations in **both** the baseline and HEAD. Commit a baseline
   containing those fixtures before the first comparison. Give logical contracts
   and cases stable IDs.
2. Provision Linux x64, Rust 1.95.0 with `wasm32v1-none`, Stellar CLI 28.1.0,
   Docker and the pinned protocol-28 standalone network.
3. Copy the [benchmark workflow](.github/workflows/weighin.yml) into your
   repository and adapt its fixture/config paths. It includes tool and sidecar
   provisioning. Pin the Action to a reviewed commit; the excerpt below uses
   the verified public main revision.

For a contract whose Cargo package is `contract-test`, `weighin-fixtures.json`:

```json
{
  "id": "greeting-suite",
  "contracts": [{
    "id": "greeting",
    "wasm_path": "contract/target/wasm32v1-none/release/contract_test.wasm",
    "invocations": [{
      "id": "world",
      "function_name": "hello",
      "args": [{"type": "symbol", "value": "world"}]
    }]
  }]
}
```

Adapt the WASM basename to your Cargo package and the function/arguments to your
contract interface. The path is relative to the fixture file. The default
builder finds the owning Cargo manifest; merely renaming an unrelated artifact
is not supported.

`weighin.toml`:

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
memory_bytes = "allow_10_percent_increase"
```

The published pin below predates the dependency patches in this checkout.
[Dependency security review](docs/DEPENDENCY_SECURITY.md) identifies those fixes.
After publication and hosted validation, consumers should replace this pin with
the reviewed patched revision. The existing pin establishes valid public Action
syntax; new local validation is recorded separately.

After checkout, tool installation and network readiness, the Action step is:

```yaml
- uses: WeighInNG/WeighIn@eaeea48ca77d1ff74c3a4cdee5f158a44fb4819e
  with:
    fixtures-path: weighin-fixtures.json
    config-path: weighin.toml
    rpc-url: http://localhost:8000/rpc
    report-path: weighin-report.md
    metadata-path: pr-metadata.json
```

Upload the report with `if: always()` so failed policies remain inspectable.
For PR comments, add the [separate comment workflow](.github/workflows/weighin-comment.yml)
to the default branch. It reads report artifacts without executing PR code with
a write token. The supplied consumer posts only after a successful PR producer;
failed policy reports remain in artifacts and job summaries.

## Configuration

All supported inputs are declared in [action.yml](action.yml):

| Input | Meaning |
|---|---|
| `fixtures-path` | Required fixture path; default `weighin-fixtures.json` |
| `config-path` | HEAD policy file; default `weighin.toml`. A missing file means report-only |
| `rpc-url` | Compatible standalone RPC; default `http://localhost:8000/rpc` |
| `base-ref` | Fetched baseline ref; PR base branch, otherwise `main`, if omitted |
| `rust-toolchain` | Contract-build Rustup override; does not change pinned native-helper toolchain |
| `build-command` | Custom shell build command in each revision; replaces default build guarantees |
| `skip-build` | `true` uses prebuilt fixture WASMs in both revisions; incompatible with `build-command` |
| `report-path` | Optional Markdown report destination |
| `metadata-path` | Optional PR-number/HEAD-SHA JSON destination; emitted only in a PR context |
| `github-token` | Optional direct PR-comment token; omit for the separate comment workflow |

Outputs: `result` is `pass` or `fail`; `diff-json` contains the comparison.
An unsuccessful comparison emits `fail` and `{}`. A valid comparison with policy
violations emits its real diff, writes the report, then fails the Action.

Relative rules accept `strict_zero_tolerance`, `allow_X_percent_increase`, a
nonnegative numeric percentage, or `ignore`. Rules are scoped by function name
and apply to every matching contract/case with that function. Global CPU/memory
percentage rules and all-metric strict policy are also supported. Absolute caps
are configured under `[limits.global]` or `[limits.functions.hello]`:

```toml
[limits.functions.hello]
cpu_instructions = 350000
```

Caps are maximum HEAD consumption; equality passes. A zero BASE with positive
HEAD has an undefined percentage in the report and violates finite percentage
rules. Unknown/invalid policy keys fail. A nonignored rule without a matched
function fails. Unavailable metrics required by a policy fail; global
`fail_on_any_regression = true` needs explicit per-function ignores for the three
unavailable metrics. Prefer targeted rules as in the quick start.
Omitting `config-path` still loads the default file if it exists.

## Benchmark Identity

The comparison tuple is `(fixture_id, logical_id, function_name, case_id)`.
Explicit fixture/contract/invocation `id` values are stable across code changes.
Without them, normalized fixture/WASM paths and canonical typed arguments supply
identity. Different paths/arguments become new/removed cases unless both revisions
share explicit IDs. Duplicate identities fail. Runtime `contract_id` and WASM
SHA256 remain diagnostics. See [comparison identity](docs/comparison-identity.md)
and [fixture migration](docs/fixture-migration.md).

## Metrics

Eight resource fields are measured on the supported path: CPU and memory cost
units, RO+RW footprint entries, disk read bytes, RW footprint entries, encoded
write bytes, successful contract/system event count, and encoded events plus
return bytes. CPU/memory come from official native Soroban simulation with
captured network cost settings; RPC resource budgets are not consumed CPU values.
Limits come from that captured configuration. Event count has no independent cap.

Historical read bytes, instance-only contract data size and signed transaction
size are **unavailable**, represented by `null` and a reason. A measured zero is
distinct from unavailable. [Metric provenance](docs/metric-provenance.md) defines
all eleven keys and their exact semantics.

The CLI measures existing WASMs and writes JSON; it does not build, compare
revisions, enforce thresholds or post comments. Provision the native helper/RPC,
then run `node dist/cli.js <fixtures.json> --rpc-url <standalone-rpc> --output <results.json>`
from a built checkout. See [native provisioning](docs/native-measurement.md).

## Evidence

[WeighIn Evidence](docs/EVIDENCE.md) links hosted control/regression/threshold
proof, raw RPC/native captures, five clean builds and five measurements per case.
Evidence conclusions are bounded by the recorded environment.

## Known Limitations

[Known limitations](docs/KNOWN_LIMITATIONS.md) covers protocol/platform scope,
state/auth/randomness, custom builds, fixture types, CLI and GitHub behavior.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for installation, formatting, types, tests,
native replay and packaging checks. CI runs real tests and checks bundle freshness.

## License

[Apache License 2.0](LICENSE).
