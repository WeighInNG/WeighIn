import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { toScVal, resolveWasmPath } from "../src/measurement";
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

describe("resolveWasmPath cross-target substitution control", () => {
  let tmpDir: string;
  let unknownUnknownPath: string;
  let v1NonePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-wasm-test-"));
    const unknownDir = path.join(
      tmpDir,
      "target",
      "wasm32-unknown-unknown",
      "release",
    );
    const v1Dir = path.join(tmpDir, "target", "wasm32v1-none", "release");
    fs.mkdirSync(unknownDir, { recursive: true });
    fs.mkdirSync(v1Dir, { recursive: true });
    unknownUnknownPath = path.join(unknownDir, "contract.wasm");
    v1NonePath = path.join(v1Dir, "contract.wasm");
  });

  afterEach(() => {
    delete process.env.WEIGHIN_ALLOW_CROSS_TARGET_SUBSTITUTION;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns declared path when artifact exists", () => {
    fs.writeFileSync(unknownUnknownPath, "wasm-bytes");
    const resolved = resolveWasmPath(
      tmpDir,
      "target/wasm32-unknown-unknown/release/contract.wasm",
    );
    expect(resolved).toBe(unknownUnknownPath);
  });

  it("fails by default when declared artifact is missing even if cross-target exists", () => {
    fs.writeFileSync(v1NonePath, "wasm-bytes");
    expect(() =>
      resolveWasmPath(
        tmpDir,
        "target/wasm32-unknown-unknown/release/contract.wasm",
      ),
    ).toThrow(
      /WASM not found[\s\S]*Build the contract before running measurements/,
    );
  });

  it("substitutes cross-target artifact when allowCrossTargetSubstitution option is true", () => {
    fs.writeFileSync(v1NonePath, "wasm-bytes");
    const resolved = resolveWasmPath(
      tmpDir,
      "target/wasm32-unknown-unknown/release/contract.wasm",
      { allowCrossTargetSubstitution: true },
    );
    expect(resolved).toBe(v1NonePath);
  });

  it("substitutes cross-target artifact when WEIGHIN_ALLOW_CROSS_TARGET_SUBSTITUTION env var is set", () => {
    fs.writeFileSync(unknownUnknownPath, "wasm-bytes");
    process.env.WEIGHIN_ALLOW_CROSS_TARGET_SUBSTITUTION = "true";
    const resolved = resolveWasmPath(
      tmpDir,
      "target/wasm32v1-none/release/contract.wasm",
    );
    expect(resolved).toBe(unknownUnknownPath);
  });

  it("fails when both declared and cross-target artifacts are missing even with opt-in", () => {
    expect(() =>
      resolveWasmPath(
        tmpDir,
        "target/wasm32-unknown-unknown/release/contract.wasm",
        { allowCrossTargetSubstitution: true },
      ),
    ).toThrow(
      /WASM not found[\s\S]*Build the contract before running measurements/,
    );
  });

  it("fails immediately when artifact without target dir is missing even with opt-in", () => {
    expect(() =>
      resolveWasmPath(tmpDir, "custom/build/contract.wasm", {
        allowCrossTargetSubstitution: true,
      }),
    ).toThrow(/WASM not found/);
  });
});
