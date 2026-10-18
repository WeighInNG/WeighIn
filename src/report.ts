import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export function writeReportFile(
  reportPathInput: string,
  headWorkspace: string,
  body: string,
): void {
  if (!reportPathInput) return;
  const targetPath = path.resolve(headWorkspace, reportPathInput);
  try {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, body, "utf8");
    core.info(`Wrote Markdown report to ${targetPath}`);
  } catch (err: any) {
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
