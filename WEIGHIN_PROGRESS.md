# WeighIn Appeal-Readiness Progress

This file is the operational state of the WeighIn appeal-readiness campaign.

Codex must read this file at the start of every relevant session and update it after completing an approved stage.

Do not mark anything complete unless there is evidence.

---

## Overall objective

Make WeighIn a technically credible, reproducible, current Soroban developer tool whose flagship claims are publicly verifiable before appealing its previous Drips Stellar Wave rejection.

The goal is substantive product improvement, not cosmetic grant optimization.

---

# Current status

## Stage 0 — Baseline audit

Status: COMPLETE

Baseline findings:

- Original comparison identity was incorrect.
- Runtime `contract_id` was derived from WASM.
- Changing WASM changed contract ID.
- Diff matching therefore treated modified contracts as removed + new.
- Real test suite was absent.
- `npm test` was previously a successful no-op.
- Default/current build tooling requires further modernization.
- Metric provenance and unavailable-value semantics require investigation.
- Original no-baseline behavior could fail open (repaired in Stage 1C).
- Complete end-to-end resource-regression proof did not exist.

---

## Stage 1A — Logical comparison identity

Status: COMPLETE AT COMPARISON LAYER

Implemented:

- Stable logical benchmark identity separated from runtime deployment identity.
- Comparison identity:

  `(fixture_id, logical_id, function_name, case_id)`

- Fixture identity:
  - explicit fixture `id`, or
  - normalized workspace-relative fixture path.

- Contract identity:
  - explicit contract `id`, or
  - normalized fixture-relative WASM path.

- Case identity:
  - explicit invocation `id`, or
  - canonical typed arguments.

- Runtime contract IDs and WASM hashes remain diagnostics.
- Duplicate logical identities are rejected.
- Schema version upgraded to 2.
- Mixed legacy/new schemas do not guess pairings.
- New/removed benchmark cases are represented separately.

Files changed included:

- `src/identity.ts`
- `src/measurement.ts`
- `src/diff.ts`
- `src/action.ts`
- `src/comment.ts`
- `src/threshold.ts`
- `package.json`
- behavior tests
- comparison identity documentation
- regenerated action bundle

Validation:

- `npm ci`: PASS
- `npm test`: PASS
- 22 behavior assertions: PASS
- `npm run build`: PASS
- `npm run bundle`: PASS
- `git diff --check`: PASS

Flagship comparison identity statement now supported:

> A change to Soroban WASM may change its runtime contract ID, while WeighIn still recognizes BASE and HEAD as the same configured benchmark.

---

# Current blocker

## Safeguard published and core CI green; comment workflow repair and external CI remain

PR #1 now publishes cc4e5a080f4fe47d3af6b1908bb082e30844f96a on its existing
head branch test/no-op-baseline. All seven core checks passed: lint/typecheck/test,
bundle freshness, both benchmark jobs, and flagship control/regression/threshold.
Earlier c32/conflict records below are historical. Main has not been merged.
One separate default-branch comment workflow passes; the other fails after checkout
deletes its downloaded report. This also occurred before the safeguard push.

Stage 6 now proves the real Soroban Forge escrow query locally: control CPU
565371 -> 565371 (all eight measured deltas zero), intentional regression
565371 -> 679455 (+114084), and one strict CPU violation with genuine Action
exit 1. Changed WASM/runtime addresses pair with the same logical benchmark;
return XDR and raw RPC/native parity are verified. External publication remains
unproven and has not been authorized. Three unavailable metrics remain explicit.

Stage 6B isolates the optimizer difference to temporary storage. Changing only
TMPDIR reproduces the two hashes five times per mode. System /tmp writes fail
with EDQUOT and leave zero-byte convergence files; healthy workspace writes pass.
Five full builds per storage mode reproduce the same artifacts. Five fresh live
measurements per artifact repeat all eight measured values exactly, with the
same two-instruction CPU difference and verified raw RPC/native parity.
Concurrency and path-spelling candidates did not resolve the difference.

Stage 6C implements pre/post write/fsync/read checks and directs optimizer temp
files into verified owned storage. Actual system-temp write failure is rejected.
Five full Action controls on real Soroban Forge repeat identical WASM/all eight
measured resources; regression remains +114084 CPU and strict policy exits1.
Checks cannot reserve capacity or exclude a transient optimizer-only failure.

Highest-priority unresolved dependency: repair the own-repository comment
workflow's artifact/checkout order, retaining the report through posting. Proposed
next stage is a narrow workflow change with behavior-level ordering validation;
requires separate stage approval. The existing workflow_run uses main, so hosted
activation also requires reviewed merge/default-branch delivery authorization.
Then deliver the external fixture baseline through the existing fork and obtain
maintainer merge before its dependent workflow/regression proof. External push/PR,
merge and Drips submission are not authorized. The current user approved only
publication of the tested WeighIn work; that publication and core CI are complete.
See docs/external-soroban-forge.md and Stage 6 below. No appeal-readiness or
Drips-approval claim is supported yet.

# Approved native integration — completed 2026-10-07

Historical Stage 1 integration record. Stage 3 below supersedes its schema and
metric-availability scope; the original evidence remains unchanged.

Status: COMPLETE FOR CPU/MEMORY ON LINUX X64, PROTOCOL 28, STANDALONE PATH

Implemented:

- `native/simulation/`: official simulation/host 28.0.1, pinned Cargo.lock,
  RPC-matched features/auth mode, isolated Cargo workspace, explicit Linux target,
  JSON transport, strict missing-state/config/
  protocol/host failures; archived state explicitly unsupported.
- `src/simulation.ts`: Linux provisioning with Rust 1.95.0, executable override,
  output validation, consistent immutable snapshot capture, drift retry, discovered
  key expansion, full transaction-data/return parity against RPC, compute provenance.
- `src/measurement.ts`: real consumed CPU/memory and captured dynamic compute
  limits. Schema 3 retains logical tuple/runtime address/WASM hash separately.
- Remaining nine metric names explicitly unavailable with null values/reasons;
  no unsupported zero/limit substitution. Their audit remains Stage 3 work.
- Diff validates availability and source metadata, keeps legacy/schema-2 comparison
  behavior, rejects mixed schema 2/3 and incompatible compute environments.
- Full configuration drift includes fee-only live-state-size windows. Those full
  hashes remain visible; compute compatibility uses cost/limit/TTL value hashes.
  The live experiment caught the overly broad initial full-config guard; it was
  narrowed based on the pinned library's budget/config implementation.
- Policies requiring unavailable metrics produce explicit violations. `ignore`
  is the opt-out. Reports include unavailable reasons, logical identity, runtime
  addresses, provenance and both full configuration hashes.
- Action writes job summaries without requiring a PR token and fails locally on
  valid-comparison policy violations. CLI produces schema-3 JSON; missing helper
  exits 1 and emits no result file. At this stage, no-baseline fail-open remained;
  it has since been repaired in Stage 1C.
- Native source/lock included in local npm tarball and Action checkout; no native
  binary embedded in JS. Added build/helper-test scripts and CI behavior checks.
- Pinned quickstart reference image to the tested protocol-28 digest; default
  contract build selection/toolchain modernization was not changed.
- Included previously ignored package-lock.json so CI's npm ci is reproducible.
- README and production contract source were not changed. No commit/push/issues.

Proof and evidence:

- `docs/native-measurement.md`: supported path, schema migration, provisioning,
  policy semantics, limitations and rerun procedure.
- `docs/experiments/native-integration/`: genuine BASE/temporary HEAD WASMs/source/
  contract lock, production measurements, raw RPC captures, diff, violations,
  Markdown reports, process exit/output evidence and checksummed manifest.
- CPU 270219 -> 314046 (+43827, +16.22%); memory 1125761 -> 1193705 (+67944).
- Changed WASM/address pair as the same configured logical benchmark.
- Control delta zero; CPU policy passes. Intentional regression policy reports one
  violation. Real bundled Action processes exit 0 (control), 1 (regression),
  1 (policy requiring an unavailable metric).
- Production CLI exits 0 with schema-3 results; explicit missing helper exits 1.
- Native tests replay real snapshots five times per revision with identical
  outputs; leeway changes budgets while consumed compute is unchanged.
- The Action experiment isolates checkout and contract-build commands and uses
  genuine prebuilt artifacts. RPC, deployment, helper, diff/report/thresholds and
  bundled Action are real. No public GitHub CI/default contract build proof claimed.

Validation:

