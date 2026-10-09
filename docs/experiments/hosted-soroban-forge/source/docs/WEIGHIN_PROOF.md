# Escrow resource comparison proof

This is an isolated integration proof in the public WeighInNG/soroban-forge fork.
Soroban Forge is the external test target. Its maintainer permitted this test,
as communicated by the integration owner. This does not imply official adoption
or endorsement of WeighIn. Hosted results will be linked after execution.

Source baseline: Meet-hybrid/soroban-forge commit
07d7935234e9c86816116471121998b871b68439.
WeighIn engine: bbbe9001bbd375fd6a1ff75be5da2593c86fff20.

The configuration-only baseline commit B must be a direct child of the upstream
commit. It adds the fixture, two policies, forwarding observer, verifier and this document. Contract
sources, Cargo.lock, manifests, release profile and rust-toolchain.toml stay
identical. The hosted workflow records each actual immutable source SHA.
The original upstream commit cannot be used directly as the Action base because
it has no fixture file. Never pretend B is the original upstream commit.

Control C adds only the proof workflow/harness and documentation to B.
A failed initial workflow expression run is preserved; the correction only changes
runner setup and permits a sequence of harness commits with unchanged contracts. Regression R adds exactly one
persistent ParticipantIndex existence check before the existing get in
escrows_for_participant. Control compares B to C; regression and threshold compare C to R.
Both regression and threshold branches point to R;
the workflow selects the policy by branch. Record all actual SHAs publicly.

Only the real fresh-deployment empty participant view is covered. There is no
authorization, funded token, populated participant index or escrow lifecycle
coverage. Return remains {ids: [], total: 0, next_cursor: None}. The address is
public test data, not a signer. WeighIn's transient network signer must not be
committed or uploaded.

Build both revisions with Forge's Stellar CLI 28.0.0 CI path:

    CARGO_TARGET_DIR=target stellar contract build --package soroban-forge-escrow --locked --profile release --optimize=false

Use Rust 1.95.0 (a controlled stable compiler), wasm32v1-none, Node 24,
Ubuntu 24.04 x64 and Docker. Do not edit Forge's toolchain or SDK. Protocol-28
standalone quickstart digest is pinned by the WeighIn source script. Helper uses
soroban-simulation 28.0.1. Contract SDK is locked at 28.0.0; the engine's JS Stellar
SDK is locked at 16.0.1. Record actual tool outputs and helper/WASM hashes.

Proof branches only; no main/tag/release triggers. Disable inherited release/publish and comment/status workflows before proof commits.
There is no separate deployment workflow among the four inherited workflows.
No fake regression merge and no release tags. Use only read permissions; no PR
comment token. Cleanup: retain immutable public evidence first, then remove proof
branches if desired. Disabling all fork Actions instead would block this proof;
the ordinary CI workflow remains enabled with its existing main/integration triggers.
Release and ForgeBot are disabled manually; scheduled Security Audit remains
disabled_fork. No upstream secrets exist in this fork. The proof grants contents:read
and uses no secret except GitHub-generated read token for checkout.

Control requires equal WASM and zero deltas for comparable metrics. Regression
requires different WASMs/runtime addresses, one logical match, unchanged return
and positive measured CPU delta. Threshold uses the exact same R and strict CPU
zero tolerance; the original Action step must fail with result=fail and a CPU
policy violation. continue-on-error allows the surrounding proof to finish green
only after mandatory assertions. Preserve the actual Action process exit from
its forwarding exit observer and public step outcome; do not call this a red workflow when the job is green.

Artifacts retain source patch, actual BASE/HEAD WASMs, hashes, raw native input /
output, forwarded RPC responses, report, diff and verification. CPU/memory come
from official native replay, with RPC transaction-data/return/event parity;
ledger resources come from raw RPC XDR. Unavailable metrics remain null. Artifact
retention is 30 days: archive sanitized evidence to an approved durable public
location before expiry, rather than presenting expiring artifacts as permanent.
No startup private-key logs, secrets, Docker state or whole workspaces uploaded.

No numeric regression estimate is promised. If a single extra read produces no
positive CPU delta, preserve the failed experiment and reassess the smallest
change; do not alter assertions or substitute historical values to manufacture
success. Network, build or missing-report failures must fail the proof job.
