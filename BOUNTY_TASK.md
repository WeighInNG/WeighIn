# Bounty Objective: Allow configurable local sidecar names and ports for concurrent runs
Target: WeighInNG/WeighIn Issue #217
URL: https://github.com/WeighInNG/WeighIn/issues/217

## Issue Description
## Problem

The helper script hardcodes one name and host port, preventing independent local proof runs from coexisting.

## Current repository evidence

- [scripts/start-local-network.sh:1](https://github.com/WeighInNG/WeighIn/blob/f679238a096b49df0edfaf7d02d5bfa2dfd6be8f/scripts/start-local-network.sh#L1) — `reviewed file`; file SHA256 `f76a96c1887f48d08062a511f11cdf250afb3d41a76b4ad889fa37a5e98c39a0`.
- [scripts/wait-for-local-network.cjs:1](https://github.com/WeighInNG/WeighIn/blob/f679238a096b49df0edfaf7d02d5bfa2dfd6be8f/scripts/wait-for-local-network.cjs#L1) — `reviewed file`; file SHA256 `4fd8139cf6cbf90f26704e4be7e6c241176e73a41bfca15bb6bfba2d831a5042`.

## Acceptance criteria

- [ ] Add validated optional name/port parameters with existing defaults.
- [ ] construct readiness and reported RPC URLs consistently.
- [ ] two isolated sidecars can start and be addressed without crossing ownership or state.
- [ ] Include behavior tests for success and invalid/failure cases in the same implementation PR.
- [ ] Update affected public documentation and generated bundles together with the implementation; do not file separate tickets for those required follow-ups.

## Scope and coordination

Preserve the supported standalone/protocol-28 environment, fail-closed comparison behavior and existing metric semantics. Include behavior tests, compatibility documentation and affected bundles within this issue; do not split them into extra bounties.

Nearby work: See area/dependency audit; no separately owned implementation follow-up.. Resolve shared-file editing order before concurrent assignments. Dependencies mean future implementation completion, not merely publishing the dependency issue.

## Validation

Existing behavior-test anchors: `tests/network-startup.test.cjs`.
For runtime changes run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run bundle`, and `git diff --check`. Add native replay and a controlled real-network proof when host/protocol/state/resource semantics change. Workflow changes require hosted validation at the actual candidate SHA. For an experiment, preserve raw captures, exact inputs, environment, exits and checksums; never treat infrastructure failure as expected policy proof.

<!-- weighin-backlog:J15 -->

## Instructions for Kuro (Autonomous Solver):
1. Use skills: `systematic-debugging` and `code-review-and-quality`.
2. Inspect the repository structure, locate relevant files, and understand the bug/feature.
3. Apply the minimal, robust fix or implementation.
4. Run any existing test suites or linters in the workspace.
5. Ensure the fix adheres to the project's existing code style.
6. When done, output a summary of files modified and verification results.
