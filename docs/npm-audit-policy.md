# npm audit policy

This document describes the `npm audit` gate added to the `lint-and-test` CI
job.

## Placement and command

The gate runs immediately after `npm ci` in `lint-and-test`, before lint,
typecheck, and tests:

```yaml
- name: npm audit (moderate+ advisory gate)
  run: |
    npm audit --audit-level=moderate --json > npm-audit.json
    EXIT=$?
    exit $EXIT
```

## Severity threshold

`--audit-level=moderate` causes npm to exit nonzero for **moderate, high, and
critical** severities. Low and informational advisories do not fail the job.
This threshold matches the minimum recommended for CI gates in npm's own
documentation.

## Dev-dependency inclusion

No `--omit=dev` flag is passed. All packages installed by `npm ci` —
including `devDependencies` — are scanned. Rationale: dev packages (build
tooling, test runners, type checkers) execute on every CI runner and every
contributor machine. A vulnerability in `vitest` or `esbuild` is a real
exposure on those surfaces even though it is not shipped in the production
bundle.

## Exit-code propagation

The step captures JSON output to `npm-audit.json` before inspecting the exit
code:

```bash
npm audit --audit-level=moderate --json > npm-audit.json
EXIT=$?
exit $EXIT
```

`EXIT=$?` captures npm's actual exit code after the redirect. `exit $EXIT`
re-raises it so the CI step fails. There is no `|| true`, no fallback to an
empty report, and no swallowed nonzero exit. This means:

| npm outcome | Exit code | Job result |
|---|---|---|
| No advisories at or above threshold | 0 | ✅ passes |
| Moderate/high/critical advisory found | 1 | ❌ fails |
| Registry unreachable / network error | 1+ | ❌ fails |
| Malformed or truncated response | 1+ | ❌ fails |

## Retained artifact

The `Upload audit report` step runs with `if: always()`, so `npm-audit.json`
is uploaded regardless of whether the audit passed or failed. This allows
post-run diagnosis without re-running the job. The file contains only advisory
metadata produced by npm; no registry authentication tokens, `.npmrc`
contents, or credentials are written into it.

## What this step does NOT do

- Does **not** run `npm audit fix`.
- Does **not** change any dependency versions.
- Does **not** allowlist or suppress any advisories.
- Does **not** modify `.npmrc` or any registry configuration.

## Advisory remediation

Because the gate is blocking and never changes versions itself, an advisory is
cleared by a separate, deliberate dependency change: update the lockfile within
the declared range or deliberately bump an exact dependency pin to a patched
version. Regenerate the CycloneDX inventory (`npm run inventory:generate`) and
commit the matching `docs/dependency-inventory.json`. The regenerated inventory
has to cover the new locked version, so the Cargo 1.95.0 toolchain and the
locked native helper crates have to be available when it is generated.

The October 22 remediation updates the exact Vitest pin from `4.1.11` to
`4.1.12`, including its matching `@vitest/mocker`, for
[GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and
[GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
The moderate+ threshold, dev-dependency coverage and retained report remain unchanged.

## Zod 3 to 4 remediation (GHSA-mrhx-c7xc-m3w5)

[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
(CVE-2023-54404, High, CVSS v4 8.2) affects `zod` below `4.6.6`: an array
schema without a length constraint lets a large input exhaust memory through
`$ZodArray` issue accumulation. Every 3.x release is affected and the advisory
has no 3.x fix, so the gate could not be cleared inside the `3.25.76` range.
`npm audit` reports `zod@4.6.7` as the fix (a semver-major change).

The remediation is therefore a deliberate major change in `package.json`, not a
lockfile-only update. `zod` is pinned exactly to `4.6.7`. The gate is unchanged:
no allowlist, suppression, `npm audit fix`, or downgrade is used, and no array
length limits were added. The regenerated `package-lock.json` and
`docs/dependency-inventory.json` come from `npm run inventory:generate`.

Migration is API-level only. Enum-keyed records use `z.partialRecord` because
Zod 4 `z.record` with an enum key requires every key, and metric keys are
optional. The `value` field of `InvocationArgSchema` stays optional
(`z.any().optional()`) because Zod 4 requires `z.any()` keys at parse time.
Optionality and partial metric policies remain unchanged. Zod 4's deep-imported
numeric configuration schemas now reject `Infinity`; the live Action policy
already required finite numbers. Omit a limit to leave that metric unbounded.
Validator wording may change; diagnostic paths and custom messages are preserved.

## Undici 6.x remediation

The October 23 audit also identified
[GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) and
[GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c).
The lockfile resolves transitive `undici` to `6.29.1`, within the existing
`^6.23.0` constraints of `@actions/github` and `@actions/http-client`.
This needs no new direct dependency or override. The audit threshold and
failure propagation remain unchanged.

## Distinction from native and image security

This step covers only the **npm lock graph** (`package-lock.json`). It does
not scan:

- The **Cargo lock graph** (`native/simulation/Cargo.lock`) for the Linux
  x64 simulation helper. Cargo advisories are a separate ecosystem and require
  tools such as `cargo audit`. This is noted in the dependency inventory
  documentation and is explicitly out of scope for this issue.

- **Container images or operating-system packages.** The `ubuntu-latest`
  runner image is managed by GitHub and is separate from the Node/npm
  dependency surface.

The CycloneDX dependency inventory (`docs/dependency-inventory.json`) records
all npm and Cargo locked components as a reproducible component inventory. It
is not vulnerability clearance, as noted in `docs/DEPENDENCY_SECURITY.md`.

## Tests

`test/npm-audit-policy.test.ts` contains unit tests for the two pure helpers
in `src/audit-policy.ts`:

| Fixture label | What it represents |
|---|---|
| `clean-audit` | Zero vulnerabilities, npm exits 0 |
| `advisory-present` | One moderate advisory, npm exits 1 |
| `service-failure` | Registry unreachable (`ENOTFOUND`), npm exits nonzero |

These tests verify the policy helpers and document exit-propagation
expectations. They do not make live npm calls. The actual live audit result is
the `npm-audit.json` artifact retained by each CI run of this repository.
