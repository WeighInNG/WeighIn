const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { xdr } = require("@stellar/stellar-sdk");

const archive = path.resolve(__dirname, "../docs/experiments/temporary-ttl");
const fixture = path.resolve(__dirname, "../tests/fixtures/temporary-ttl");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(archive, name), "utf8"));

const verification = read("verification.json");
const environment = read("environment.json");
const cases = read("cases.json");
const composition = read("composition.json");
const observations = read("ledger-observations.json");
const replays = read("native-replays.json");
const captures = read("rpc-captures.json");

const byCase = (caseId) => replays.find((row) => row.case_id === caseId);
const temporaryEntry = (input) =>
  input.entries.find((row) => {
    if (!row.live_until) return false;
    const key = xdr.LedgerKey.fromXDR(row.key, "base64");
    return (
      key.switch().name === "contractData" &&
      key.contractData().key().switch().name === "scvSymbol" &&
      key.contractData().key().sym().toString() === "temp"
    );
  });

test("temporary-ttl archive checksums cover every retained file", () => {
  const manifest = read("sha256.json");
  const walk = (directory, prefix = "") => {
    const found = {};
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory())
        Object.assign(found, walk(path.join(directory, entry.name), relative));
      else if (relative !== "sha256.json") {
        found[relative] = sha256(
          fs.readFileSync(path.join(directory, entry.name)),
        );
      }
    }
    return found;
  };
  assert.deepEqual(manifest.files, walk(archive));
  assert.ok(manifest.files["contract/src/lib.rs"]);
  assert.ok(manifest.files["contract.wasm"]);
  assert.ok(manifest.files["rpc-captures.json"]);
  assert.ok(manifest.files["native-replays.json"]);
  assert.ok(manifest.files["ledger-observations.json"]);
  assert.ok(manifest.files["composition.json"]);
});

test("fixture writes a temporary entry and the harness never edits a TTL field", () => {
  const source = fs.readFileSync(
    path.join(fixture, "contract/src/lib.rs"),
    "utf8",
  );
  const archived = fs.readFileSync(
    path.join(archive, "contract/src/lib.rs"),
    "utf8",
  );
  assert.equal(source, archived);
  assert.match(source, /env\.storage\(\)\.temporary\(\)\.set/);
  assert.match(source, /env\.storage\(\)\.temporary\(\)\.get/);
  const harness = fs.readFileSync(
    path.resolve(__dirname, "experiments/verify-temporary-ttl.cjs"),
    "utf8",
  );
  assert.doesNotMatch(harness, /live_until\s*=/);
  assert.doesNotMatch(harness, /liveUntilLedgerSeq\s*[:=]/);
  assert.equal(composition.ttl_field_mutated, false);
  assert.equal(verification.ttl_field_mutated, false);
  assert.deepEqual(composition.changed_fields, ["header_xdr"]);
  assert.equal(
    composition.live_entry_origin,
    "raw getLedgerEntries response at live observation",
  );
  assert.equal(
    composition.expired_header_origin,
    "raw getLedgers response after natural expiry",
  );
});

