# Policy and package provenance

## Trusted regression policy

By default, the action reads `config-path` from the checked-out HEAD workspace.
That is a convenience mode, not a security boundary: a pull request can change
that file and thereby change the rules used to evaluate itself.

For a policy that must not be selected by HEAD, set both `trusted-policy-ref`
and `trusted-policy-path`. The action fetches the ref from the configured
`origin`, resolves it to the exact `FETCH_HEAD` commit SHA, and reads exactly
the requested repository path with `git show`. A missing, empty, unresolvable,
or invalid policy fails before measurement. The report records the mode, path,
resolved SHA, and SHA-256 of the policy bytes. HEAD fixtures and metadata cannot
replace that source.

Selecting policy from BASE or another trusted revision does not sandbox the
untrusted pull-request build. Do not place secrets in a workflow that executes
untrusted PR code; this feature is policy ownership, not a general PR sandbox
and does not justify `pull_request_target` secret access.

## Package provenance

`npm run bundle` creates `provenance-manifest.json`, a deterministic manifest
covering package metadata, lockfiles, action metadata, TypeScript sources,
native helper sources, and both generated bundles. Git HEAD and local Node/npm
versions are excluded: HEAD changes when the manifest is committed, and runtime
versions vary between a local build and CI without changing these inputs.
Record those observations separately in build or experiment receipts.
`npm run provenance` independently recomputes every listed digest. A stale
bundle, changed lockfile, missing helper source, or altered package input fails
verification.

The manifest is evidence, not a signature. A release system should sign this
manifest or attach it using the platform's standard artifact-attestation
mechanism (for example GitHub artifact attestations with least-privilege OIDC
permissions). This repository does not publish releases or hold release
credentials automatically.
