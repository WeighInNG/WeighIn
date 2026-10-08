import { describe, it, expect } from "vitest";
import { toScVal } from "../src/measurement";
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