test("live temporary entry is accepted and linked to genuine raw RPC and native captures", () => {
  assert.equal(verification.status, "VERIFIED");
  assert.equal(verification.harness_exit, 0);
  assert.equal(verification.real_build_deployment_rpc_and_native, true);
  assert.equal(verification.raw_io_observed_not_substituted, true);
  assert.equal(environment.protocol, 28);
  assert.equal(
    environment.wasm_bytes,
    fs.statSync(path.join(archive, "contract.wasm")).size,
  );
  assert.equal(
    sha256(fs.readFileSync(path.join(archive, "contract.wasm"))),
    environment.wasm_sha256,
  );
  assert.equal(verification.wasm_sha256, environment.wasm_sha256);

  const live = byCase("live");
  assert.ok(live?.output, "Live native output must be retained");
  assert.deepEqual(live.input.seed, Array(32).fill(0));
  assert.equal(sha256(JSON.stringify(live.input)), cases.live.input_sha256);
  assert.equal(cases.live.input_sha256, composition.live_input_sha256);
  assert.equal(
    live.output.cpu_instructions_consumed,
    cases.live.cpu_instructions_consumed,
  );
  assert.equal(live.output.retval_xdr, cases.live.retval_xdr);

  const liveHeader = xdr.LedgerHeader.fromXDR(live.input.header_xdr, "base64");
  const liveEntry = temporaryEntry(live.input);
  assert.ok(liveEntry, "Live footprint must contain the temporary entry");
  assert.equal(liveHeader.ledgerSeq(), cases.live.ledger);
  assert.equal(liveHeader.ledgerSeq(), composition.live_header_ledger);
  assert.ok(liveEntry.live_until > liveHeader.ledgerSeq());
  assert.equal(liveEntry.live_until, cases.natural_expiry.live_until);

  const liveCapture = captures.find(
    (call) =>
      call.request.method === "getLedgerEntries" &&
      call.raw.result?.entries?.some(
        (row) => row.liveUntilLedgerSeq === liveEntry.live_until,
      ),
  );
  assert.ok(
    liveCapture,
    "Raw RPC response carrying the genuine liveUntilLedgerSeq is required",
  );
  assert.equal(
    liveCapture.raw.result.entries.find(
      (row) => row.liveUntilLedgerSeq === liveEntry.live_until,
    ).xdr,
    liveEntry.xdr,
  );
});

test("natural expiry is observed as absence and the archived rejection uses only later genuine headers", () => {
  const live = byCase("live");
  const expired = byCase("expired-composed");
  const invalid = byCase("invalid-header");
  assert.ok(expired?.error, "Expired rejection stderr must be retained");
  assert.ok(invalid?.error, "Invalid-input rejection stderr must be retained");
  assert.equal(expired.output, null);
  assert.equal(invalid.output, null);

  assert.equal(
    observations.live.entries.entries[0]?.liveUntilLedgerSeq,
    composition.temporary_live_until,
  );
  assert.equal(observations.expired.entries.entries.length, 0);
  assert.ok(
    observations.expired.latest_ledger > composition.temporary_live_until,
  );
  assert.equal(
    cases.natural_expiry.observed_absent_at_ledger,
    observations.expired.latest_ledger,
  );
  assert.equal(cases.natural_expiry.entry_count, 0);

  assert.notEqual(expired.input.header_xdr, live.input.header_xdr);
  assert.deepEqual(expired.input.entries, live.input.entries);
  assert.deepEqual(expired.input.seed, live.input.seed);
  assert.equal(
    sha256(JSON.stringify(expired.input)),
    composition.expired_input_sha256,
  );
  assert.equal(
    sha256(JSON.stringify(expired.input)),
    verification.archived_control.input_sha256,
  );

  const expiredHeader = xdr.LedgerHeader.fromXDR(
    expired.input.header_xdr,
    "base64",
  );
  assert.equal(expiredHeader.ledgerSeq(), composition.expired_header_ledger);
  assert.ok(expiredHeader.ledgerSeq() > composition.temporary_live_until);
  const headerRow = observations.expired.ledgers.ledgers.find(
    (row) => row.sequence === observations.expired.latest_ledger,
  );
  assert.ok(headerRow, "Raw later ledger header must be retained");
  assert.equal(
    expired.input.header_xdr,
    xdr.LedgerHeaderHistoryEntry.fromXDR(headerRow.headerXdr, "base64")
      .header()
      .toXDR("base64"),
  );

  assert.equal(expired.status, 1);
  assert.match(expired.error, /archived ledger state is unsupported/);
  assert.equal(expired.error.trim(), verification.archived_control.message);
  assert.notEqual(invalid.status, 0);
  assert.ok(invalid.error.trim().length > 0);
  assert.equal(
    invalid.error.trim(),
    verification.invalid_input_control.message,
  );
});

test("raw captures remain explicit and contain no key material", () => {
  for (const call of captures) {
    assert.equal(call.raw.jsonrpc, "2.0");
    assert.ok(
      call.raw.result,
      `Raw RPC response retained for ${call.request.method}`,
    );
    assert.doesNotMatch(
      JSON.stringify(call),
      /private_key|secret_key|seed_bytes/i,
    );
  }
  for (const row of replays) {
    if (row.output) assert.equal(row.error, null);
    else assert.ok(row.error, "Failure cases must retain an explicit error");
  }
});
