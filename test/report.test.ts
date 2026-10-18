import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
      /Failed to write WeighIn report to .*dir-as-file: (EISDIR|EPERM)/,
    );
  });

  it("atomically replaces an existing report leaving no temporary files", () => {
    const reportPath = "report.md";
    const initialBody = "# Initial Report";
    writeReportFile(reportPath, tempDir, initialBody);

    const fullPath = path.join(tempDir, reportPath);
    expect(fs.readFileSync(fullPath, "utf8")).toBe(initialBody);

    const updatedBody = "# Updated Report";
    writeReportFile(reportPath, tempDir, updatedBody);

    expect(fs.readFileSync(fullPath, "utf8")).toBe(updatedBody);
    const files = fs.readdirSync(tempDir);
    expect(files).toEqual([reportPath]);
  });

  it("preserves previous target on rename failure and cleans up owned temporary file", () => {
    const subDir = path.join(tempDir, "sub");
    fs.mkdirSync(subDir);
    const targetReport = "sub/report.md";
    const dirAsTarget = path.join(tempDir, targetReport);
    // Create the target path as a directory so temp file creation succeeds but renameSync fails with EISDIR/EPERM
    fs.mkdirSync(dirAsTarget);
    fs.writeFileSync(path.join(dirAsTarget, "keep.txt"), "important data");

    expect(() =>
      writeReportFile(targetReport, tempDir, "# Corrupted Partial Report"),
    ).toThrow(/Failed to write WeighIn report to .*report.md: (EISDIR|EPERM)/);

    // Verify the target directory and its contents were preserved
    expect(fs.existsSync(dirAsTarget)).toBe(true);
    expect(fs.readFileSync(path.join(dirAsTarget, "keep.txt"), "utf8")).toBe(
      "important data",
    );

    // Verify no stray owned temporary files remain in the parent directory
    const files = fs.readdirSync(subDir);
    expect(files).toEqual(["report.md"]);
  });

  it("cleans owned temporary file without touching concurrent writers' temporary files", () => {
    const subDir = path.join(tempDir, "concurrent-test");
    fs.mkdirSync(subDir);
    const targetReport = "concurrent-test/report.md";
    const dirAsTarget = path.join(tempDir, targetReport);
    fs.mkdirSync(dirAsTarget);

    // Create a simulated concurrent writer's temp file in the same directory
    const concurrentTemp = path.join(
      subDir,
      ".report.md.99999.123456789.concurrent.tmp",
    );
    fs.writeFileSync(concurrentTemp, "concurrent in-flight data", "utf8");

    // Attempt write which fails at rename
    expect(() =>
      writeReportFile(targetReport, tempDir, "# In-flight failure"),
    ).toThrow(/Failed to write WeighIn report to .*report.md: (EISDIR|EPERM)/);

    // Ensure concurrent writer's temporary file was NOT deleted or modified
    expect(fs.existsSync(concurrentTemp)).toBe(true);
    expect(fs.readFileSync(concurrentTemp, "utf8")).toBe(
      "concurrent in-flight data",
    );

    // Clean up the simulated concurrent file
    fs.unlinkSync(concurrentTemp);
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
