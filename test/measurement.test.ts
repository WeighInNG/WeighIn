import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  toScVal,
  validateContractArtifact,
  preflightContractArtifacts,
  WASM_MAGIC_HEADER,
} from "../src/measurement";
import { Keypair } from "@stellar/stellar-sdk";

describe("configured argument conversion", () => {
  it("encodes scalar values and preserves large integers", () => {
    expect(toScVal({ type: "Symbol", value: "hello" }).switch().name).toBe(
      "scvSymbol",
    );
    expect(toScVal({ type: "u32", value: 42 }).switch().name).toBe("scvU32");
    expect(
      toScVal({ type: "u64", value: "18446744073709551615" }).switch().name,
    ).toBe("scvU64");
    expect(
      toScVal({
        type: "i128",
        value: "-170141183460469231731687303715884105728",
      }).switch().name,
    ).toBe("scvI128");
  });

  it("encodes addresses, bytes and recursive vector/map values", () => {
    expect(
      toScVal({ type: "address", value: Keypair.random().publicKey() }).switch()
        .name,
    ).toBe("scvAddress");
    expect(toScVal({ type: "bytes", value: "00ff" }).switch().name).toBe(
      "scvBytes",
    );
    expect(
      toScVal({ type: "vec", value: [{ type: "string", value: "x" }] }).switch()
        .name,
    ).toBe("scvVec");
    expect(
      toScVal({
        type: "map",
        value: [
          {
            key: { type: "u32", value: 1 },
            value: { type: "bool", value: true },
          },
        ],
      }).switch().name,
    ).toBe("scvMap");
  });

  it("rejects invalid numeric, address and byte arguments", () => {
    expect(() => toScVal({ type: "u64", value: "invalid" })).toThrow(
      /valid integer string/,
    );
    expect(() => toScVal({ type: "address", value: "invalid" })).toThrow(
      /Invalid value for address/,
    );
    expect(() => toScVal({ type: "bytes", value: "0" })).toThrow(/even length/);
  });
});

describe("contract artifact preflight and header validation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-preflight-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a regular file with a valid 8-byte WASM header", () => {
    const wasmPath = path.join(tmpDir, "valid.wasm");
    const bytes = Buffer.concat([WASM_MAGIC_HEADER, Buffer.from([1, 2, 3, 4])]);
    fs.writeFileSync(wasmPath, bytes);

    const result = validateContractArtifact(
      tmpDir,
      { id: "my-contract", wasm_path: "valid.wasm", invocations: [] },
      "path:fixtures.json",
    );

    expect(result.wasmPath).toBe(wasmPath);
    expect(result.wasmBytes).toEqual(bytes);
    expect(result.wasmSha256).toBe(
      "9b86059946043915df15ba27b8ed0a53a912c06ea4628c30d1bc8084878f4aaf",
    );
  });

  it("rejects missing WASM file with logical context", () => {
    expect(() =>
      validateContractArtifact(
        tmpDir,
        { id: "missing-contract", wasm_path: "absent.wasm", invocations: [] },
        "path:test-fixtures.json",
      ),
    ).toThrow(
      /Contract path:test-fixtures\.json \/ id:missing-contract: WASM not found/,
    );
  });

  it("rejects directory paths that are not regular files with logical context", () => {
    const dirPath = path.join(tmpDir, "fake-dir.wasm");
    fs.mkdirSync(dirPath);

    expect(() =>
      validateContractArtifact(
        tmpDir,
        { id: "dir-contract", wasm_path: "fake-dir.wasm", invocations: [] },
        "path:fixtures.json",
      ),
    ).toThrow(
      /Contract path:fixtures\.json \/ id:dir-contract: WASM path is not a regular file/,
    );
  });

  it("rejects files without valid WASM magic header with logical context", () => {
    const invalidPath = path.join(tmpDir, "invalid.wasm");
    fs.writeFileSync(invalidPath, Buffer.from("not-a-wasm-binary-header"));

    expect(() =>
      validateContractArtifact(
        tmpDir,
        { id: "bad-header", wasm_path: "invalid.wasm", invocations: [] },
        "path:fixtures.json",
      ),
    ).toThrow(
      /Contract path:fixtures\.json \/ id:bad-header: Invalid WASM module at .* missing or invalid WebAssembly binary header/,
    );
  });

  it("rejects files truncated to less than 8 bytes with logical context", () => {
    const shortPath = path.join(tmpDir, "short.wasm");
    fs.writeFileSync(shortPath, Buffer.from([0, 97, 115]));

    expect(() =>
      validateContractArtifact(
        tmpDir,
        { id: "short-header", wasm_path: "short.wasm", invocations: [] },
        "path:fixtures.json",
      ),
    ).toThrow(
      /Contract path:fixtures\.json \/ id:short-header: Invalid WASM module at .* missing or invalid WebAssembly binary header/,
    );
  });

  it("preflightContractArtifacts reports all invalid contract declarations together", () => {
    const contracts = [
      { id: "first-bad", wasm_path: "missing1.wasm", invocations: [] },
      { id: "second-bad", wasm_path: "missing2.wasm", invocations: [] },
    ];

    expect(() =>
      preflightContractArtifacts(tmpDir, contracts, "path:suite.json"),
    ).toThrow(/Invalid contract WASM declarations in path:suite\.json/);

    try {
      preflightContractArtifacts(tmpDir, contracts, "path:suite.json");
    } catch (err: any) {
      expect(err.message).toContain("id:first-bad");
      expect(err.message).toContain("id:second-bad");
    }
  });
});