- npm ci: PASS after sandbox EPERM retry; existing 1 moderate/4 high audit findings.
- npm test: PASS, 48 behavior/evidence tests with real Node child-process execution.
- npm run test:native: PASS, 7 native behavior tests (includes helper build).
- npm run build: PASS.
- npm run bundle: PASS.
- cargo fmt --check --manifest-path native/simulation/Cargo.toml: PASS.
- npm pack: PASS, local tarball includes CLI/bundle/native source and lockfile;
  nothing published. Nested Cargo-workspace metadata check: PASS.
  No lint/typecheck scripts; build/bundle check TypeScript.
- Explicit live integration harness: PASS; eight native-spike negative checks
  preserved and new transport/availability/environment cases covered.
- git diff --check: PASS.

Remaining limitations:

- Only CPU/memory have promoted verified consumption semantics; other metrics
  are visibly unavailable. Global all-metric policy currently fails on those gaps.
- Linux x64/protocol 28/standalone; auth/random/archived cases outside proven scope.
- Immutable capture is per invocation; arbitrary live state/ledger effects can
  differ across BASE/HEAD. Clean-build/live-network repeatability is not proven.
- Native Rust provisioning is required; public CI still needs verification.
  The default build path was subsequently verified locally in Stage 2.
- Baseline absence/errors and malformed policy configuration were Stage 1C risks;
  the following approved stage repaired them.

# Current approved work — Stage 5D public flagship CI preparation

Stages 4, 4B and the historical fixture migration (Stage 5A) were approved and
completed locally on 2026-10-08. Details and limitations are below. Stage 5D
preparation is now approved; public push and external-project changes are not authorized.

The user approved and completed Stage 5B on 2026-10-08: bounded network/Friendbot
startup readiness proved on fresh pinned networks.
The user approved Stage 5C clean-checkout/package verification on 2026-10-08.
Reproduced baseline package defects: fresh npm pack omits the CLI without a manual
build, and even a manual build never creates the advertised dist/index.js.
Fixing existing package delivery and the fixed historical experiment baseline;
no new benchmark features or push/publication authorized. Local commits after
each coherent change remain authorized; pushing is not authorized.
The user approved Stage 5D workflow/harness preparation and local proof.

---

# Remaining roadmap

## Stage 1B — Live measurement compatibility

Status: COMPLETE FOR VERIFIED CPU/MEMORY ON THE SUPPORTED NATIVE PATH

Goal:

Make current Stellar RPC simulation results correctly measurable.

Required proof:

- raw RPC response captured;
- SDK parsed representation captured;
- extraction mapping documented;
- CPU/memory/etc. verified;
- real regression experiment rerun successfully.

Findings (2026-10-07):

- Stellar RPC removed legacy `cost` for protocol 22. The current endpoint does
  not return it; this is not just a JS SDK parser issue.
- Pinned RPC commit `8a40169717723697e430c1e51c21ef0bf244ecda` confirms its
  `formatResponse` does not expose preflight CPU/memory fields.
- SDK 16.0.1's successful simulation type has no metered compute fields.
- Live diagnostic events contain function call/return data, not measured compute.
- Transaction resources contain adjusted submission budgets and IO fields.
- The exact same BASE transaction's instruction budget changes from 320219 to
  5270219 with instruction leeway 5000000. It cannot be called consumed CPU.

Implemented within approved Stage 1B:

- `src/measurement.ts`: narrowed the SDK response with `isSimulationSuccess`;
  replaced the undefined `cost` dereference with an explicit unavailable-compute
  error. `requireComputeConsumption` deliberately rejects every current success
  response until a verified source exists. It is not a working extraction fix.
- No benchmark records are returned on missing compute; no zero/budget fallback.
- No measurement schema migration or threshold policy change.
- `tests/simulation-compatibility.test.cjs`: 11 behavior/evidence tests covering
  raw/parsed fields, IO agreement, control, leeway, missing compute, rejection of
  legacy cost substitution, simulation errors and missing transaction data.
- `tests/fixtures/stage1b/`: real request XDR, raw and parsed responses, environment,
  prior build records and explicitly blocked live experiment results.
- `tests/experiments/capture-simulation.cjs`: explicitly invoked live evidence
  harness, separate from npm test. Captures contain no private key.
- `docs/simulation-compatibility.md`: source mapping, outcome and rerun procedure.
- Regenerated `bundled/index.js`.

Live results:

- Dedicated quickstart image pinned to
  `sha256:4c8bad1ef7341205b898f83d9489321da80c7bd74183100fc8e2a39a5938c7d5`.
- RPC 29.0.0, core v29.0.0, protocol 28, JS SDK 16.0.1.
- Reused real temporary Stage 1A artifacts; rechecked complete SHA256 values.
  No new Cargo builds claimed for Stage 1B. Fixtures and lockfiles match.
- BASE/control have identical WASM, runtime address, IO fields and budgets.
- Temporary HEAD has different WASM/address, write entries 0 -> 1, write bytes
  0 -> 88, unchanged fixture interface and return value.
- All simulations succeed, but WeighIn explicitly rejects measurements because
  consumed CPU/memory are unavailable. No measured-compute comparison or live
  threshold proof was produced. The live harness exits 1 with status BLOCKED;
  diagnostic assertions pass.

Validation:

- `npm ci`: PASS (existing audit reports 1 moderate and 4 high vulnerabilities).
- `npm test`: PASS; 22 identity tests plus 11 compatibility tests.
- `npm run build`: PASS.
- `npm run bundle`: PASS.
- No lint/typecheck scripts exist; build and bundle invoke TypeScript checking.
- Artificial regression remains in temporary contract copies, not production.
- No commit, push, issue creation, README change or toolchain modernization.

The guard-only results above are historical. The subsequently approved native
integration now emits real CPU/memory results and proves the supported local
comparison/threshold exit path. See the current native integration section.
Broader metric/network/build compatibility and public GitHub CI remain unproven.

---

## Stage 1C — Fail-closed policy behavior

Status: COMPLETE FOR THE LOCAL SUPPORTED PATH — 2026-10-07

Root causes: BASE errors were converted to exit-0 `no-baseline`; config was an
unchecked TOML cast and unknown rules were ignored. Empty/unmatched comparisons
could also yield vacuous policy success.

Implemented after explicit user approval:

- `src/action.ts`: BASE failures propagate; all unsuccessful comparisons emit
  `result=fail`, `{}` diff and exit 1 with an error job summary. HEAD failures use
  the same output path. At least one matched benchmark is required even without
  policy. Worktree creation uses the fetched `FETCH_HEAD`, rather than assuming
  an `origin/ref` tracking ref was updated. Failed creation attempts clean up.
- `src/threshold.ts`: strict config validation in both file loader and public
  enforcement; unsupported rules/keys/types, malformed/nonfinite/negative caps
  fail before measurement. Nonignored function policies require a matched case.
  Valid numeric/decimal caps, ignore, overrides and optional absent config remain.
- `src/identity.ts`: empty suites/invocation sets rejected before side effects;
  zero-argument invocations remain supported.
- `src/diff.ts`: blank function identities and incomplete schema-3 provenance
  rejected, including unmatched records. Existing schemas/identity matching and
  new/removed benchmark representation retained.
- `action.yml`, `docs/native-measurement.md`: migration made explicit; successful
  `no-baseline` removed. No measurement schema version change.
- `tests/fail-closed.test.cjs`, `tests/support/action-unit-hook.cjs`: 21 additional
  behavior tests, including Action subprocess exits for checkout/worktree/build/
  measurement/missing or malformed fixtures, unsupported schema/provenance,
  empty/unmatched results, config failures, control/regression and absent policy.
  Unit IO dependencies are controlled; not presented as live measurements.
- `tests/metric-availability.test.cjs`: environment mismatch inputs now conform
  to provenance field types before comparison.
- `tests/experiments/{verify-integration,action-local-tools}.cjs`: live bundled
  Action proof extended with intentional infrastructure/fixture/WASM failures
  and invalid policy. Regenerated `bundled/index.js`.

Validation:

- npm ci: PASS; unchanged audit finding of 1 moderate and 4 high vulnerabilities.
- npm test: PASS, 69 tests (48 existing + 21 new).
- npm run test:native: PASS, 7 tests including five frozen-state repeats/revision.
- npm run build and npm run bundle: PASS; no lint/typecheck scripts exist.
- npm pack --dry-run --json and git diff --check: PASS.
- Initial validation caught an incorrect string check on the seed array; repaired
  against the real schema and reran all tests. Packaging first hit sandbox EROFS
  in npm cache; authorized rerun passed.

Live evidence: `docs/experiments/fail-closed/verification.json`, process exits,
outputs/summaries, raw RPC captures, measured results and SHA256 manifest.

