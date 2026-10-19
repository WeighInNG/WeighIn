import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import { parsePrMetadata } from "./pr-metadata";
import { upsertPrComment } from "./comment";
import {
  validateSupportedInputs,
  SUPPORTED_COMMENT_ACTION_INPUTS,
} from "./action-contract";

async function run(): Promise<void> {
  try {
    validateSupportedInputs(SUPPORTED_COMMENT_ACTION_INPUTS);

    const reportPath = core.getInput("report-path", { required: true });
    const metadataPath = core.getInput("metadata-path", { required: true });
    const token = core.getInput("github-token", { required: true });

    if (!fs.existsSync(reportPath)) {
      throw new Error(`Report file not found: ${reportPath}`);
    }
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }

    const reportBody = fs.readFileSync(reportPath, "utf8");
    const metadataRaw = fs.readFileSync(metadataPath, "utf8");
    const { owner, repo } = github.context.repo;
    const metadata = parsePrMetadata(metadataRaw, `${owner}/${repo}`);

    await upsertPrComment(token, metadata.prNumber, reportBody);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
