import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export interface ReportFsOps {
  writeFileSync?: typeof fs.writeFileSync;
  renameSync?: typeof fs.renameSync;
  unlinkSync?: typeof fs.unlinkSync;
}

export function writeReportFile(
  reportPathInput: string,
  headWorkspace: string,
  body: string,
  fsOps?: ReportFsOps,
): void {
  if (!reportPathInput) return;
  const targetPath = path.resolve(headWorkspace, reportPathInput);
  const write = fsOps?.writeFileSync ?? fs.writeFileSync;
  const rename = fsOps?.renameSync ?? fs.renameSync;
  const unlink = fsOps?.unlinkSync ?? fs.unlinkSync;
  let tempPath: string | null = null;
  try {
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      const dirErr: any = new Error(
        `EISDIR: illegal operation on a directory, open '${targetPath}'`,
      );
      dirErr.code = "EISDIR";
      throw dirErr;
    }
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const baseName = path.basename(targetPath);
    const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tempPath = path.join(parentDir, `.${baseName}.weighin-${uniqueSuffix}.tmp`);
    write(tempPath, body, { encoding: "utf8", flag: "wx" });
    rename(tempPath, targetPath);
    tempPath = null;
    core.info(`Wrote Markdown report to ${targetPath}`);
  } catch (err: any) {
    if (tempPath) {
      try {
        unlink(tempPath);
      } catch {
        // Ignore cleanup failure; preserve primary write/rename diagnostic
      }
    }
    throw new Error(
      `Failed to write WeighIn report to ${targetPath}: ${err.message}`,
    );
  }
}
