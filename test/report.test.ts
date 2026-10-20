import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeReportFile, generateFailureReport } from "../src/report";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("writeReportFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does nothing if reportPathInput is empty", () => {
    writeReportFile("", tempDir, "body");
    const files = fs.readdirSync(tempDir);
    expect(files.length).toBe(0);
  });

  it("writes exact content to a valid path", () => {
    const reportPath = "report.md";
    const body = "# WeighIn Report\n\nExample report";
    writeReportFile(reportPath, tempDir, body);

    const fullPath = path.join(tempDir, reportPath);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf8")).toBe(body);
  });

  it("creates nested directories", () => {
    const reportPath = "nested/deep/report.md";
    const body = "nested content";
    writeReportFile(reportPath, tempDir, body);

    const fullPath = path.join(tempDir, reportPath);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf8")).toBe(body);
  });

  it("throws clear error on write failure", () => {
    // We can simulate a failure by trying to write to a path that is a directory
    const dirAsFile = "dir-as-file";
    fs.mkdirSync(path.join(tempDir, dirAsFile));

    expect(() => writeReportFile(dirAsFile, tempDir, "body")).toThrow(
      /Failed to write WeighIn report to .*dir-as-file: (?:EISDIR|EPERM)/,
    );
  });

  it("writes via an owned same-directory temporary file and leaves no temporary files behind on success", () => {
    const reportPath = "atomic-report.md";
    const body = "# Atomic WeighIn Report\n\nComplete payload";
    const renameCalls: Array<[string, string]> = [];
    writeReportFile(reportPath, tempDir, body, {
      renameSync: (oldPath, newPath) => {
        renameCalls.push([String(oldPath), String(newPath)]);
        fs.renameSync(oldPath, newPath);
      },
    });
    expect(renameCalls.length).toBe(1);
    const [srcTmp, destTarget] = renameCalls[0];
    expect(path.dirname(srcTmp)).toBe(tempDir);
    expect(path.basename(srcTmp)).toMatch(
      /^\.atomic-report\.md\.weighin-.*\.tmp$/,
    );
    expect(destTarget).toBe(path.join(tempDir, reportPath));

    const entries = fs.readdirSync(tempDir);
    expect(entries).toEqual([reportPath]);
    expect(fs.readFileSync(path.join(tempDir, reportPath), "utf8")).toBe(body);
  });

  it("preserves an existing report and cleans only its owned temporary file when write or rename fails", () => {
    const reportPath = "existing-report.md";
    const fullPath = path.join(tempDir, reportPath);
    const previousContent = "# Previous Valid Report\n\nKeep me intact";
    fs.writeFileSync(fullPath, previousContent, "utf8");

    // Simulate a concurrent writer's temporary file in the same directory
    const concurrentTmp = path.join(
      tempDir,
      ".existing-report.md.weighin-concurrent-99999.tmp",
    );
    fs.writeFileSync(concurrentTmp, "in-flight concurrent write", "utf8");

    expect(() =>
      writeReportFile(reportPath, tempDir, "# Replacement Report", {
        renameSync: () => {
          throw new Error("simulated rename failure");
        },
      }),
    ).toThrow(/Failed to write WeighIn report.*simulated rename failure/);

    // Also test write failure after temp file creation
    expect(() =>
      writeReportFile(reportPath, tempDir, "# Replacement Report 2", {
        writeFileSync: (file) => {
          fs.writeFileSync(file, "partial content", "utf8");
          throw new Error("simulated partial write failure");
        },
      }),
    ).toThrow(
      /Failed to write WeighIn report.*simulated partial write failure/,
    );

    // Previous valid report is preserved untouched
    expect(fs.readFileSync(fullPath, "utf8")).toBe(previousContent);
    // Concurrent writer's temporary file is untouched, while our owned temporary files were cleaned up
    expect(fs.existsSync(concurrentTmp)).toBe(true);
    expect(fs.readFileSync(concurrentTmp, "utf8")).toBe(
      "in-flight concurrent write",
    );
    const remainingFiles = fs.readdirSync(tempDir).sort();
    expect(remainingFiles).toEqual(
      [path.basename(concurrentTmp), reportPath].sort(),
    );
  });
});

describe("generateFailureReport", () => {
  it("generates an explicit unsuccessful comparison report with failure details", () => {
    const errorMsg = "RPC connection refused at http://127.0.0.1:8000/rpc";
    const report = generateFailureReport(errorMsg);

    expect(report).toContain(
      "# WeighIn Resource Benchmark: Unsuccessful Comparison",
    );
    expect(report).toContain("Status: FAILED");
    expect(report).toContain(errorMsg);
    expect(report).toContain("**Policies established:** No");
    expect(report).toContain("**Thresholds evaluated:** None");
    expect(report).toContain("**Benchmark metrics:** None (not measured)");
    expect(report).toContain(
      "No passing comparison, deltas, or resource consumption metrics were established.",
    );
  });
});
