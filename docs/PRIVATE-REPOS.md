# Private GitHub Repositories

WeighIn supports private GitHub repositories and GitHub Enterprise organizations. The minimum token permissions depend on whether the workflow posts a PR comment or only produces benchmark artifacts.

## Minimal GitHub Actions permissions

For the producer workflow, grant read access to repository contents:

```yaml
permissions:
  contents: read
```

If the benchmark workflow posts a PR comment directly, it must also have permission to write pull requests:

```yaml
permissions:
  contents: read
  pull-requests: write
```

The `GITHUB_TOKEN` provided by GitHub Actions is repository-scoped. Prefer the fork-safe split workflow documented in the main setup: benchmark PR code with `contents: read`, then post the comment from a trusted default-branch workflow using `pull-requests: write`.

Do not add `organization: write`, `administration: write`, or other broad permissions unless a separate operational requirement explicitly needs them.

## PAT requirements

A fine-grained personal access token used for direct PR comment publishing must have:

- **Repository access:** only the private repositories that run WeighIn
- **Contents:** read-only
- **Pull requests:** read and write
- **Metadata:** read-only, included automatically

Store the PAT as a GitHub Actions secret and pass it only to the trusted comment workflow. Rotate it according to organization policy and never commit it to the repository.

Classic PATs can use `repo` scope for private repositories, but this grants broader access than needed. Fine-grained repository permissions are preferred where your GitHub Enterprise or organization supports them.

For a split workflow, pass a PAT only to the trusted comment stage. The producer that checks out and builds untrusted PR code should continue to use `GITHUB_TOKEN` with read-only content access.

## Private enterprise and organization configuration

In private organization repositories:

1. Confirm that GitHub Actions is enabled for the repository or organization.
2. Confirm that a private action, reusable workflow, or pinned WeighIn revision is permitted under organization policies.
3. Grant Actions read access to the organization or repository as required by policy.
4. Grant the comment workflow `pull-requests: write` and `contents: read`.
5. If repository rules restrict PAT or GitHub App creation, use an approved service account or GitHub App with the same minimum permissions.

GitHub Enterprise Server may expose a private API and require organization-specific runner certificates or network policy. WeighIn also needs access to the repository and any private RPC endpoint used for simulation.

## Fork workflows

Fork pull requests have a restricted `GITHUB_TOKEN`:

- Read-only repository access is normally available.
- Pull-request write permissions are not available for secrets and write-capable tokens.
- Secrets are not exposed to forked PR branches.

Use the two-workflow pattern:

1. The **producer** runs from the pull request and writes the report and PR metadata to a workflow artifact.
2. A **trusted consumer** runs from the base branch, downloads the artifact, and re-validates repository, PR number, and head SHA before posting or updating the comment.

This prevents a fork PR from gaining a write token or directly changing repository comments.

## Troubleshooting

### 403 Resource not accessible by integration

- Verify `permissions` includes `pull-requests: write` for direct comment workflows.
- Verify that organization policy allows write permissions for Actions.
- Verify the comment workflow is running from a trusted context rather than forked PR code.

### Private repository contents cannot be checked out

- Verify `permissions` includes `contents: read`.
- For a PAT, verify repository access and Contents read permission.
- Confirm the checkout organization and repository policies allow Actions runners.

### Comment is missing on fork PRs

- Do not rely on direct comment posting from the fork producer.
- Add the trusted base-branch comment workflow and artifact metadata contract.
- Confirm the artifact is uploaded by a successful producer workflow.

### PAT works locally but not in Actions

- Confirm the secret name and expression are correct.
- Confirm the repository has not disabled Actions secrets or PAT use.
- Confirm fine-grained token repository access includes the base repository.
- Regenerate and update the secret if the token expired or was revoked.

### Branch protection cannot see the status

- Confirm the producer check runs on pull requests from forks and on the base branch.
- Use the exact status check name shown by Actions in branch protection settings.
- Avoid broad path filters that can skip the required check for protected source changes.