- Control CPU delta 0, exit 0.
- Real changed-WASM/address CPU 270219 -> 314046, delta +43827 (16.219%), strict
  threshold exit 1. Fixture interface unchanged; artificial regression remains
  in evidence/temp artifacts, not the production contract.
- Unavailable metric policy exit 1.
- Five injected BASE failures (fetch, worktree, build, missing fixtures, missing
  WASM/measurement) and invalid rule each exit 1; no successful no-baseline output.
- Real local RPC/native measurement, protocol 28 pinned image. Checkout/build
  commands intentionally controlled; default build, real fetch integration and
  public GitHub CI are not proved by this experiment.
- Evidence excludes private keys; isolated container stopped. No commit/push,
  issue creation, GitHub comments, README change or general build modernization.

Remaining scope: partial suite additions/removals are displayed and excluded from
regression deltas; they do not acquire a fabricated baseline. A function policy
requires at least one matched case, not a baseline for every newly added case.
Config absence is still an explicit supported no-threshold mode. Public CI,
modern default builds, broader metrics and clean/live repeatability remain open.

---

## Stage 2 — Modern Stellar build path

Status: COMPLETE FOR THE VERIFIED LOCAL REFERENCE PATH — 2026-10-07

Approved after the Stage 1C report. Findings verified against official Stellar
documentation, SDK 28 release notes and CLI v28.1.0 build source/help:

- Existing `rustc --print targets` is invalid and fell back to the old target.
- Modern Rust/Soroban requires wasm32v1-none; SDK 28 requires Stellar build-system
  specification shaking. CLI defaults include metadata/filtering/optimization.
- Stellar CLI was absent locally. Downloaded its official 28.1.0 Linux x64
  release into /tmp and verified the archive against GitHub's published digest:
  c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462.
- Context proposed preserving custom build commands, but none existed. No custom
  build feature was introduced.

Implemented:

- New `src/build.ts`: validated fixture declarations; locked Cargo workspace
  metadata selects exactly one cdylib package per artifact basename. Every
  declaration must resolve; missing/ambiguous names fail. Deduplicates repeated
  package builds. Uses stellar contract build with explicit manifest/package,
  --locked, --optimize=true and a fresh temporary output directory. Verifies WASM
  header before copying to fixture path, so stale outputs cannot masquerade as
  successful builds. Preserves compiler stderr in failures and reports tool
  versions/artifact hashes. Rejects missing/old tools and skipped optimization.
- `src/action.ts`: both revisions use the shared builder; existing rust-toolchain
  input now sets RUSTUP_TOOLCHAIN for contract commands. Helper pin is unchanged.
- `rust-toolchain.toml`, `weighin-fixtures.json`: wasm32v1-none aligned with Rust
  1.95.0. `contract/Cargo.toml`/lock now pin SDK 28.0.0 (guest/common 28.0.2).
- Both current workflows provision the checksum-verified CLI 28.1.0 and modern
  target. Core workflow verifies the optimized reference contract build.
- `tests/contract-build.test.cjs`: 12 behavior cases for fresh artifacts, workspace
  package selection/aliases, ambiguity, unknown names, missing manifests/tools,
  old tools, failed builds, missing/invalid outputs and skipped optimization.
- Updated Action unit/live infrastructure hooks for the new build boundary;
  these remain explicitly controlled tests, distinct from the new full proof.
- `tests/experiments/verify-build-path.cjs`: new real production-path proof.
- `docs/contract-build.md`, `docs/native-measurement.md`, `action.yml`, package file
  inclusion and regenerated bundle aligned with behavior. Production contract
  source/README unchanged. No new result schema or metric semantics.

Proof: `docs/experiments/modern-build/` contains exact temporary BASE/HEAD commits,
source/lock/toolchain/fixtures, control/regression WASMs, Action process logs,
diff JSON/output/summary, reference build log, verification and SHA256 manifest.

- Real local Git origin fetch and worktree creation; real Stellar source builds,
  deployment, RPC/native measurements, logical matching, report and policy exits.
  No build/checkout/RPC/meter stubs and no GitHub token/comments.
- Rust 1.95.0, official CLI 28.1.0, SDK 28.0.0, wasm32v1-none, pinned protocol-28
  quickstart. Native meters stay at their already verified 28.0.1 source.
- Control: both builds have SHA256
  718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668,
  optimized size 776 bytes, CPU delta 0, Action exit 0.
- Temporary persistent-write HEAD: SHA256
  5878fa37dfcec8eaebc72111dfdbfa92447cb735bd88d23dcaf0e8edf9f7f3e8,
  871 bytes; different runtime address, unchanged interface, same logical
  benchmark. CPU 266842 -> 309171 (+42329, +15.8629%). Strict CPU policy exit 1.
- Temporary Git commits are isolated fixture history, not repository/public
  activity. A shared Cargo artifact cache is recorded; this is not a five-clean-
  build/live-run reproducibility proof.

Validation:

- npm ci: PASS (unchanged 1 moderate/4 high npm audit findings).
- npm test: PASS, 81 tests (69 previous + 12 build behavior tests).
- npm run test:native: PASS, 7 tests.
- npm run build / npm run bundle: PASS.
- npm pack --dry-run --json: PASS; build module, native source and docs included.
- git diff --check: PASS. No lint/typecheck scripts; TypeScript checked by gates.
- Production reference build and full local Action control/regression proof: PASS.
- Prior live measurement/fail-closed harness: PASS after adapting its explicit
  infrastructure hooks. Initial rerun lacked Stellar on PATH and failed command
  lookup; rerun with the verified CLI passed all nine Action exit scenarios.
  This compatibility check retains controlled checkout/build commands and is
  not the full-build proof. Verification copied beside Stage 2 evidence.

Limitations/migration:

- Existing fallback identity includes the declared WASM path. Target-path changes
  require stable explicit IDs in both revisions or a migrated baseline. Adding
  an ID only in HEAD cannot rename BASE. The first repository migration comparison
  may fail closed against historical old-path fixtures. No filename guessing,
  public migration-PR/CI pass or external-project proof claimed.
- Supported measurement remains Linux x64/protocol 28/standalone CPU/memory only.
  Nine metrics remain unavailable; clean/live repeatability remains Stage 4.
- CLI remains an existing-WASM measurement command. Build override features,
  other build platforms and arbitrary project layouts are not newly claimed.
- No repository commit/push, issue creation, external changes or artificial
  regression in production source. Evidence excludes private keys; isolated
  proof network stopped after validation.

---

## Stage 3 — Metric provenance and semantics

Status: COMPLETE FOR THE AUDITED LINUX X64/PROTOCOL-28 STANDALONE PATH —
2026-10-07–08. Eight metrics measured; three explicitly unavailable.

Implemented:

- Schema 4 retains stable logical benchmark identity and runtime diagnostics.
- Eight measured metrics: native CPU/memory, RO+RW footprint entries, disk-read
  XDR bytes, RW footprint entries, encoded RW postimage bytes, successful
  non-diagnostic contract/system event count and events plus return XDR bytes.
- Six promoted consumption fields verified against real raw RPC for repeated
  reads, queried absence, no-op write, deletion, classic Account read via SAC,
  emitted event and larger return. No fake RPC/measurement used.
- Dynamic caps come from same-ledger captured ComputeV0/LedgerCostV0/
  LedgerCostExtV0/EventsV0 settings. Measured metrics provide limit_source or
  limit_reason. Event count has no independent cap; no invented constant.
- Three names stay unavailable: historical read consumption, instance-only size
  and signed benchmark transaction size. Explicit null/reasons remain fail closed
  under policies requiring them. Global all-metric policies still need ignores.
- Schema-4 event_data_bytes explicitly means events PLUS return XDR bytes;
  clarified footprint/disk/write labels and provenance appear in reports.
- Resource-limit hash and per-metric source/cap compatibility reject invalid
  comparisons. Fee-only changes/metadata are diagnostics; mixed schemas fail.
- RPC/native charged-event parity now checked, alongside transaction-data/return.
- Native helper schema 1/source/lock unchanged; audited existing fields suffice.
- docs/metric-provenance.md and captured/checkable live evidence under
  docs/experiments/metric-provenance/; production contract source unchanged.

Validation:

