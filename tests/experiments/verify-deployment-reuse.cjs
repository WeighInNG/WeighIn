const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Address, Keypair, rpc, xdr } = require("@stellar/stellar-sdk");
const { analyze, sha256 } = require("./deployment-reuse-evidence.cjs");

const root = path.resolve(__dirname, "../..");
const destination = path.resolve(process.argv[2] ?? "");
const targets = process.argv.slice(3).map((value) => new URL(value));
assert.equal(targets.length, 2, "Supply two fresh standalone RPC URLs");
assert.notEqual(targets[0].href, targets[1].href);
for (const url of targets) assert.equal(url.hostname, "127.0.0.1");
assert.ok(process.argv[2], "Supply a new output directory");
fs.mkdirSync(destination);
const write = (name, value) =>
  fs.writeFileSync(
    path.join(destination, name),
    JSON.stringify(value, null, 2) + "\n",
  );
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "weighin-deployment-reuse-"),
);
const helperPath = path.join(
  root,
  "native/simulation/target/x86_64-unknown-linux-gnu/release/weighin-simulation",
);
const wasm = fs.readFileSync(
  path.join(
    root,
    "docs/experiments/repeatability/completed/run-1-reference.wasm",
  ),
);
const fixture =
  JSON.stringify(
    {
      contracts: [
        {
          wasm_path: "hello.wasm",
          invocations: [
            {
              function_name: "hello",
              args: [{ type: "Symbol", value: "world" }],
            },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n";
const wasmHash = sha256(wasm);
const salt = Buffer.from(sha256(Buffer.from(wasmHash, "hex")), "hex");

let sample;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const result = await fetchOriginal(url, options);
  if (sample && options?.method === "POST") {
    const { method, params } = JSON.parse(options.body);
    // Keep the submission response but omit signed envelopes from saved captures.
    sample.rpc.push({
      method,
      ...(method === "sendTransaction" ? {} : { params }),
      response: await result.clone().json(),
    });
  }
  return result;
};

const execOriginal = cp.execFile;
cp.execFile = function (file, args, options, callback) {
  if (file !== helperPath) return execOriginal.apply(this, arguments);
  const capture = sample;
  let input;
  const child = execOriginal(file, args, options, (error, stdout, stderr) => {
    if (!error) capture.native = { input, output: JSON.parse(stdout) };
    callback(error, stdout, stderr);
  });
  const end = child.stdin.end.bind(child.stdin);
  child.stdin.end = (data, ...rest) => {
    input = JSON.parse(data);
    return end(data, ...rest);
  };
  return child;
};

const {
  calculateContractId,
  runMeasurement,
} = require("../../dist/measurement");
const keys = [Keypair.random(), Keypair.random()];
const keyPaths = keys.map((key, index) => {
  const file = path.join(workspace, "deployer-" + index);
  fs.writeFileSync(file, key.secret(), { mode: 0o600 });
  return file;
});

async function request(url, method, params) {
  const res = await fetchOriginal(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const response = await res.json();
  assert.ok(res.ok && !response.error, method);
  return { params, response };
}

function deploymentKeys(contract) {
  return [
    xdr.LedgerKey.contractCode(
      new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, "hex") }),
    ),
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(contract).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    ),
  ].map((key) => key.toXDR("base64"));
}

async function main() {
  for (const dir of [workspace, destination]) {
    fs.writeFileSync(path.join(dir, "hello.wasm"), wasm);
    fs.writeFileSync(path.join(dir, "fixtures.json"), fixture);
  }
  const evidence = {
    source_revision: cp
      .execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      })
      .trim(),
    wasm_sha256: wasmHash,
    fixture_sha256: sha256(fixture),
    sdk: "28.0.0",
    node: process.version,
    deployers: keys.map((key) => key.publicKey()),
    invocation_source: keys[0].publicKey(),
    salt: salt.toString("hex"),
    networks: [],
    samples: [],
  };
  for (const [index, url] of targets.entries()) {
    const network = (await request(url, "getNetwork")).response.result;
    const version = (await request(url, "getVersionInfo")).response.result;
    assert.equal(network.passphrase, "Standalone Network ; February 2017");
    assert.equal(network.protocolVersion, 28);
    evidence.networks.push({ endpoint: url.href, network, version });
    const server = new rpc.Server(url.href, { allowHttp: true });
    for (const key of keys) {
      const address = key.publicKey();
      for (let attempt = 0; ; attempt++) {
        try {
          await server.getAccount(address);
          break;
        } catch (error) {
          if (attempt >= 20) throw error;
          await fetchOriginal(new URL("/friendbot?addr=" + address, url), {
            signal: AbortSignal.timeout(15000),
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    for (const [condition, deployer] of [
      ["cold", 0],
      ["uploaded", 1],
      ["reused", 1],
    ]) {
      const contract_id = calculateContractId(keys[deployer].publicKey(), salt);
      const snapshot = () =>
        Promise.all(
          deploymentKeys(contract_id).map((key) =>
            request(url, "getLedgerEntries", { keys: [key] }),
          ),
        );
      sample = {
        condition,
        repetition: index + 1,
        contract_id,
        before: await snapshot(),
        rpc: [],
      };
      const [record] = await runMeasurement({
        fixturesPath: path.join(workspace, "fixtures.json"),
        fixtureId: "deployment-reuse",
        keyFile: keyPaths[deployer],
        helperPath,
        rpcUrl: url.href,
        invocationSourceAccount: evidence.invocation_source,
        gitCommit: evidence.source_revision,
        sdkVersion: evidence.sdk,
      });
      sample.record = record;
      sample.after = await snapshot();
      evidence.samples.push(sample);
      write("samples.json", evidence);
      sample = undefined;
    }
  }
  write("ranges.json", analyze(evidence, wasm, fixture));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(workspace, { recursive: true, force: true }));
