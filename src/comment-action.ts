import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { upsertPrComment } from "./comment";

async function run(): Promise<void> {
  try {
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
    const metadata = JSON.parse(metadataRaw);

    if (!metadata.prNumber) {
      throw new Error("prNumber not found in metadata file");
    }

    await upsertPrComment(token, metadata.prNumber, reportBody);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