- npm ci: PASS; unchanged 1 moderate/4 high audit findings.
- npm test: PASS, 92 behavior/evidence tests (81 previous + 11 audit/transport cases).
- npm run test:native: PASS, 15 tests (7 previous + 2 adapter + 6 live replays).
- Real isolated modern contract build/deployment/raw-RPC metric audit: PASS.
- npm run build / npm run bundle: PASS; TypeScript checked. No lint/typecheck scripts.
- npm pack --dry-run --json: PASS for file inclusion (no publication/install claim).
- cargo fmt --check --manifest-path native/simulation/Cargo.toml: PASS.
- git diff --check: PASS.
- Real production CLI: exit 0, schema 4, six fixture cases, recorded SDK 28.0.0.
- Real BASE/HEAD Action write-byte policy proof: PASS with real fetch/worktrees,
  locked optimized source builds, RPC deployment/native measurement and reports;
  no IO stubs/GitHub token. Control exit 0; strict write-byte regression 0 -> 88,
  delta +88, exit 1. CPU 266842 -> 309171 (+42329, +15.8629%); changed WASM/runtime
  identity still matches the logical benchmark. Temporary fixture commits only.
- Final Action evidence: docs/experiments/metric-provenance/action/verification.json.
  Complete metrics/RPC/native inputs/outputs, CLI results, pinned source hashes,
  environment, validation and checksummed manifest recorded beside it.
- No-op write is charged 80 postimage bytes; deletion has one RW key and zero
  postimage bytes; classic Account read is 144 disk bytes; event plus return is
  96 bytes; larger return without events is 652 bytes. Values apply to saved cases.
- Test-development failure: fee-mutation test used non-exported xdr.Hyper; changed
  to public xdr.Int64 and rerun passed 15/15. Production mapper unaffected.
- Operational rerun failure after session gap: network stopped and temporary
  CLI/cache removed. RPC health check correctly exited 1. Restarted pinned image,
  restored SHA256-verified CLI 28.1.0 and reran final real proof successfully.
  No fabricated measurement workaround. Proof container stopped after capture.

Files touched in this stage:

- src/measurement.ts, src/simulation.ts, src/diff.ts, src/comment.ts;
- package.json (metric documentation packaging), regenerated bundled/index.js;
- tests/metric-provenance.test.cjs, tests/simulation-adapter.test.cjs,
  tests/native/metric-provenance.test.cjs, tests/native/simulation.test.cjs;
- tests/comparison-identity.test.cjs (schema error expectation),
  tests/experiments/verify-metric-provenance.cjs, verify-build-path.cjs and
  verify-integration.cjs (current schema/unsupported-policy name);
- docs/metric-provenance.md, native-measurement.md, comparison-identity.md,
  new docs/experiments/metric-provenance/ evidence and this progress file.

Limitations / next dependency:

- Linux x64, protocol 28, standalone; archived state unsupported. RPC does not
  expose consumed CPU/memory; native metering supplies those. Auth/random/state
  disagreement remains an explicit error. Captured state is per invocation.
- The three unsupported names remain policy failures unless ignored. Schema 3/4
  cannot be mixed. Eight measured metrics are not a claim of every resource type.
- Full Action proof shares a Cargo artifact cache. Five clean/live runs, public
  CI and external-project proof remain unproven; historical fixture migration may
  still fail closed. Stage 4 is the highest-priority next unresolved dependency.
- Existing ignored dist artifacts can appear in local npm dry-run output; the
  package check proves inclusion, not a clean-package/API installation guarantee.
  Clean checkout/packaging truth alignment remains later work.

No repository commit/push, issue creation, external changes or README edit.
Clean-build/live five-run proof remains Stage 4 and requires separate approval.

---

## Stage 4 — Repeatability

Status: COMPLETE FOR THE RECORDED FIVE CLEAN BUILDS / LIVE METRIC SERIES — 2026-10-08

The experiment uses five unique verified-empty Cargo target directories with
locked SDK 28.0.0 sources, official CLI 28.1.0 and Rust 1.95.0. One funded account,
one pinned standalone protocol-28 network and one verified helper binary remain
fixed. Captured ledgers/config/state are allowed to advance and recorded.

The existing six-case metric-audit WASM is reused separately for five live cycles
of nonzero IO/event cases; it is not presented as five clean audit builds.
Production source/measurement behavior is unchanged. Experiment analysis tests
check both increases/decreases, artifact changes and invalid source/cache/case
evidence. No next roadmap stage is authorized.

Evidence: `docs/repeatability.md` and `docs/experiments/repeatability/completed/`.

- Five fresh-target reference builds, each optimized to 776 bytes, all SHA256
  `718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668`.
- Exact input snapshot SHA256
  `9b8f8aa35dba73f8997e90fcec0626cd281fd8a9636a891c489e22ae3f35d654`;
  Git SHA is recorded separately from uncommitted input files.
- 35 genuine live invocation measurements: hello plus six audit cases, each five
  times. All eight supported metric ranges and population standard deviations
  are zero. Reference CPU 266842/memory 1123942 in every run. Nonzero write bytes,
  disk bytes and events also repeat exactly; see the full table/CSV.
- Snapshot ledgers 833–1101; five distinct snapshot/full-config hashes per case.
  Compute calibration and resource limits stay constant. Three unavailable
  consumption values stay null. All supported-metric strict policies pass with
  explicit ignores only for the unavailable names.
- Raw RPC, native inputs/outputs, source, WASMs, reports, analyses, producer
  snapshots and checksums saved. No simulated benchmark writes submitted, fake
  results or response substitutions. Audit WASM/helper reused, recorded explicitly.

Files added: experiment harness and analysis under tests/experiments; seven
analysis behavior tests and two saved-live-evidence tests; repeatability docs and
captured evidence. This progress record updated. No production source/README,
result schema or comparison/measurement semantics changed in Stage 4.

Validation: npm ci PASS (existing 1 moderate/4 high audit findings); npm test
101/101 PASS; npm run test:native 15/15 PASS; npm run build PASS; npm run bundle
PASS; npm pack --dry-run --json PASS (inclusion only); native cargo fmt --check
PASS; git diff --check PASS. Full logs and command exits are saved.
No lint/typecheck scripts; build/bundle check TypeScript.

Attempts preserved separately: friendbot funding failure before samples; partial
run with empty RUSTFLAGS disabling CLI remapping; existing SAC deployment failure;
and captive-core HTTP 404 during warm-up with later successful request rechecks.
Harness funding/SAC setup corrected and RUSTFLAGS unset for the definitive series.
Production RPC error handling remains unchanged.

Conclusion: these fixtures have repeatable artifacts/resources conditional on
successful live capture under recorded inputs. This does not prove failure-free
RPC operation, arbitrary state/auth/random/time-dependent contracts, cross-machine
build determinism, separate public CI or five clean builds of the reused audit
WASM/helper. No repository commit/push/issues or external changes.

---

## Stage 4B — Live snapshot capture reliability

Status: COMPLETE FOR THE OBSERVED ERROR SHAPE — 2026-10-08

User explicitly approved Stage 4B. Implemented the smallest capture-path repair:

- src/simulation.ts: typed internal RPC errors preserve method/code/message.
  Only getLedgerEntries / -32603 / the exact observed captive-core HTTP 404
  message is retryable. Three retries per invocation, delays 250/500/1000 ms,
  warnings, full recapture starting from simulation. Partial rows discarded.
- Retries share the existing 30-capture budget. Fourth matching failure or budget
  exhaustion fails measurement; other errors/malformed state/header disagreement/
  helper parity failures remain fatal. No zero substitution, schema, input,
  threshold or identity changes.
- Ten behavior tests in tests/snapshot-recovery.test.cjs: one/three-failure
  recovery, exhaustion, discarded partial batches, unrelated errors, method
  isolation, malformed/header/parity rejection, ledger drift and shared budget.
  Controlled responses/helpers are explicitly labeled, not live evidence.
- Five real live cycles / 35 measurements using the saved verified reference and
  six-case audit WASMs. All eight supported metric values repeat; zero strict
  policy violations with three explicit unavailable ignores. All IO/native work
  genuine. No new clean-build claim. No transient error occurred in the rerun;
  naturally triggered automatic recovery therefore remains unobserved.

Evidence: docs/snapshot-recovery.md and docs/experiments/snapshot-recovery/ contain
raw RPC/native inputs/outputs, runs/diffs/policies, captured environment, process
and controlled-test logs, WASMs/fixtures, producer and source hashes, quality gate
exits/logs and checksums. Private seed scan passed; helper hash unchanged. Proof
container stopped. No production contract/README/native meter source changes.

Validation: npm ci PASS (existing 1 moderate/4 high findings); npm test 111/111
PASS; npm run test:native 15/15 PASS; npm run build PASS; npm run bundle PASS;
npm pack --dry-run --json PASS including new recovery documentation (inclusion,
not clean installation); native cargo fmt --check PASS; git diff --check PASS.
No lint/typecheck scripts; TypeScript checked by build/bundle.

