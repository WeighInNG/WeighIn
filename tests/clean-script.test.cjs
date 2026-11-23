const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const cleanScriptPath = path.join(repoRoot, "scripts", "clean.sh");

function getBashExecutable() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return "bash";
}

test("clean.sh exists and starts with bash shebang", () => {
  assert.ok(fs.existsSync(cleanScriptPath), "scripts/clean.sh must exist");
  const content = fs.readFileSync(cleanScriptPath, "utf8");
  assert.ok(
    content.startsWith("#!/usr/bin/env bash"),
    "scripts/clean.sh must begin with #!/usr/bin/env bash shebang",
  );
  assert.ok(
    content.includes("dist") && content.includes("coverage"),
    "scripts/clean.sh must target dist and coverage directories",
  );
});

test("package.json exposes npm run clean script", () => {
  const pkgPath = path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.ok(pkg.scripts, "package.json must contain scripts section");
  assert.equal(
    pkg.scripts.clean,
    "bash scripts/clean.sh",
    "package.json scripts.clean must run bash scripts/clean.sh",
  );
});

test("clean.sh safely wipes target artifacts and is idempotent", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-clean-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Create isolated sandbox structure mimicking repo with scripts/clean.sh
  const scriptsDir = path.join(tmpDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(cleanScriptPath, path.join(scriptsDir, "clean.sh"));

  // Create dummy directories and files that should be cleaned
  const distDir = path.join(tmpDir, "dist");
  const covDir = path.join(tmpDir, "coverage");
  const cacheDir = path.join(tmpDir, ".cache");
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(covDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.js"), "module.exports = {};");
  fs.writeFileSync(path.join(covDir, "lcov.info"), "TN:");

  const resultFile = path.join(tmpDir, "weighin-results.json");
  const reportFile = path.join(tmpDir, "weighin-report.md");
  fs.writeFileSync(resultFile, "{}");
  fs.writeFileSync(reportFile, "# Report");

  // Create file that should NOT be deleted
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const srcFile = path.join(srcDir, "index.ts");
  fs.writeFileSync(srcFile, "export const x = 1;");

  const bashCmd = getBashExecutable();

  // Run clean.sh inside sandbox
  const runResult = spawnSync(bashCmd, ["scripts/clean.sh"], {
    cwd: tmpDir,
    encoding: "utf8",
  });

  assert.ifError(runResult.error);
  assert.equal(
    runResult.status,
    0,
    `clean.sh should exit with code 0. stderr: ${runResult.stderr}`,
  );
  assert.ok(!fs.existsSync(distDir), "dist/ should be removed");
  assert.ok(!fs.existsSync(covDir), "coverage/ should be removed");
  assert.ok(!fs.existsSync(cacheDir), ".cache/ should be removed");
  assert.ok(
    !fs.existsSync(resultFile),
    "weighin-results.json should be removed",
  );
  assert.ok(!fs.existsSync(reportFile), "weighin-report.md should be removed");
  assert.ok(fs.existsSync(srcFile), "src/index.ts must NOT be touched");

  // Idempotency check: run clean.sh second time when targets already absent
  const secondRun = spawnSync(bashCmd, ["scripts/clean.sh"], {
    cwd: tmpDir,
    encoding: "utf8",
  });
  assert.ifError(secondRun.error);
  assert.equal(
    secondRun.status,
    0,
    "Second clean.sh run should exit cleanly with 0",
  );
});
