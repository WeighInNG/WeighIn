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
