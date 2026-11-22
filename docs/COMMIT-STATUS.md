# Commit Status Checks and Branch Protection

WeighIn can act as a required pull-request gate by failing the benchmark Action when configured thresholds are exceeded. A failed WeighIn run can then be reported as a failed Commit Status and can be selected as a required status check in GitHub branch protection.

A successful status means the benchmark policy passed or report-only behavior was intentionally configured. A failed status means a required comparison or threshold policy failed.

## Enforce a regression policy

Enable global regression enforcement in `weighin.toml`:

```toml
[thresholds.global]
fail_on_any_regression = true
```

The exact TOML key used by this repository is `fail_on_any_regression`. If documentation or automation refers to `fail-on-regression: true`, treat that as the equivalent human-facing setting and keep the TOML key above in the configuration file.

You can also enforce stricter per-function or per-metric rules:

```toml
[thresholds.functions.hello]
cpu_instructions = "strict_zero_tolerance"
memory_bytes = "allow_10_percent_increase"
ledger_write_bytes = "strict_zero_tolerance"
```

See the threshold behavior and supported rule values in [the configuration guide](../README.md#quick-start) before using a policy that may block merges.

## Configure the workflow

The benchmark workflow must set the configuration path and exit with an error when the result is `fail`:

```yaml
- name: Run WeighIn
  id: weighin
  uses: WeighInNG/WeighIn@REVIEWED_COMMIT_SHA
  continue-on-error: true
  with:
    fixtures-path: weighin-fixtures.json
    config-path: weighin.toml
    rpc-url: http://localhost:8000/rpc

- name: Require passing benchmark policy
  if: steps.weighin.outputs.result != 'pass'
  run: exit 1
```

This final step publishes a failed GitHub Actions job status. Pin the Action to an immutable reviewed commit rather than a branch tag.

## Add a required status check

1. Open **Settings → Branches** for the repository.
2. Add or edit a branch protection rule for `main` or your release branch.
3. Enable **Require status checks to pass before merging**.
4. Select the exact GitHub Actions check that runs the benchmark and exits non-zero, such as `weighin` or `benchmark / WeighIn`.
5. Optionally enable **Require branches to be up to date before merging** so a PR is checked against the latest base state.

The status check must run on every relevant pull request and must not be skipped by path filters that leave protected files untested.

## PR comments alongside commit status

Commit status checks and PR comments are separate outputs:

- A producer workflow runs benchmarks and writes an exit result and report artifact.
- Branch protection requires the producer check to pass.
- The optional fork-safe comment workflow posts the report from a trusted default-branch workflow.

This split keeps untrusted PR code from receiving a write token. See [the PR comment metadata contract](../README.md#pr-comment-metadata-contract) for the trust boundaries.

## Verify the gate

Create a test PR that deliberately increases a configured resource:

1. Confirm the benchmark Action returns `result: fail`.
2. Confirm the final enforcement step exits with status 1.
3. Confirm the selected status check appears on the PR and is red.
4. Confirm GitHub blocks merge until the check passes or the branch protection rule is changed.

Do not mark an unavailable required metric or an invalid policy as passing; these states should remain failures rather than bypassing branch protection.
