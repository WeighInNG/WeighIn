import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeReportFile, generateFailureReport } from "../src/report";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validateOutputPaths, writeMetadataFile } from "../src/report";

describe("writeReportFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Temporary report files are created next to the destination report and
   * removed once the write finishes, so the destination directory must not
   * contain one after a completed write.
   */
  function temporaryFiles(directory: string): string[] {
    return fs.readdirSync(directory).filter((name) => name.endsWith(".tmp"));
  }

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

  it("leaves no temporary file behind after a successful write", () => {
    writeReportFile("report.md", tempDir, "# WeighIn Report\n");

    expect(temporaryFiles(tempDir)).toEqual([]);
    expect(fs.readdirSync(tempDir)).toEqual(["report.md"]);
  });

  it("creates nested directories", () => {
    const reportPath = "nested/deep/report.md";
    const body = "nested content";
    writeReportFile(reportPath, tempDir, body);

    const fullPath = path.join(tempDir, reportPath);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf8")).toBe(body);
    expect(temporaryFiles(path.join(tempDir, "nested/deep"))).toEqual([]);
  });

  it("replaces an existing report with the complete new report", () => {
    const fullPath = path.join(tempDir, "report.md");
    fs.writeFileSync(fullPath, "# Old report\n\nstale content");

    writeReportFile("report.md", tempDir, "# New report\n\ncomplete content");

    expect(fs.readFileSync(fullPath, "utf8")).toBe(
      "# New report\n\ncomplete content",
    );
    expect(temporaryFiles(tempDir)).toEqual([]);
  });

  it("supports legitimate separate nested output paths for report and metadata", () => {
    const reportPath = "artifacts/reports/nested/weighin-report.md";
    const metadataPath = "artifacts/metadata/nested/pr-metadata.json";
    const siblingMetadataPath = "artifacts/reports/nested/pr-metadata.json";

    const validated = validateOutputPaths({
      headWorkspace: tempDir,
      reportPath,
      metadataPath,
      fixturesPath: "fixtures/weighin-fixtures.json",
      configPath: "config/weighin.toml",
    });
    expect(validated.report?.lexicalPath).toBe(path.join(tempDir, reportPath));
    expect(validated.metadata?.lexicalPath).toBe(
      path.join(tempDir, metadataPath),
    );

    writeReportFile(reportPath, tempDir, "# Report Body", {
      metadataPath: siblingMetadataPath,
      fixturesPath: "fixtures/weighin-fixtures.json",
      configPath: "config/weighin.toml",
    });
    writeMetadataFile(siblingMetadataPath, tempDir, '{"schemaVersion":1}', {
      reportPath,
      fixturesPath: "fixtures/weighin-fixtures.json",
      configPath: "config/weighin.toml",
    });

    expect(fs.readFileSync(path.join(tempDir, reportPath), "utf8")).toBe(
      "# Report Body",
    );
    expect(
      fs.readFileSync(path.join(tempDir, siblingMetadataPath), "utf8"),
    ).toBe('{"schemaVersion":1}');
  });

  it("rejects colliding report-path and metadata-path including normalized relative segments", () => {
    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "artifacts/output.txt",
        metadataPath: "./artifacts/sub/../output.txt",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and metadata-path .* resolve to the same destination/,
    );

    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "artifacts/output",
        metadataPath: "artifacts/output/pr-metadata.json",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and metadata-path .* conflict as parent\/child paths/,
    );
  });

  it("rejects report-path or metadata-path colliding with fixtures-path or config-path without modifying inputs", () => {
    const fixturesFile = path.join(tempDir, "weighin-fixtures.json");
    const configFile = path.join(tempDir, "weighin.toml");
    fs.writeFileSync(fixturesFile, '{"fixture_id":"id:orig"}', "utf8");
    fs.writeFileSync(configFile, "[thresholds]\n", "utf8");

    expect(() =>
      writeReportFile("./sub/../weighin-fixtures.json", tempDir, "clobber", {
        fixturesPath: "weighin-fixtures.json",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and fixtures-path .* resolve to the same destination/,
    );

    expect(() =>
      writeMetadataFile("./weighin.toml", tempDir, "clobber", {
        configPath: "weighin.toml",
      }),
    ).toThrow(
      /Colliding output path: metadata-path .* and config-path .* resolve to the same destination/,
    );

    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "policies/trusted.toml",
        trustedPolicyPath: "./policies/sub/../trusted.toml",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and trusted-policy-path .* resolve to the same destination/,
    );

    expect(fs.readFileSync(fixturesFile, "utf8")).toBe(
      '{"fixture_id":"id:orig"}',
    );
    expect(fs.readFileSync(configFile, "utf8")).toBe("[thresholds]\n");
  });

  it("rejects workspace root and whitespace-only output paths", () => {
    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "./nested/..",
      }),
    ).toThrow(/resolves to the workspace root directory/);

    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        metadataPath: "   ",
      }),
    ).toThrow(/metadata-path must not be blank or whitespace-only/);
  });

  it("rejects existing symlinks and symlinked directory aliasing before writing", () => {
    const realDir = path.join(tempDir, "real-artifacts");
    const aliasDir = path.join(tempDir, "alias-artifacts");
    fs.mkdirSync(realDir, { recursive: true });

    const fixturesFile = path.join(realDir, "weighin-fixtures.json");
    const existingTarget = path.join(realDir, "existing-target.md");
    fs.writeFileSync(fixturesFile, '{"fixture_id":"id:safe"}', "utf8");
    fs.writeFileSync(existingTarget, "original target content", "utf8");

    const createLink = (target: string, linkPath: string) => {
      try {
        fs.symlinkSync(target, linkPath);
      } catch (err: any) {
        if (err?.code === "EPERM") {
          fs.symlinkSync(target, linkPath, "junction");
        } else {
          throw err;
        }
      }
    };

    createLink(realDir, aliasDir);
    const danglingLink = path.join(tempDir, "dangling-link");
    createLink(path.join(tempDir, "nonexistent-target"), danglingLink);

    expect(() =>
      writeReportFile(
        "alias-artifacts/weighin-fixtures.json",
        tempDir,
        "overwrite",
        {
          fixturesPath: "real-artifacts/weighin-fixtures.json",
        },
      ),
    ).toThrow(
      /Colliding output path: report-path .* and fixtures-path .* via existing symlink/,
    );
    expect(fs.readFileSync(fixturesFile, "utf8")).toBe(
      '{"fixture_id":"id:safe"}',
    );

    expect(() =>
      writeReportFile(
        "alias-artifacts/existing-target.md",
        tempDir,
        "overwrite",
      ),
    ).toThrow(/aliases or traverses an existing symlink/);
    expect(fs.readFileSync(existingTarget, "utf8")).toBe(
      "original target content",
    );

    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "dangling-link",
        metadataPath: "nonexistent-target",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and metadata-path .* resolve to the same destination .* via existing symlink/,
    );

    expect(() =>
      validateOutputPaths({
        headWorkspace: tempDir,
        reportPath: "alias-artifacts/nested/out.txt",
        metadataPath: "real-artifacts/nested/out.txt",
      }),
    ).toThrow(
      /Colliding output path: report-path .* and metadata-path .* resolve to the same destination .* via existing symlink/,
    );
  });

  it("throws clear error on write failure", () => {
    // We can simulate a failure by trying to write to a path that is a directory
    const dirAsFile = "dir-as-file";
    fs.mkdirSync(path.join(tempDir, dirAsFile));

    expect(() => writeReportFile(dirAsFile, tempDir, "body")).toThrow(
      /Failed to write WeighIn report to .*dir-as-file:/,
    );
  });

  it("fails predictably without corrupting an unrelated file", () => {
    const blocker = path.join(tempDir, "blocker");
    fs.writeFileSync(blocker, "unrelated content");

    expect(() => writeReportFile("blocker/report.md", tempDir, "body")).toThrow(
      /Failed to write WeighIn report to .*blocker[/\\]report\.md:/,
    );

    expect(fs.readFileSync(blocker, "utf8")).toBe("unrelated content");
    expect(temporaryFiles(tempDir)).toEqual([]);
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
