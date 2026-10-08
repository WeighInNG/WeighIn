# Contract build path

The Action builds both revisions with `stellar contract build`, using locked
dependencies and optimization. It requires Stellar CLI **28.1+**, Rust **1.84+**,
and the installed `wasm32v1-none` target. The verified reference uses Stellar CLI
28.1.0 (official release archive with SHA256 verification), Rust 1.95.0, and
Soroban SDK 28.0.0 with its checked-in Cargo.lock. SDK-specific Rust requirements
can be higher than the target's minimum; Cargo reports them as build errors.

Stellar's [Rust dialect guidance](https://developers.stellar.org/docs/learn/fundamentals/contract-development/rust-dialect)
requires the modern target on current Rust. [SDK 28 release notes](https://github.com/stellar/rs-soroban-sdk/releases/tag/v28.0.0)
require the Stellar build system for specification shaking. The
[pinned CLI implementation](https://github.com/stellar/stellar-cli/blob/v28.1.0/cmd/soroban-cli/src/commands/contract/build.rs)
selects the target, filters specifications, injects metadata and optimizes its
output. WeighIn fails if the CLI reports skipped optimization; it does not fall
back to plain Cargo or the older target.

## Artifact selection

For each declared `wasm_path`, WeighIn locates the nearest owning Cargo manifest
and reads locked Cargo workspace metadata. The WASM basename must identify
exactly one workspace `cdylib` package (`my-contract` emits `my_contract.wasm`).
Unknown/ambiguous package names, missing manifests and build failures are errors.
All declarations are resolved before builds start; unrelated workspace packages
are not selected. Multiple declarations of one package share one build.

Each package builds into a fresh temporary output directory:

```text
stellar contract build --manifest-path <manifest> --package <package> --locked --optimize=true --out-dir <temporary-directory>
```

WeighIn verifies the fresh output's WASM header, then copies it to the configured
fixture path. An old artifact at that path cannot substitute for absent or failed
build output. Build result records retain each manifest/package; logs record the
artifact path, package, SHA256 and actual Rust/Stellar versions. Cargo caches may still be used; this is not a claim
of clean-build reproducibility.

The existing `rust-toolchain` Action input now supplies `RUSTUP_TOOLCHAIN` to
contract-build commands for both revisions. Omitted input preserves Rustup's
normal per-revision resolution. The native simulation helper retains its own
explicit Rust 1.95.0 toolchain. Tool installation remains the caller's duty; both
repository workflows include the verified Stellar CLI installation and target.
No custom build-command feature existed; this stage does not introduce one.

## Reference commands

After installing the official Stellar CLI release and Rust 1.95.0:

```bash
rustup target add wasm32v1-none --toolchain 1.95.0
stellar contract build --manifest-path contract/Cargo.toml --locked --optimize=true
npm ci
npm test
npm run test:native
npm run bundle
```

The reference artifact is
`contract/target/wasm32v1-none/release/contract_test.wasm`. The CLI measurement
command still consumes an existing artifact; the Action performs the two builds.

## Migration and limits

The reference fixture path changed with the target. Existing fallback logical
identities include the declared path, so old/new target paths are different
benchmark identities. Use the same explicit fixture/contract/case IDs in **both**
revisions before relocating an established benchmark, or establish a new baseline
at the migrated revision. Adding an ID only in HEAD cannot retroactively rename
BASE. An entirely unmatched migration comparison fails closed; it does not
silently pair filenames. The reference now uses a temporary duplicate declaration
to retain the exact historical identity while introducing `id:reference-contract`.
Both destinations receive the same modern build output. See the explicit
[two-step fixture migration](fixture-migration.md), including when the temporary
alias may be retired and how to prepare both artifacts for the CLI. This local
proof does not establish a green public migration PR.

Initial build proof: [verification](experiments/modern-build/verification.json).
`tests/experiments/verify-build-path.cjs` creates isolated temporary Git history,
fetches an actual local origin, creates actual worktrees, builds both source
revisions and runs the bundled Action against the pinned protocol-28 network.
The intentional HEAD change adds a persistent write while preserving `hello`'s
interface. No Git/build/RPC/meter stubs are used and no GitHub token is supplied.
Temporary experiment commits are local fixtures, not public project activity.

Reproduce with the official CLI on PATH and an isolated pinned network on port
18000:

```bash
npm run bundle
node tests/experiments/verify-build-path.cjs /tmp/weighin-modern-build-proof
```

This uses a shared Cargo artifact cache. Five clean builds/live runs, other
platforms/networks, public GitHub CI, custom build features and external project
integration remain separate work.
