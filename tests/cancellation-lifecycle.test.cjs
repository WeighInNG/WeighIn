const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  createCancellationScope,
  runWithCancellation,
  setActiveCancellationScope,
} = require("../dist/cancellation");

async function waitFor(predicate, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function ownedDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weighin-unit-owned-"));
}

function callerWorkspace() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "caller-unit-workspace-"),
  );
  const file = path.join(directory, "keep.txt");
  fs.writeFileSync(file, "caller");
  return { directory, file };
}

function longChild() {
  return spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
}

test("successful work exits normally after terminating children and owned cleanup", async () => {
  const originalExitCode = process.exitCode;
  const directory = ownedDir();
  const child = longChild();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const scope = createCancellationScope({ setExitCodeOnCancel: false });
  scope.registerChild(child);
  scope.registerOwnedPath(
    directory,
    () => fs.rmSync(directory, { recursive: true, force: true }),
    "owned success-test directory",
  );

  try {
    const result = await runWithCancellation(scope, async () => "completed", {
      reportFailure: false,
    });
    assert.equal(result, "completed");
    assert.equal(scope.aborted, false);
    await exited;
    assert.equal(child.exitCode !== null || child.signalCode !== null, true);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(process.exitCode, originalExitCode);
  } finally {
    scope.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
    child.kill("SIGKILL");
  }
});

test("ordinary failure still cleans owned paths and preserves caller workspace", async () => {
  const originalExitCode = process.exitCode;
  const directory = ownedDir();
  const workspace = callerWorkspace();
  const scope = createCancellationScope({ setExitCodeOnCancel: false });
  scope.registerOwnedPath(
    directory,
    () => fs.rmSync(directory, { recursive: true, force: true }),
    "owned failure-test directory",
  );

  try {
    await assert.rejects(
      runWithCancellation(
        scope,
        async () => {
          throw new Error("ordinary failure");
        },
        { reportFailure: false },
      ),
      /ordinary failure/,
    );
    assert.equal(scope.aborted, false);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.readFileSync(workspace.file, "utf8"), "caller");
    assert.equal(process.exitCode, originalExitCode);
  } finally {
    scope.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

test("cancellation terminates child before owned cleanup and preserves caller workspace", async () => {
  const originalExitCode = process.exitCode;
  const directory = ownedDir();
  const workspace = callerWorkspace();
  const events = [];
  const child = longChild();
  child.once("exit", () => events.push("child-exit"));
  const scope = createCancellationScope({ setExitCodeOnCancel: false });
  scope.registerChild(child);
  scope.registerOwnedPath(
    directory,
    () => {
      events.push("cleanup-start");
      fs.rmSync(directory, { recursive: true, force: true });
    },
    "owned cancellation directory",
  );

  try {
    scope.requestCancel("simulated cancellation");
    await scope.shutdown();

    assert.equal(scope.aborted, true);
    assert.match(String(scope.reason), /simulated cancellation/);
    assert.equal(child.exitCode !== null || child.signalCode !== null, true);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.readFileSync(workspace.file, "utf8"), "caller");
    assert.ok(
      events.indexOf("child-exit") !== -1 &&
        events.indexOf("child-exit") < events.indexOf("cleanup-start"),
      `child must exit before cleanup: ${events.join(",")}`,
    );
    assert.equal(process.exitCode, originalExitCode);
  } finally {
    scope.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(workspace.directory, { recursive: true, force: true });
    child.kill("SIGKILL");
  }
});

test("cancellation kills an exec child and rejects the interrupted command", async () => {
  const scope = createCancellationScope({ setExitCodeOnCancel: false });
  setActiveCancellationScope(scope);

  try {
    const execution = scope.exec(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { silent: true },
    );
    setTimeout(() => scope.requestCancel("cancel tracked exec"), 50);
    await assert.rejects(execution, /cancel tracked exec/);
    assert.equal(scope.aborted, true);
    await scope.shutdown();
  } finally {
    scope.dispose();
    setActiveCancellationScope(null);
  }
});

test("owned-path registration rejects caller workspace paths", () => {
  const workspace = callerWorkspace();
  const scope = createCancellationScope({ setExitCodeOnCancel: false });
  try {
    assert.throws(
      () => scope.registerOwnedPath(workspace.directory, () => {}, "workspace"),
      /Refusing to register non-owned path for cancellation cleanup/,
    );
    assert.deepEqual(scope.ownedPaths, []);
  } finally {
    scope.dispose();
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

test("SIGTERM produces nonzero outcome, kills child, cleans owned paths and keeps caller workspace", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "weighin-sigterm-test-"),
  );
  const resultPath = path.join(directory, "result.json");
  const readyPath = path.join(directory, "ready");
  const fixture = path.join(
    __dirname,
    "fixtures/cancellation/sigterm-target.cjs",
  );
  const child = spawn(process.execPath, [fixture, resultPath, readyPath], {
    stdio: "ignore",
  });

  try {
    await waitFor(() => fs.existsSync(readyPath));
    child.kill("SIGTERM");
    const exitCode = await new Promise((resolve) =>
      child.once("exit", resolve),
    );
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

    assert.notEqual(exitCode, 0);
    assert.equal(result.aborted, true);
    assert.match(result.failure, /SIGTERM/);
    assert.equal(result.childKilled, true);
    assert.equal(result.ownedExists, false);
    assert.equal(result.workspaceFileExists, true);
    assert.equal(result.workspaceContent, "caller");
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.events.indexOf("child-exit") <
        result.events.indexOf("cleanup-start"),
      `child must exit before cleanup: ${result.events.join(",")}`,
    );
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
