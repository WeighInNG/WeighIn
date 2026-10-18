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
      /Failed to write WeighIn report to .*dir-as-file: EISDIR/,
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