Files changed: src/simulation.ts, regenerated bundled/index.js, package.json
(recovery doc inclusion), new behavior test and live experiment harness/evidence,
docs/native-measurement.md, docs/snapshot-recovery.md, historical wording in
docs/repeatability.md and this progress record. Prior dirty work preserved.

Development/environment failures recorded: initial test mocks shadowed scenario
options, so injected faults were ignored; corrected test parameter names and all
ten tests passed. Package inclusion recheck encountered sandbox child-spawn EPERM;
elevated rerun passed. No fabricated workaround or altered live result.

Limits: one exact error shape; underlying captive-core cause/network availability
not repaired or guaranteed. Persistent/unknown failures remain fail closed.
Historical fixture migration is the next unresolved dependency before flagship
public CI; external-project proof remains pending. Separate approval is required
for that next work. No commit/push/issues/external changes.

---

## Stage 5 — Internal flagship proof

Status: LOCAL SOURCE BUILD/COMPARISON/EXIT PROOF COMPLETE; PUBLIC CI PROOF PENDING

### Stage 5A — Historical fixture identity migration

Status: PREPARED AND PROVEN LOCALLY — 2026-10-08; PUBLIC MERGE/RETIREMENT PENDING

User approved the next historical migration dependency. Inspection confirmed a
path change plus adding an ID only in HEAD cannot match the no-ID historical
BASE. Smallest solution uses existing semantics and changes no production logic:

- weighin-fixtures.json: modern path gets id reference-contract; retain the exact
  historical no-ID declaration as a temporary second configured benchmark. Do not
  rename the fixture/case at the same time. Builder deduplicates the package,
  builds once with wasm32v1-none and copies identical fresh bytes to both paths.
- First comparison pairs historical identity and shows the stable ID as new.
  A later revision may remove the no-ID declaration only once BASE contains the
  stable ID. That retirement is modeled/proved in test fixtures, not applied to
  the working fixture. Temporary duplicate measurement is documented.
- Seven schema-4 behavior tests plus one build-alias test. No automatic identity
  aliasing, filename guessing, schema/input changes, policy exemptions or features.

Real proof: docs/experiments/fixture-migration/ and docs/fixture-migration.md.

- Actual historical source/lock/fixture Git SHA 59db63a7b895dcc5ca763e3c668990fec40850fb,
  SDK 21.7.7. Local cached origin/main has identical benchmark inputs; only a
  policy comment differs. Remote not refreshed; no claim about latest public main.
- Real Git clone/fetch/worktrees, official Stellar source builds for both revisions,
  RPC deployments/snapshot capture, native simulation, diff/reports/policies and
  bundled Action process exits. Forwarding observers save real IO, no substitutions.
- Unbridged path-to-ID transition: exit 1, no matched comparison, empty diff output.
- Historical to bridge: exit 0, one matched historical identity and one new stable
  contract. Existing report-only production policy unchanged. SDK upgrade CPU
  266778 -> 266842 (+64) stays visible; this is not a zero-regression claim.
- Bridge retirement: exit 0, stable ID pairs, temporary bridge is reported removed;
  strict CPU delta zero. Both source revisions now SDK 28.0.0.
- Temporary persistent-write regression: same stable identity, changed WASM/runtime
  address, CPU 266842 -> 309171 (+42329), strict policy reports violation, exit 1.
  Artificial regression exists only in temporary experiment source.
- Actual CLI logs show wasm32v1-none for both historical/modern source builds.
  Historical artifact 2a8c407a19d5a98d2371237783ab095c5b82ffee81633c9b7714aaad06701fd0
  was recovered from captured ledger data and verified against its build hash.
  Both bridge destinations contain control 718ba18378a2d94ec7bf0c75b3813c7d0bb5b65beb2fb4c445b3a4726ecd5668.
- Shared Cargo/helper caches recorded; no new clean-build claim. Source, WASMs,
  fixtures, exact temporary revision IDs, raw IO, reports, process outputs and
  producer/checksum snapshots saved. Private seed scan passed; network stopped.

Validation: npm ci PASS (existing 1 moderate/4 high audit findings); npm test
119/119 PASS; native tests 15/15 PASS; build/bundle PASS; package dry-run PASS
including migration docs (inclusion only); native format and tracked diff checks PASS.
Final full staged whitespace check reports trailing whitespace/blank EOF in raw
Node/TypeScript logs; these exact captured logs are preserved rather than altered.
Staged source/docs/evidence excluding raw .log files pass the whitespace check.
Experiment syntax checks PASS. No lint/typecheck scripts; TypeScript via gates.

Files changed: weighin-fixtures.json; new historical/stable test fixtures and
fixture-migration.test.cjs; contract-build.test.cjs; real migration harness and
forwarding observer/evidence; verify-build-path.cjs handles configured aliases;
verify-repeatability.cjs reports actual case counts; migration/build/identity/
native/repeatability docs; package.json doc inclusion and this progress record.
Production engine, contract source, README and root policy unchanged. Bundle
regenerated by its defined gate; earlier dirty work preserved.

Initial experiment proved the negative case, then failed creating a local origin
ref whose commit object had not been fetched. Saved in attempt-1; corrected to
fetch the temporary bridge ref into the isolated bare origin, rerun all four
scenarios passed. That first complete proof used a bundle whose hash differed
from the subsequent validated bundle; it is preserved under
attempt-2-prevalidation-bundle. A fresh-network rerun then failed on HEAD
Friendbot HTTP 502 before measurement, preserved under
attempt-3-friendbot-startup. The harness now probes real funding readiness and
requires the negative case to fail specifically for unmatched identity. All four
scenarios were rerun successfully with the exact validated current bundle
9e6ce6cab969424a4aac7596318bf9384ba65673552fdd89e488e4f9d8650f19.
Production startup is not repaired by this stage. Final historical artifact
extraction initially used LedgerEntry instead of the captured LedgerEntryData;
corrected decoder verified its build hash. A read-only cached-main comparison hit sandbox child-spawn EPERM;
elevated recheck passed. No fabricated metrics or skipped failures.

The user subsequently authorized local commits after each coherent change.
The accumulated approved foundation and migration were committed locally as
43de72ab53a8f7b8520b5a2e724aceed44703fc8 on branch test/no-op-baseline.
They share one commit because the migration requires the previously untracked
implementation, native helper, tests and evidence. All intended product/evidence
files are committed. Scratch files/local strategy instructions are excluded;
AGENTS.override.md, WEIGHIN_DRIPS_APPEAL_CONTEXT.md and scratch_test.js remain
untracked and preserved. Future coherent changes will receive local commits.
No push, issues, external changes or public CI proof. Temporary experiment Git
commits are isolated fixture history, not contributor/public activity.
Next: production network/Friendbot startup readiness, requiring separate stage
approval, followed by clean delivery and public flagship CI. Do not remove the
bridge against historical BASE or claim the campaign/appeal is complete.

Need three successful scenarios:

### Control

Equivalent benchmarked code.

Expected:
No unexplained resource regression.

### Intentional regression

Small deterministic contract change.

Expected:
Measurable resource increase.

### Threshold enforcement

Known regression exceeds configured policy.

Expected:
Report violation and CI failure.

---

## Stage 5B — Network and account readiness

Status: COMPLETE FOR THE PINNED LOCAL STANDALONE PATH — 2026-10-08

User approved this dependency and requested local commits after each coherent
change. No push/publication or subsequent stage is authorized.

Root causes verified against code and prior failure evidence:

- Startup accepted getNetwork metadata without RPC health or funding readiness.
- Account initialization made one untimed Friendbot request and waited a fixed
  three seconds instead of confirming inclusion.
- SDK 16.0.1 getAccountEntry masks all read errors as account-not-found.

Implemented the smallest shared readiness path:

- src/account.ts: raw account ledger read with key/type/address validation;
  genuine successful absence can trigger funding. Existing accounts skip it.
- Account readiness has a 120s elapsed deadline, up to 15s per HTTP request/body,
  two-second pauses and same-address retries. Only HTTP 429/500/502/503/504 and
  transport/timeouts retry. Permanent errors, invalid rows and JSON-RPC errors
  fail closed. Accepted funding is followed by read-only inclusion polling.
- src/measurement.ts: use confirmed account readiness instead of SDK catch-all
  plus untimed funding/fixed sleep. No schema, identity, metrics or policy changes.
