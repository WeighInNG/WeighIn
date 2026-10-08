import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { runMeasurement, ContractBenchmark } from "./measurement";
import { diffBenchmarks, DiffResult, contractLabel } from "./diff";
import { loadConfig, enforceThresholds, Violation } from "./threshold";
import { renderComment } from "./comment";
import { buildForRevision } from "./build-selection";
import { writeReportFile } from "./report";

// ---------------------------------------------------------------------------
// RPC health check
// ---------------------------------------------------------------------------

/**
 * Verify that the RPC endpoint is reachable and responding to getHealth and getNetwork.
 * Fails the action with a clear message if not — the caller is responsible
 * for starting the network before invoking this action.
 */
async function assertRpcHealthy(rpcUrl: string): Promise<void> {
  core.info(`Checking RPC health at ${rpcUrl} ...`);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as any;
    if (json.error) {
      throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    }
    if (json.result?.status !== "healthy")
      throw new Error("RPC has not reported healthy");
    const network = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getNetwork" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!network.ok)
      throw new Error(`HTTP ${network.status} ${network.statusText}`);
    const metadata = (await network.json()) as any;
    if (
      metadata.error ||
      typeof metadata.result?.passphrase !== "string" ||
      !metadata.result.passphrase.trim()
    ) {
      throw new Error("Invalid RPC network metadata");
    }
    core.info(`RPC healthy — network: ${metadata.result.passphrase}`);
  } catch (err: any) {
    core.setFailed(
      `Soroban RPC at ${rpcUrl} is not reachable: ${err.message}\n` +
        `Start the network before invoking this action (e.g. via stellar/quickstart ` +
        `or scripts/start-local-network.sh), then pass its URL as the rpc-url input.`,
    );
    throw err; // halt execution
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and capture stdout. Throws on non-zero exit. */
async function capture(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  let out = "";
  await exec.exec(cmd, args, {
    cwd,
    listeners: {
      stdout: (d: Buffer) => {
        out += d.toString();
      },
    },
    silent: true,
  });
  return out.trim();
}

/** Get HEAD SHA in the given directory. */
async function getHeadSha(dir: string): Promise<string> {
  try {
    return await capture("git", ["rev-parse", "HEAD"], dir);
  } catch {
    return "unknown";
  }
}

/** Read soroban-sdk version from Cargo.lock (best-effort). */
function getSdkVersion(repoDir: string): string {
  // Try common locations: repo root Cargo.lock, or contract/Cargo.lock
  for (const rel of ["Cargo.lock", "contract/Cargo.lock"]) {
    const lockPath = path.join(repoDir, rel);
    try {
      if (fs.existsSync(lockPath)) {
        const lock = fs.readFileSync(lockPath, "utf8");
        const m = lock.match(/name = "soroban-sdk"\nversion = "([^"]+)"/);
        if (m) return m[1];
      }
    } catch {
      /* ignore */
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Two-directory checkout
// ---------------------------------------------------------------------------

/**
 * Check out a git ref into a fresh temporary directory using a bare clone
 * of the repository that is already checked out at repoRoot.
 *
 * Returns the path to the new directory and the resolved SHA.
 */
async function checkoutRef(
  repoRoot: string,
  ref: string,
  label: string,
): Promise<{ dir: string; sha: string }> {
  // Fetch the ref into the existing repo's object store, then use
  // git worktree add to get a clean directory without touching the
  // main workspace.
  await exec.exec("git", ["fetch", "--depth=1", "origin", ref], {
    cwd: repoRoot,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `weighin-${label}-`));
  core.info(`Checking out ${ref} into ${dir}`);
  try {
    await exec.exec("git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"], {
      cwd: repoRoot,
    });
  } catch (error) {
    await removeWorktree(repoRoot, dir);
    throw error;
  }

  const sha = await getHeadSha(dir);
  core.info(`${label} SHA: ${sha}`);
  return { dir, sha };
}

/** Remove a worktree directory created by checkoutRef. */
async function removeWorktree(repoRoot: string, dir: string): Promise<void> {
  try {
    await exec.exec("git", ["worktree", "remove", "--force", dir], {
      cwd: repoRoot,
    });
  } catch {
    // Non-fatal; runner will clean up temp dirs anyway
    core.warning(`Could not remove git worktree at ${dir}`);
  }
}

// ---------------------------------------------------------------------------
// PR comment management
// ---------------------------------------------------------------------------

const COMMENT_MARKER = "<!-- weighin-report -->";

async function upsertPrComment(token: string, body: string): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    core.warning("Not in a pull_request context; skipping PR comment.");
    return;
  }

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find((c: { id: number; body?: string | null }) =>
    c.body?.includes(COMMENT_MARKER),
  );

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated PR comment #${existing.id}`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info("Created new PR comment");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const fixturesPathRel = core.getInput("fixtures-path", { required: true });
  const configPathRel = core.getInput("config-path");
  const rpcUrl = core.getInput("rpc-url") || "http://localhost:8000/rpc";
  const githubToken = core.getInput("github-token");
  const baseRefInput = core.getInput("base-ref");
  const rustToolchain = core.getInput("rust-toolchain");
  const reportPathInput = core.getInput("report-path");
  const metadataPathInput = core.getInput("metadata-path");
  const buildCommand = core.getInput("build-command");
  const skipBuild = core.getInput("skip-build") === "true";

  // The runner's checkout of the PR head is at GITHUB_WORKSPACE
  const headWorkspace = process.env["GITHUB_WORKSPACE"] ?? process.cwd();

  const baseRef =
    baseRefInput || github.context.payload.pull_request?.base?.ref || "main";

  // Key file lives outside either worktree so both measurements share it
  const sharedKeyFile = path.join(os.tmpdir(), "weighin-deployer.key");

  core.info(`Base ref:   ${baseRef}`);
  core.info(`RPC URL:    ${rpcUrl}`);
  core.info(`Fixtures:   ${fixturesPathRel}`);
  core.info(`Key file:   ${sharedKeyFile}`);

  // 1. RPC health check — fail fast with a clear message
  await assertRpcHealthy(rpcUrl);

  // 2. Resolve paths from the HEAD workspace (fixtures, config live there)
  const headFixturesPath = path.resolve(headWorkspace, fixturesPathRel);
  const fixtureId = path.relative(headWorkspace, headFixturesPath);
  const configPath = path.resolve(
    headWorkspace,
    configPathRel || "weighin.toml",
  );
  const config = loadConfig(configPath);

  if (!fs.existsSync(headFixturesPath)) {
    throw new Error(`fixtures-path not found: ${headFixturesPath}`);
  }

  // 3. Measure HEAD (the PR branch — already checked out at headWorkspace)
  core.startGroup("Building + measuring HEAD");
  const headSha = await getHeadSha(headWorkspace);
  core.info(`HEAD SHA: ${headSha}`);

  let headResults: ContractBenchmark[];
  try {
    await buildForRevision(
      headFixturesPath,
      headWorkspace,
      rustToolchain,
      buildCommand,
      skipBuild,
    );
    headResults = await runMeasurement({
      fixturesPath: headFixturesPath,
      fixtureId,
      gitCommit: headSha,
      sdkVersion: getSdkVersion(headWorkspace),
      rpcUrl,
      keyFile: sharedKeyFile,
    });
  } catch (err: any) {
    throw new Error(`HEAD measurement failed: ${err.message}`);
  } finally {
    core.endGroup();
  }

  // Log WASM hashes from HEAD for the determinism audit trail
  for (const contract of headResults) {
    for (const bench of contract.benchmarks) {
      core.info(
        `[HEAD] WASM SHA256 (${bench.function_name}): ${bench.wasm_sha256}`,
      );
    }
  }

  // 4. Check out base ref into a separate worktree — never touch headWorkspace
  core.startGroup(`Building + measuring base (${baseRef})`);
  let baseResults: ContractBenchmark[] | null = null;
  let baseDir: string | null = null;
  let baseSha = "unknown";

  try {
    const checkout = await checkoutRef(headWorkspace, baseRef, "base");
    baseDir = checkout.dir;
    baseSha = checkout.sha;

    // The fixtures file in the base worktree — same relative path
    const baseFixturesPath = path.resolve(baseDir, fixturesPathRel);
    if (!fs.existsSync(baseFixturesPath)) {
      throw new Error("fixtures-path not found in base ref");
    } else {
      await buildForRevision(
        baseFixturesPath,
        baseDir,
        rustToolchain,
        buildCommand,
        skipBuild,
      );
      baseResults = await runMeasurement({
        fixturesPath: baseFixturesPath,
        fixtureId,
        gitCommit: baseSha,
        sdkVersion: getSdkVersion(baseDir),
        rpcUrl,
        keyFile: sharedKeyFile,
      });

      // Log WASM hashes from base
      for (const contract of baseResults) {
        for (const bench of contract.benchmarks) {
          core.info(
            `[BASE] WASM SHA256 (${bench.function_name}): ${bench.wasm_sha256}`,
          );
        }
      }
    }
  } catch (err: any) {
    throw new Error(
      `Required BASE comparison failed: ${err.message}. Policies were not evaluated.`,
    );
  } finally {
    if (baseDir) await removeWorktree(headWorkspace, baseDir);
    core.endGroup();
  }

  if (!baseResults)
    throw new Error(
      "Required BASE comparison unavailable. Policies were not evaluated.",
    );

  // 6. Diff
  core.startGroup("Computing diff");
  const diff: DiffResult = diffBenchmarks(baseResults, headResults);
  if (!diff.contracts.some((contract) => contract.functions.length > 0)) {
    throw new Error(
      "No matched BASE/HEAD benchmarks; comparison and policies were not evaluated.",
    );
  }
  core.info(`Any regression: ${diff.hasRegression}`);
  core.endGroup();

  // 7. Threshold enforcement
  core.startGroup("Enforcing thresholds");
  if (config) {
    core.info("weighin.toml loaded");
  } else {
    core.info("No weighin.toml found — no thresholds enforced");
  }
  const violations: Violation[] = enforceThresholds(diff, config);
  core.info(`Violations: ${violations.length}`);
  for (const v of violations) {
    core.error(
      `[${contractLabel(v)} / ${v.function_name} / ${v.case_id}] ${v.message}`,
    );
  }
  core.endGroup();

  // 8. Outputs
  const result = violations.length > 0 ? "fail" : "pass";
  core.setOutput("result", result);
  core.setOutput("diff-json", JSON.stringify(diff));

  // Report is available in the job summary even without permission to post a PR comment.
  const body = renderComment(diff, violations, baseRef, headSha);
  if (process.env.GITHUB_STEP_SUMMARY) await core.summary.addRaw(body).write();
  if (reportPathInput) writeReportFile(reportPathInput, headWorkspace, body);
  if (metadataPathInput) {
    const prNumber = github.context.payload.pull_request?.number;
    if (prNumber) {
      const destination = path.resolve(headWorkspace, metadataPathInput);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(
        destination,
        JSON.stringify({ prNumber, headSha }, null, 2),
        "utf8",
      );
    }
  }

  // 9. PR comment
  if (githubToken) {
    core.startGroup("Posting PR comment");
    try {
      await upsertPrComment(githubToken, body);
    } catch (err: any) {
      core.warning(`Failed to post PR comment: ${err.message}`);
    }
    core.endGroup();
  }

  // 10. Exit status
  if (violations.length > 0) {
    core.setFailed(`${violations.length} threshold violation(s) detected`);
  }
}

run().catch(async (error: Error) => {
  core.setOutput("result", "fail");
  core.setOutput("diff-json", "{}");
  core.setFailed(error.message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary
      .addRaw(
        `## WeighIn comparison failed\n\n${error.message}\n\nNo passing comparison or policy result was established.\n`,
      )
      .write();
  }
});
