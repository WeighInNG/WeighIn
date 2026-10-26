import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import { parsePrMetadata } from "./pr-metadata";
import { evaluateReportFreshness } from "./pr-freshness";
import { createOctokitRevisionSource } from "./pr-revision-source";
import { upsertPrComment, CommentAuthorMode } from "./comment";

async function reportSkipped(reason: string): Promise<void> {
  core.warning(reason);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary
      .addHeading("WeighIn comment skipped", 3)
      .addRaw(reason, true)
      .write();
  }
}

function resolveConsumerInputPath(
  inputPath: string,
  label: "Report" | "Metadata",
): string {
  const trimmed = inputPath.trim();
  const workspace = process.env["GITHUB_WORKSPACE"]?.trim();
  if (workspace) {
    const normalizedWorkspace = workspace.replace(/[\\/]+$/, "");
    const normalizedInput = trimmed.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const workspaceCandidate = `${normalizedWorkspace}/${normalizedInput}`;
    if (fs.existsSync(workspaceCandidate)) {
      return workspaceCandidate;
    }
  }
  if (fs.existsSync(trimmed)) {
    return trimmed;
  }
  throw new Error(`${label} file not found: ${inputPath}`);
}

async function run(): Promise<void> {
  try {
    const reportPath = core.getInput("report-path", { required: true });
    const metadataPath = core.getInput("metadata-path", { required: true });
    const token = core.getInput("github-token", { required: true });
    const commentAuthorModeRaw =
      core.getInput("comment-author-mode") || "github-actions";
    if (
      commentAuthorModeRaw !== "github-actions" &&
      commentAuthorModeRaw !== "authenticated-user"
    ) {
      throw new Error(
        `Unsupported comment-author-mode: "${commentAuthorModeRaw}". ` +
          'Supported values are "github-actions" and "authenticated-user".',
      );
    }
    const commentAuthorMode = commentAuthorModeRaw as CommentAuthorMode;

    const resolvedReportPath = resolveConsumerInputPath(reportPath, "Report");
    const resolvedMetadataPath = resolveConsumerInputPath(
      metadataPath,
      "Metadata",
    );

    const reportBody = fs.readFileSync(resolvedReportPath, "utf8");
    const metadataRaw = fs.readFileSync(resolvedMetadataPath, "utf8");
    const { owner, repo } = github.context.repo;
    const metadata = parsePrMetadata(metadataRaw, `${owner}/${repo}`);

    const freshness = await evaluateReportFreshness(
      {
        prNumber: metadata.prNumber,
        producerSha: github.context.payload.workflow_run?.head_sha,
        metadataSha: metadata.headSha,
      },
      createOctokitRevisionSource(github.getOctokit(token), owner, repo),
    );
    if (!freshness.fresh) {
      await reportSkipped(freshness.reason);
      return;
    }

    await upsertPrComment(token, metadata.prNumber, reportBody, {
      commentAuthorMode,
      core,
    });
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
