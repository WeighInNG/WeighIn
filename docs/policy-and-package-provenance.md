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
native helper sources, and both generated bundles. It also records the source
commit and Node/npm identities of the checkout that wrote it; those build-time
identities are evidence about that checkout and are not compared, because no
other checkout can reproduce them. `npm run provenance` independently recomputes
and verifies every listed input digest from a clean checkout. A stale bundle,
changed lockfile, missing helper source, or altered package input fails
verification. CI verifies the committed digests first, rebuilds, and then
requires a clean tree apart from the build-time identity fields that the rebuild
rewrites.

The manifest is evidence, not a signature. A release system should sign this
manifest or attach it using the platform's standard artifact-attestation
mechanism (for example GitHub artifact attestations with least-privilege OIDC
permissions). This repository does not publish releases or hold release
credentials automatically.
