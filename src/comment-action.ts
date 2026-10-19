import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import { parsePrMetadata } from "./pr-metadata";
import { upsertPrComment } from "./comment";

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

    const resolvedReportPath = resolveConsumerInputPath(reportPath, "Report");
    const resolvedMetadataPath = resolveConsumerInputPath(
      metadataPath,
      "Metadata",
    );

    const reportBody = fs.readFileSync(resolvedReportPath, "utf8");
    const metadataRaw = fs.readFileSync(resolvedMetadataPath, "utf8");
    const { owner, repo } = github.context.repo;
    const metadata = parsePrMetadata(metadataRaw, `${owner}/${repo}`);

    await upsertPrComment(token, metadata.prNumber, reportBody);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