- src/action.ts: require healthy getHealth plus valid network metadata.
- Production startup script waits for healthy RPC and funds/confirms a disposable
  account using the shared helper. Needs npm dependencies/TypeScript build first;
  sequential RPC/account phases each have a 120s deadline. No private probe seed
  is saved. Example external workflow polls getHealth; Action verifies its deployer.
- Behavior tests cover transient recovery, delayed inclusion, ambiguous funding,
  existing-account reuse, permanent errors, deadline exhaustion, invalid RPC and
  startup subprocess failure/success. Real account initialization failure in an
  Action subprocess yields fail/empty diff/exit 1 before measurement.

Live proof: docs/network-readiness.md and docs/experiments/network-readiness/live.

- Three distinct fresh pinned Docker sidecars; production startup on each.
- Every final trial naturally returned Friendbot 502 before 200: sequences were
  502/502/200, 502/200, 502/502/200. Same address recovered and RPC account
  inclusion confirmed before startup success.
- Each then ran the real bundled Action with real Git fetch/worktrees, modern
  source builds, deployment, native measurement, reports and strict CPU policy.
- Two logical identities matched each run; CPU deltas zero; Action exit 0.
- Raw HTTP/RPC/native IO, build logs, reports, container IDs and stops preserved.
  Shared Cargo/helper caches: no new clean-build or public CI claim.
- Temporary workspace overrides only the policy to strict CPU; production
  contract/fixture/policy are unchanged. All owned proof sidecars stopped.

Final validation: npm ci PASS; npm test 143/143 PASS; native tests 15/15 PASS;
build/bundle PASS; npm package dry-run PASS (inclusion only); startup/harness
syntax PASS; native formatting and tracked diff checks PASS. No lint/typecheck
scripts; build/bundle check TypeScript. Existing npm audit findings remain
1 moderate/4 high. Raw log whitespace is preserved and reported separately.
Final bundle/helper match the live proof; source/checksum evidence recorded.

Development findings: preliminary gates passed 138 tests before four startup tests
were added. An initial older replay mock intercepted SDK getAccount while new
account reads correctly used raw HTTP, accidentally reaching a missing local RPC;
updated the controlled mock and reran full tests. The first successful live
three-container proof is preserved in attempt-1-response-body-policy. Final review
found HTTP error classification should precede reading a possibly stalled body;
fixed header classification/body cancellation, added a stalled-403-body test,
and reran gates and all three fresh-container trials with the final bundle.
No fabricated live workaround.

Remaining risks: standalone/Linux x64/protocol 28 scope; this does not repair
underlying Friendbot/captive-core causes or guarantee later deployment/simulation
availability. Persistent/unknown failures remain fatal. The startup account phase
is a deadline per account, not an overall Action timeout. Public CI, a clean
checkout/install and external-project proof remain unverified. The historical
migration harness also currently derives historical revision from HEAD; after
local delivery commits, its reproduction needs an explicit fixed historical ref
in the upcoming clean-delivery review. Historical saved proof remains valid.

Local delivery commit: 488a4b987f0621084761df520108340ba416c4f3 on
test/no-op-baseline. Readiness implementation/tests/docs and exact live evidence
are committed. No push. Remaining untracked files are the preserved local
AGENTS.override.md, WEIGHIN_DRIPS_APPEAL_CONTEXT.md and scratch_test.js.

Next recommended dependency: clean-checkout/package verification, then public
flagship CI. Separate stage approval and explicit push authorization are required.

---

## Stage 5C — Clean checkout and package delivery

Status: COMPLETE FOR THE LOCAL PINNED ENVIRONMENT — 2026-10-08

Approved clean verification reproduced two delivery defects before repair:

- npm pack from a clean checkout with no dist omitted the declared CLI.
- package main dist/index.js had no source producer and still failed to load
  after a manual build. Baseline load exits 1; manifests/logs are preserved.
- The historical harness accidentally followed current HEAD after delivery
  commits, invalidating rerun identity assumptions. Saved old proof stays valid.

Minimal fixes committed as 0e8e894b669b89a73be59d25ae8862c61e03689c:

- package main points to existing dist/measurement.js; no new module API.
- prepack runs existing build and bundle commands. No source build during
  installation of the actual tarball; consumers need only production Node deps.
- Historical harness explicitly checks out fixed commit
  59db63a7b895dcc5ca763e3c668990fec40850fb before creating scenario history.
- Two behavior tests prove package module entry and CLI failure without output
  for missing fixtures. Relevant fixture reproduction wording corrected.

Evidence: docs/clean-delivery.md and docs/experiments/clean-delivery/completed.

- Fresh clone at the exact fix commit had no node_modules, dist, contract target
  or native target. npm ci, 145 tests, 15 native tests, build and bundle pass.
- Native gate builds from an empty target, 8m24s. Regenerated bundle equals Git.
- Actual tarball 423322 bytes, 23 files; module/bin/bundle/native source+lock
  included; no compiled native binary, runtime keys, tests or private context.
- A second fresh clone executes npm ci then npm pack with no manual build/dist;
  both entries are automatically created. Baseline/fixed manifests retained.
- Tarball installed in separate consumer with --omit=dev; TypeScript absent.
  Module loads; actual installed bin fails clearly/no result on missing fixture.
- Installed default helper provisioning builds its own empty target from shipped
  source/lock, no WEIGHIN_HELPER_PATH, no copied binary or compiled-object cache.
  Genuine frozen input replay output matches exactly.
- Fresh sidecar plus real installed CLI: two schema-4 rows, CPU 266842 each;
  captured native paths are the installed package's own executable. No fake IO.
- Clean checkout Action/historical harness uses real Git/worktrees/source builds,
  RPC/native measurements and reports. Fixed old SHA/SDK21.7.7 verified; exits
  1/0/0/1 for unbridged/bridge/strict control/regression. Upgrade delta +64,
  strict control 0, deterministic regression +42329 CPU and strict failure.
- Packed bundle/native source/lock equal executed checkout bytes. Actual installed
  CLI/helper directly executed; Action bundle directly executed from checkout.
- Owned sidecar stopped; tracked checkout clean, only generated tarball untracked.

Root gates also PASS: npm ci; 145 tests; 15 native tests; build/bundle;
package dry-run (now runs prepack); tracked diff check. New harness/observer syntax
passes. No lint/typecheck scripts; TypeScript through build/bundle. Existing npm
vulnerabilities remain 1 moderate/4 high. Raw logs keep their captured whitespace.

Files: package.json; package-entry behavior tests; historical harness/doc;
clean-delivery harness and forwarding observer; clean-delivery doc/evidence and
this progress record. No production measurement, identity, schema, policy,
contract source, native code or README changes. No push, issue or external change.

Limits: existing Rust/npm download caches/host tools reused, so this is not a
fresh-machine/offline install guarantee. Historical scenarios share the new
contract build cache. Cold native provisioning takes minutes and needs Rust,
dependency access and writable package target. Linux x64/protocol28/standalone;
three unavailable metrics and prior auth/random/archived limitations remain.
Public CI and external project proof are still pending. A final documentation
recording command had a Python quoting error before writing any files; corrected
and rerun. Production/runtime proof was unaffected.

Next dependency: public internal flagship CI proof, with separate stage approval.
Preparing a concrete change set does not authorize pushing or publishing it.

---

## Stage 6 — External project proof

Status: LOCAL FLAGSHIP PROOF VERIFIED; PUBLIC STRICT-ZERO ROLLOUT HELD — 2026-10-08

User confirmed permission to test Soroban Forge and approved proceeding. No
external push/PR/merge or new campaign stage was authorized. Local commits after
coherent changes remain authorized. Work is isolated from the older original
checkout on test/external-soroban-forge-proof, based on the hosted CI-passing
c32c0791f8991c54f2795d4f3b0c891063982e31.

Source: Meet-hybrid/soroban-forge at
07d7935234e9c86816116471121998b871b68439, real SDK 28.0.0 Cargo workspace.
Node24.13.1/Rust1.95.0/CLI28.1.0/wasm32v1-none, pinned Linux x64/protocol28
standalone network. Existing Cargo caches and verified prebuilt native helper
reused. Source/lock of the helper match the engine. No cold/five-clean-build claim.

The existing escrows_for_participant entrypoint benchmarks a fixed participant's
empty page, without auth or token setup. Explicit fixture/contract/case IDs are
stable in both revisions. The bounded regression adds eight redundant persistent
has calls only in local experiment history; fixture output stays identical.

