import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as core from "@actions/core";

export function writeReportFile(
  reportPathInput: string,
  headWorkspace: string,
  body: string,
): void {
  if (!reportPathInput) return;
  const targetPath = path.resolve(headWorkspace, reportPathInput);
  const parentDir = path.dirname(targetPath);
  let tempPath: string | undefined;

  try {
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const uniqueSuffix = `${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}`;
    tempPath = path.join(
      parentDir,
      `.${path.basename(targetPath)}.${uniqueSuffix}.tmp`,
    );

    fs.writeFileSync(tempPath, body, "utf8");
    fs.renameSync(tempPath, targetPath);
    core.info(`Wrote Markdown report to ${targetPath}`);
  } catch (err: any) {
    if (tempPath) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // ignore cleanup error to preserve primary error
      }
    }
    throw new Error(
      `Failed to write WeighIn report to ${targetPath}: ${err.message}`,
    );
  }
}

export function generateFailureReport(errorMessage: string): string {
  return [
    "# WeighIn Resource Benchmark: Unsuccessful Comparison",
    "",
    "> **Status: FAILED** — A comparison or policy result could not be established due to an execution failure.",
    "",
    "## Failure Details",
    "",
    "```",
    errorMessage,
    "```",
    "",
    "## Policy Result",
    "",
    "- **Policies established:** No",
    "- **Thresholds evaluated:** None",
    "- **Benchmark metrics:** None (not measured)",
    "",
    "No passing comparison, deltas, or resource consumption metrics were established.",
    "",
  ].join("\n");
}
