const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Keypair } = require("@stellar/stellar-sdk");
const { runMeasurement } = require("../dist/measurement");

const posix =
  process.platform !== "win32" && typeof process.getuid === "function";

function fixtureIn(directory) {
  const fixturesPath = path.join(directory, "fixtures.json");
  fs.writeFileSync(
    fixturesPath,
    JSON.stringify({
      contracts: [
        {
          wasm_path: "contract.wasm",
          invocations: [{ function_name: "test", args: [] }],
        },
      ],
    }),
  );
  return fixturesPath;
}

async function reachAccountReadiness(t, options) {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    controller.abort(new Error("controlled network stop"));
    throw controller.signal.reason;
  };
  try {
    await assert.rejects(
      runMeasurement({ ...options, signal: controller.signal }),
      /controlled network stop/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 1, "valid key reaches account readiness exactly once");
}

test(
  "a valid explicit private key is loaded and preserved",
  { skip: !posix },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "weighin-private-key-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const keyFile = path.join(directory, "deployer.key");
    const secret = Keypair.random().secret();
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    const fixturesPath = fixtureIn(directory);

    await reachAccountReadiness(t, { fixturesPath, keyFile });
    assert.equal(fs.readFileSync(keyFile, "utf8"), secret);
  },
);

test(
  "a new private key is created with owner-only permissions",
  { skip: !posix },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "weighin-private-key-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const keyFile = path.join(directory, "deployer.key");
    const fixturesPath = fixtureIn(directory);

    await reachAccountReadiness(t, { fixturesPath, keyFile });
    const stats = fs.statSync(keyFile);
    assert.equal(stats.uid, process.getuid());
    assert.equal(stats.mode & 0o777, 0o600 & ~process.umask());
    assert.doesNotThrow(() =>
      Keypair.fromSecret(fs.readFileSync(keyFile, "utf8")),
    );
  },
);

test(
  "symlink, nonregular, and group/other-accessible key paths fail before RPC",
  { skip: !posix },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "weighin-private-key-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const fixturesPath = fixtureIn(directory);
    const realKey = path.join(directory, "real.key");
    fs.writeFileSync(realKey, Keypair.random().secret(), { mode: 0o600 });

    const symlink = path.join(directory, "symlink.key");
    fs.symlinkSync(realKey, symlink);
    const nonregular = path.join(directory, "key-directory");
    fs.mkdirSync(nonregular);
    const insecure = path.join(directory, "insecure.key");
    fs.writeFileSync(insecure, Keypair.random().secret(), { mode: 0o600 });
    fs.chmodSync(insecure, 0o640);

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("RPC must not be called for an invalid key path");
    };
    try {
      await assert.rejects(
        runMeasurement({ fixturesPath, keyFile: symlink }),
        /regular file.*symlink or special file/,
      );
      await assert.rejects(
        runMeasurement({ fixturesPath, keyFile: nonregular }),
        /regular file.*symlink or special file/,
      );
      await assert.rejects(
        runMeasurement({ fixturesPath, keyFile: insecure }),
        /permissions must deny all group and other access/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(
      calls,
      0,
      "invalid keys fail before account readiness or funding",
    );
  },
);

test(
  "a key owned by another user is rejected before its contents are read",
  { skip: !posix },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "weighin-private-key-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const fixturesPath = fixtureIn(directory);
    const keyFile = path.join(directory, "deployer.key");
    fs.writeFileSync(keyFile, Keypair.random().secret(), { mode: 0o600 });

    const originalFstat = fs.fstatSync;
    const originalReadFile = fs.readFileSync;
    let keyContentReads = 0;
    fs.fstatSync = () => ({
      isFile: () => true,
      uid: process.getuid() + 1,
      mode: 0o100600,
    });
    fs.readFileSync = (file, ...args) => {
      if (typeof file === "number") keyContentReads++;
      return originalReadFile(file, ...args);
    };
    try {
      await assert.rejects(
        runMeasurement({ fixturesPath, keyFile }),
        /must be owned by the current user/,
      );
    } finally {
      fs.fstatSync = originalFstat;
      fs.readFileSync = originalReadFile;
    }
    assert.equal(keyContentReads, 0);
  },
);

test(
  "Windows fails closed because key-file ACLs cannot be verified portably",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "weighin-private-key-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const fixturesPath = fixtureIn(directory);
    await assert.rejects(
      runMeasurement({
        fixturesPath,
        keyFile: path.join(directory, "deployer.key"),
      }),
      /Secure deployer key files require a POSIX platform/,
    );
  },
);