Verified real Git fetch/worktrees, default optimized locked builds, deployment,
RPC/native measurement and parity, diff/report, and genuine Action status:
- Control: CPU 565371 -> 565371; all eight comparable metrics delta zero; exit 0.
- Report-only regression: CPU 565371 -> 679455 (+114084, 20.1786%); memory +5440;
  changed WASM/runtime IDs still paired; no policy violations; exit 0.
- Strict CPU rule: same resource regression, one reported violation; exit 1.
- Three unavailable metrics stay null with reasons. Raw IO, source/config inputs,
  WASMs, local revisions, reports/diffs, process exits and hashes are retained in
  docs/experiments/external-soroban-forge. Both owned sidecars were stopped.

New repeatability finding: original and relocated unchanged-source builds produce
optimized f6edc17c..., whereas all controlled Action BASE builds and a repeated
control produce 103874c7.... Both raw compiler outputs have identical hash
20f9c265..., 45889 bytes; optimized code differs by 8 bytes. A fresh live comparison
reports 565373 versus 565371 CPU (delta -2), same return XDR and seven other measured
metrics identical. Divergence is isolated to optimization; its exact environmental
cause remains unresolved. Strict zero tolerance can flag the reverse +2 change.
Do not hide this or mark general external reproducibility proven.

Prepared separate local external branches in the existing fork's delivery checkout:
- test/weighin-escrow-baseline / 5a9fde1: fixture, CPU policy, narrow usage doc.
- test/weighin-escrow-workflow / 44fd24f: read-only workflow pinned to verified
  WeighIn, toolchain/network, exact HEAD/BASE refs and retained JSON/Markdown.
The fixture must be merged into BASE before the workflow's first comparison.
Neither branch includes the artificial source regression. No push/PR was made.
This one empty-index fixture does not complete broader Forge issues #338/#348;
stateful settlement and public-network benchmarks remain outside the pilot.

Validation: npm ci PASS (current merged dependency tree reports 11 vulnerabilities:
5 moderate/4 high/2 critical); lint/typecheck PASS; npm test 157 Node +52 Vitest PASS;
build/bundle and tracked bundle equality PASS; 15 native assertions PASS using the
verified prebuilt helper; package dry-run PASS; fixture address and workflow YAML/
shell syntax PASS. External source fmt/locked metadata and selected WASM builds
PASS. Full external workspace tests, clippy/security/provenance jobs were not run
locally for these config/docs-only delivery branches; hosted external CI is pending.
No WeighIn production source, schema, native source, fixtures, policy or README
changes. Initial /tmp clone checkout/download hit quota/write failures; isolated
workspace filesystem succeeded. Exact executed bundle hash is recorded. Evidence review redacts two standalone
signing seeds from Docker startup logs; raw RPC/native evidence is unchanged.
Captured logs and email patches preserve their original whitespace.

Next: investigate pinned optimizer concurrency/context with identical raw input,
repeat candidate modes at least five times and check actual resource effects.
Establish a deterministic supported configuration or explicitly model/document
residual variation before strict-zero publication. Public baseline/workflow/
regression PR evidence then remains required. Stage 7 onward remains unstarted.

---

## Stage 6B — Optimizer storage investigation

Status: APPROVED INVESTIGATION COMPLETE — 2026-10-08

Identical raw input, official CLI28.1.0, unchanged external source and engine.
80 optimizer/full-build invocations: concurrency, input/output path variants,
full build variants, and changing only TMPDIR. Five constrained-system-temp runs
produce f6edc17c...; five healthy-workspace-temp runs produce 103874c7....
Five full builds per storage mode corroborate the effect; default and single
worker healthy builds agree. Cargo caches reused; no cold-build claim.

Bounded writes of 40912/45889/65536 bytes to system /tmp fail with EDQUOT and
leave zero-byte files; workspace writes complete. wasm-opt0.116.1 determines
convergence using temporary serialized module length. Early termination from
zero-length temp files is supported by source/probes, but syscall tracing was
unavailable (strace absent). The observed environmental dependency is isolated;
portable determinism and storage-failure robustness remain unproven.

Fresh protocol28 standalone: five live runs per distinct artifact, CPU565373
versus565371; seven other measured resources identical, all within-mode deltas
zero. Every deployed WASM/native CPU/raw RPC transaction and return parity
verified. All ten return XDR values identical; unavailable metrics remain null.
Owned sidecar stopped; its one startup seed redacted; private runtime key removed.
Evidence, verifier, checksum inventory and explanation are retained in
`docs/optimizer-repeatability.md` and `docs/experiments/optimizer-repeatability`.
No production source/bundle/schema/native changes, no policy relaxation, no
external delivery branch changes, no push/PR. External publication remains pending.

Validation: lint/typecheck PASS; default npm test FAIL (38 Node failures from
/tmp storage errors); rerun with healthy TMPDIR PASS (157 Node +52 Vitest).
Build/bundle, tracked bundle equality, verifier syntax and evidence checks PASS.
Dependency files and native source unchanged; npm ci/native suite not rerun.

Next proposed dependency: temporary-storage safeguard for the default build,
then five controls plus deliberate regression/threshold validation. Separate
stage approval required before implementing the safeguard.

---

## Stage 6C — Default-build temporary-storage safeguard

Status: IMPLEMENTED AND LOCALLY VERIFIED — 2026-10-08

User approved the focused storage safeguard and five end-to-end controls plus
regression/threshold reruns. Default builder supplies owned verified storage to
Stellar CLI via TMPDIR/TMP/TEMP, uses a >=1MiB write/fsync/close/read check before
building and before accepting output, and fails visibly on quota/truncation.
BASE and HEAD follow the same caller-selected temporary-root policy. No fallback,
policy relaxation, schema/native changes or new Action inputs. Custom/prebuilt
modes retain their documented caller-owned guarantees. Probe checks do not
reserve capacity or eliminate transient failures confined to optimization.

Five behavior tests added: two-revision isolation/environment preservation,
pre-build flush failure, truncated probe contents, post-build flush failure and
missing temporary root. Fresh-output protection and directory cleanup verified.
Existing 13 build tests and all five additions PASS. npm ci/lint/typecheck/test/
build/bundle/package dry-run PASS (162 Node +52 Vitest). 15 native assertions
PASS against the verified cached helper; native source/lock unchanged. Actual
system-temp storage failure is rejected visibly before optimization. Initial
proof assertion expected Node's message to contain quota, but Node24 reports
UNKNOWN for errno122; corrected diagnostic assertion verifies actual rejection.
Implementation commit2185c603312df25b87b80f825f8495befe10894e; executed bundle
104be8ef72ebc176986f577a4479d040be7684f4e1a9f5a4e0928eeee32591a0.

Five actual bundled-Action controls against isolated public Forge source07d7935
produce identical BASE/HEAD WASM103874c7 and CPU565371 in all runs; eight
measured metrics repeat without deltas. Report-only regression CPU565371->679455
(+114084), changed WASM/runtime IDs still paired, exit0. Strict CPU policy reports
one violation and genuine Action/harness exit1. All scenarios verify source builds,
Git/worktrees, deployed WASM, same returned XDR, raw RPC/native transaction parity,
and matched protocol/compute/resource settings. The full config hash changes with
the live network rolling state-size window; decoded config checks verify this is
the only changed setting, retained explicitly. No identical-full-snapshot claim.
No fake measurements. Cargo caches reused; no five-cold-build or portable claim.

Retained seven full scenario proofs, reports, source/config/WASM/raw IO, process
exits, checksums and validation logs. A separate verifier rechecks all seven.
Owned protocol28 sidecar stopped, one Docker startup seed redacted, private
experiment histories/deployer keys removed. Evidence docs updated for the followup.

Next dependency: approval to publish/review the local safeguard and evidence,
then hosted validation and the external baseline/workflow delivery sequence.
Do not call the campaign complete or Drips-approved. README/CONTRIBUTING stale
claims and stateful fixtures remain separate stages.
The external proof harness now records the actual engine Git SHA rather than
hardcoding the earlier c32 commit. No external branch changes/push/PR authorized.

---

## Stage 6D — Publish safeguard and verify hosted core CI

Status: PUBLISHED AND CORE CHECKS VERIFIED — 2026-10-08

User approved publishing the tested WeighIn work. Verified live PR1 exact head:
WeighInNG/WeighIn:test/no-op-baseline, c32c079 before push. Active mxrtins04 account
has push/admin access; an inactive Merge-ng credential is invalid, but the active
account is valid. Existing tested commits fast-forwarded the exact PR branch to
cc4e5a080f4fe47d3af6b1908bb082e30844f96a. No force push, new PR, merge or external
repository push. Both retained local proof verifiers passed again before push.

All seven PR checks PASS at cc4e5a0:
- WeighIn CI: https://github.com/WeighInNG/WeighIn/actions/runs/37771151293
- Flagship comparison proof (control/regression/threshold):
  https://github.com/WeighInNG/WeighIn/actions/runs/37771151245
- Example resource benchmark:
  https://github.com/WeighInNG/WeighIn/actions/runs/37771151242

Separate comment delivery: run37771545173 PASS, run37771643083 FAIL, both execute
main bcf9f042 rather than PR HEAD. Failed job downloads artifacts, then checkout
with its default clean behavior removes weighin-report.md; comment action errors
Report file not found. Prior run37753622388 had the same failure. This does not
invalidate generated benchmark artifacts/core checks, but full workflow health
is not green and the duplicate own-repository delivery path needs repair.

Live PR/run metadata and focused failed-job log retained under
`docs/experiments/published-storage-safeguard`. This progress/evidence follow-up
is a local tracking commit after publication; remote tested source remains cc4e5a0.
Next proposed stage: minimal comment-workflow report-preservation repair before
external hosted delivery. Separate stage approval; no automatic stage expansion.

---

## Stage 7 — Evidence and truth alignment

Status: NOT STARTED

Potential outputs:

- `docs/EVIDENCE.md`
- known limitations documentation
- reproducible demo instructions

Every major README claim should be linked to evidence.

Remove or correct stale claims.

Do not turn README into a Drips application.

---

## Stage 8 — Contributor backlog

Status: NOT STARTED

Classify issues into:

- foundation blocker;
- product expansion;
- protocol tracking;
- developer experience;
- obsolete/weak.

Foundation blockers should be solved before appeal.

Wave issues should expand an already-working foundation.

---

## Stage 9 — Red-team review

Status: NOT STARTED

Codex must try to reject WeighIn.

Only proceed if no BLOCKER issues remain.

---

## Stage 10 — Drips appeal

Status: NOT STARTED

Do not draft until the evidence exists.

Appeal must describe substantive changes since rejection and link each claim to public evidence.

Do not submit automatically.

---

# Operating rule for Codex

At the start of every session:

1. Read:
   - `AGENTS.override.md`
   - `WEIGHIN_DRIPS_APPEAL_CONTEXT.md`
   - `WEIGHIN_PROGRESS.md`

2. Inspect the actual repository.

3. Treat repository evidence as more authoritative than these planning documents.

4. Determine the single highest-priority unresolved dependency.

5. Explain:
   - what is wrong;
   - why it matters;
   - what you propose doing;
   - how success will be proven.

6. WAIT FOR USER APPROVAL.

7. After approval:
   - implement only that stage;
   - validate it;
   - do not hide failures;
   - do not broaden scope unnecessarily.

8. Update `WEIGHIN_PROGRESS.md` with:
   - findings;
   - implementation;
   - validation;
   - new blockers;
   - next recommended stage.

9. Then stop and ask whether to proceed.

Codex must not automatically progress through multiple major stages without approval.Es

## Stage 5D — Public internal flagship CI preparation

Status: PUBLIC HOSTED PROOF PASSED; PR #1 CONFLICT RESOLVED — 2026-10-08

Existing CI has no retained control/intentional-regression/threshold-failure proof.
Added a separate read-only-permissions workflow with three isolated modern
reference scenarios. Production engine, fixtures, contract and policy unchanged.
Real bundled Action child exits are preserved; only the expected threshold step
uses continue-on-error, followed by a required verified-policy/outcome check.
Missing comparison or infrastructure errors cannot establish expected failure.
Artifacts contain sources, WASMs, raw RPC/native IO, diffs/reports, exits and hashes;
private deployer directories are excluded. No GitHub comment token is passed.

Nine new behavior tests use saved schema-4 live results and real policy/report
functions; they reject wrong exits, unmatched identities, unchanged WASM/address,
unavailable CPU, control noise and invalid reports. Initial tests accidentally
selected historical two-metric schema-3 evidence; corrected to schema 4, all nine
pass. Sandbox child-process restrictions produced an initial no-assertion failure;
authorized execution ran actual assertions. No fabricated live measurements.

Root validation before conflict resolution: npm ci PASS; npm test 154/154 PASS; native 15/15 PASS;
build/bundle/package dry-run and native format PASS. Existing audit findings
remain 1 moderate/4 high. YAML parsing, all workflow bash blocks and producer
JavaScript syntax pass. Node 24.21.0 provisioned temporarily to match Action runtime;
runtime-specific/live validation follows. Public workflow execution remains
unproven until the refreshed PR branch completes an actual hosted run.

Final local proof: docs/experiments/flagship-ci/completed, producer commit
398d32d5b808f2b1e4efb3fefa0726354e873e25, exact source/observer/workflow hashes
and bundle/helper hashes retained per scenario. Node 24.21.0 directly executes
all real bundled Action children. Real Git fetch/worktrees, locked optimized
SDK28 source builds, RPC/native capture and reports; no response substitution.

- Control: both current identities match; all eight measured deltas zero;
  CPU 266842 -> 266842; strict CPU policy, exit 0.
- Report-only intentional write: both identities match; CPU 266842 -> 309171
  (+42329), write bytes 0 -> 88; zero configured violations, exit 0.
- Same intentional write with strict CPU policy: both identities match, changed
  WASM/runtime addresses, +42329 CPU; two CPU violations (temporary duplicate
  bridge declarations), genuine Action/harness exit 1 with verified marker.
- BASE and HEAD WASMs recovered from actual artifact/captured ledger state;
  unchanged control 776 bytes, regression 871 bytes. Raw RPC/native parity checks
  pass. Eight measured metrics, three explicitly unavailable; no hidden zeros.
- New fresh pinned network readiness recovered from two real Friendbot 502s;
  funded account included before scenarios. Owned container stop exit 0.
- All 169 Node/native assertions also PASS under Node24; root gate logs retained.
  Local live scenarios reuse prior Cargo artifact cache and prebuilt native helper;
  this is not another cold build, package install or five-run repeatability claim.

Hosted run on resolved PR head 6bfee071cf3b16e624138f67b3e794af092b0545:
- WeighIn CI: lint/typecheck/test, bundle freshness, native helper, build and
  benchmark job all passed ([run 37752155821](https://github.com/WeighInNG/WeighIn/actions/runs/37752155821)).
- WeighIn Benchmark: pinned standalone network, same-repository Action, and
  report artifact all passed ([run 37752155913](https://github.com/WeighInNG/WeighIn/actions/runs/37752155913)).
- Flagship comparison proof: control, regression, and threshold jobs all passed
  ([run 37752155835](https://github.com/WeighInNG/WeighIn/actions/runs/37752155835)). Public artifacts contain source revisions, WASMs, SHA256s,
  RPC/native evidence, reports, Action outputs and verification records.
- Hosted control CPU: 266842 -> 266842 (delta 0), Action exit 0.
- Hosted intentional regression CPU: 266842 -> 309171 (delta +42329), changed
  WASM hashes and runtime IDs, same logical benchmarks; report-only Action exit 0.
- Hosted strict-threshold scenario reports the +42329 CPU violations and Action
  exit 1. The verifier confirms this is the genuine policy failure.
- PR #1 is CLEAN and MERGEABLE at check time. No merge was performed.

The ordinary benchmark report also shows an added explicit fixture identity that
has no BASE counterpart, alongside a path-derived benchmark that pairs across
revisions. The report labels the addition; the live flagship proof independently
verifies both stable identity forms. This is a fixture difference in the current
project example, not a comparison failure.

Implementation and final evidence/self-check alignment are committed as
398d32d5b808f2b1e4efb3fefa0726354e873e25 and
fbfd2096390484341a26e510f3e59fe97e782f92. The latter is pushed and verified at
the current repository location. README and architecture documentation were truth-aligned during conflict
resolution; production benchmark fixtures and policy were not changed for this
integration. Preserved scratch/local context files untracked. No issue creation or appeal submission.
PR #1 is being reconciled against main at bcf9f042f27400a9139af820855deb541e785cc9.
Merged additions retain the Stage 5D Action behavior, CI gates, report artifacts, and
fork-safe comment workflow; stale build and RPC expectations were replaced. Local npm
tests (157 Node + 52 Vitest), lint, typecheck, build, bundle, package dry-run, and
native helper tests (15) pass. The configured /tmp native build first hit disk quota;
rerunning from the workspace filesystem passed. Hosted proof artifacts and checks
are now verified at the links above. External project proof, final truth alignment,
issue triage, red-team review and appeal preparation remain afterward. Do not claim campaign
complete or Drips approval.
