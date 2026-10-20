import { describe, it, expect } from "vitest";
import { toScVal } from "../src/measurement";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import {
  U32_MIN,
  U32_MAX,
  I32_MIN,
  I32_MAX,
  SCSYMBOL_LIMIT,
} from "../src/config";

describe("toScVal", () => {
  it("parses primitives with exact XDR parity against SDK constructors", () => {
    // bool
    expect(toScVal({ type: "bool", value: true }).toXDR("hex")).toBe(
      xdr.ScVal.scvBool(true).toXDR("hex"),
    );
    expect(toScVal({ type: "bool", value: false }).toXDR("hex")).toBe(
      xdr.ScVal.scvBool(false).toXDR("hex"),
    );

    // u32 endpoints & values
    expect(toScVal({ type: "u32", value: U32_MIN }).toXDR("hex")).toBe(
      xdr.ScVal.scvU32(0).toXDR("hex"),
    );
    expect(toScVal({ type: "u32", value: U32_MAX }).toXDR("hex")).toBe(
      xdr.ScVal.scvU32(4294967295).toXDR("hex"),
    );
    expect(toScVal({ type: "u32", value: 123 }).toXDR("hex")).toBe(
      xdr.ScVal.scvU32(123).toXDR("hex"),
    );

    // i32 endpoints & values
    expect(toScVal({ type: "i32", value: I32_MIN }).toXDR("hex")).toBe(
      xdr.ScVal.scvI32(-2147483648).toXDR("hex"),
    );
    expect(toScVal({ type: "i32", value: I32_MAX }).toXDR("hex")).toBe(
      xdr.ScVal.scvI32(2147483647).toXDR("hex"),
    );
    expect(toScVal({ type: "i32", value: 0 }).toXDR("hex")).toBe(
      xdr.ScVal.scvI32(0).toXDR("hex"),
    );
    expect(toScVal({ type: "i32", value: -123 }).toXDR("hex")).toBe(
      xdr.ScVal.scvI32(-123).toXDR("hex"),
    );

    // string
    expect(toScVal({ type: "string", value: "" }).toXDR("hex")).toBe(
      xdr.ScVal.scvString("").toXDR("hex"),
    );
    expect(toScVal({ type: "string", value: "hello world" }).toXDR("hex")).toBe(
      xdr.ScVal.scvString("hello world").toXDR("hex"),
    );

    // symbol (empty string, 32 chars max, valid charset [a-zA-Z0-9_])
    expect(toScVal({ type: "symbol", value: "" }).toXDR("hex")).toBe(
      xdr.ScVal.scvSymbol("").toXDR("hex"),
    );
    expect(toScVal({ type: "symbol", value: "test" }).toXDR("hex")).toBe(
      xdr.ScVal.scvSymbol("test").toXDR("hex"),
    );
    expect(toScVal({ type: "symbol", value: "AaZz_09" }).toXDR("hex")).toBe(
      xdr.ScVal.scvSymbol("AaZz_09").toXDR("hex"),
    );
    const maxSymbol = "A".repeat(SCSYMBOL_LIMIT);
    expect(toScVal({ type: "symbol", value: maxSymbol }).toXDR("hex")).toBe(
      xdr.ScVal.scvSymbol(maxSymbol).toXDR("hex"),
    );
  });

  it("rejects invalid bool values without coercion", () => {
    for (const bad of ["true", "false", 1, 0, null, undefined, {}, []]) {
      expect(() => toScVal({ type: "bool", value: bad as any })).toThrow(
        /Invalid value for bool: must be boolean/,
      );
    }
  });

  it("rejects invalid u32 values (fractional, overflow, wrong-type, nonfinite)", () => {
    // Fractional
    for (const frac of [1.5, 0.1, -0.5, 123.0001]) {
      expect(() => toScVal({ type: "u32", value: frac })).toThrow(
        /Invalid value for u32: must be integer/,
      );
    }

    // Overflow & out of bounds
    for (const out of [-1, -100, 4294967296, 5000000000, 1e40]) {
      expect(() => toScVal({ type: "u32", value: out })).toThrow(
        /Invalid value for u32: out of bounds/,
      );
    }

    // Nonfinite
    for (const nonfinite of [Infinity, -Infinity, NaN]) {
      expect(() => toScVal({ type: "u32", value: nonfinite })).toThrow(
        /Invalid value for u32: must be number/,
      );
    }

    // Wrong type
    for (const wrong of ["123", true, false, null, undefined, {}, []]) {
      expect(() => toScVal({ type: "u32", value: wrong as any })).toThrow(
        /Invalid value for u32: must be number/,
      );
    }
  });

  it("rejects invalid i32 values (fractional, overflow, wrong-type, nonfinite)", () => {
    // Fractional
    for (const frac of [1.5, -1.5, 0.9, -0.1]) {
      expect(() => toScVal({ type: "i32", value: frac })).toThrow(
        /Invalid value for i32: must be integer/,
      );
    }

    // Overflow & out of bounds
    for (const out of [
      2147483648, -2147483649, 3000000000, -3000000000, 1e40, -1e40,
    ]) {
      expect(() => toScVal({ type: "i32", value: out })).toThrow(
        /Invalid value for i32: out of bounds/,
      );
    }

    // Nonfinite
    for (const nonfinite of [Infinity, -Infinity, NaN]) {
      expect(() => toScVal({ type: "i32", value: nonfinite })).toThrow(
        /Invalid value for i32: must be number/,
      );
    }

    // Wrong type
    for (const wrong of ["-123", true, false, null, undefined, {}, []]) {
      expect(() => toScVal({ type: "i32", value: wrong as any })).toThrow(
        /Invalid value for i32: must be number/,
      );
    }
  });

  it("rejects invalid string values without coercion", () => {
    for (const wrong of [123, true, false, null, undefined, {}, []]) {
      expect(() => toScVal({ type: "string", value: wrong as any })).toThrow(
        /Invalid value for string: must be string/,
      );
    }
  });

  it("rejects invalid symbol values obeying pinned Soroban host rules", () => {
    // Wrong type
    for (const wrong of [123, true, false, null, undefined, {}, []]) {
      expect(() => toScVal({ type: "symbol", value: wrong as any })).toThrow(
        /Invalid value for symbol: must be string/,
      );
    }

    // Exceeds 32 bytes (SCSYMBOL_LIMIT)
    const overlong = "a".repeat(33);
    expect(() => toScVal({ type: "symbol", value: overlong })).toThrow(
      /Invalid value for symbol: length exceeds maximum 32 bytes/,
    );

    // Invalid characters outside [a-zA-Z0-9_]
    for (const badChar of [
      "foo-bar",
      "foo bar",
      "foo.bar",
      "foo#bar",
      "foo$bar",
      "foo@bar",
      "foo/bar",
      "foo:bar",
      "foo;bar",
      "hello!",
      "sym?",
      "🚀",
    ]) {
      expect(() => toScVal({ type: "symbol", value: badChar })).toThrow(
        /Invalid value for symbol: contains invalid characters/,
      );
    }
  });

  it("parses large integers safely from strings", () => {
    const u64 = toScVal({ type: "u64", value: "18446744073709551615" });
    expect(u64.switch().name).toBe("scvU64");

    const i128 = toScVal({
      type: "i128",
      value: "-170141183460469231731687303715884105728",
    });
    expect(i128.switch().name).toBe("scvI128");

    expect(() => toScVal({ type: "u64", value: "invalid" })).toThrow(
      /Invalid value for u64/,
    );
  });

  it("parses addresses", () => {
    const valid = Keypair.random().publicKey();
    const addr = toScVal({ type: "address", value: valid });
    expect(addr.switch().name).toBe("scvAddress");

    expect(() => toScVal({ type: "address", value: "invalid" })).toThrow(
      /Invalid value for address/,
    );
    expect(() => toScVal({ type: "address", value: 123 })).toThrow(
      /must be string/,
    );
  });

  it("parses bytes from hex", () => {
    const b = toScVal({ type: "bytes", value: "deadbeef" });
    expect(b.switch().name).toBe("scvBytes");
    expect(b.bytes().toString("hex")).toBe("deadbeef");

    expect(() => toScVal({ type: "bytes", value: "invalid" })).toThrow(
      /valid hex/,
    );
    expect(() => toScVal({ type: "bytes", value: "abc" })).toThrow(
      /even length/,
    );
  });

  it("parses recursive vectors", () => {
    const v = toScVal({
      type: "vec",
      value: [
        { type: "u32", value: 1 },
        { type: "vec", value: [{ type: "bool", value: true }] },
      ],
    });
    expect(v.switch().name).toBe("scvVec");
    const arr = v.vec();
    expect(arr).toBeDefined();
    if (arr) {
      expect(arr[0].switch().name).toBe("scvU32");
      expect(arr[1].switch().name).toBe("scvVec");
    }

    expect(() => toScVal({ type: "vec", value: "not-array" })).toThrow(
      /must be array/,
    );
    expect(() => toScVal({ type: "vec", value: [{ type: "u32" }] })).toThrow(
      /Invalid vector element at index 0/,
    );
  });

  it("parses recursive maps", () => {
    const m = toScVal({
      type: "map",
      value: [
        {
          key: { type: "symbol", value: "foo" },
          value: { type: "u32", value: 42 },
        },
      ],
    });
    expect(m.switch().name).toBe("scvMap");
    const entries = m.map();
    expect(entries).toBeDefined();
    if (entries) {
      expect(entries[0].key().switch().name).toBe("scvSymbol");
      expect(entries[0].val().switch().name).toBe("scvU32");
    }

    expect(() => toScVal({ type: "map", value: "not-array" })).toThrow(
      /must be array/,
    );
    expect(() =>
      toScVal({ type: "map", value: [{ key: { type: "u32", value: 1 } }] }),
    ).toThrow(/Invalid map entry at index 0/);
  });

  it("sorts map entries canonically by key", () => {
    // Deliberately unsorted inputs: c, a, b
    const m = toScVal({
      type: "map",
      value: [
        {
          key: { type: "symbol", value: "c" },
          value: { type: "u32", value: 3 },
        },
        {
          key: { type: "symbol", value: "a" },
          value: { type: "u32", value: 1 },
        },
        {
          key: { type: "symbol", value: "b" },
          value: { type: "u32", value: 2 },
        },
      ],
    });

    expect(m.switch().name).toBe("scvMap");
    const entries = m.map();
    expect(entries).toBeDefined();
    if (entries) {
      // Should be ordered a, b, c
      expect(entries[0].key().sym().toString()).toBe("a");
      expect(entries[1].key().sym().toString()).toBe("b");
      expect(entries[2].key().sym().toString()).toBe("c");
    }
  });

  it("rejects map keys that encode identically", () => {
    // 1. Byte-identical keys
    expect(() =>
      toScVal({
        type: "map",
        value: [
          {
            key: { type: "symbol", value: "dup" },
            value: { type: "u32", value: 1 },
          },
          {
            key: { type: "symbol", value: "dup" },
            value: { type: "u32", value: 2 },
          },
        ],
      }),
    ).toThrow(/Duplicate map key detected at entry 1/);

    // 2. Differently formatted large integers that encode to identical ScVal
    expect(() =>
      toScVal({
        type: "map",
        value: [
          {
            key: { type: "u64", value: "100" },
            value: { type: "u32", value: 1 },
          },
          {
            key: { type: "u64", value: "0100" },
            value: { type: "u32", value: 2 },
          },
        ],
      }),
    ).toThrow(/Duplicate map key detected at entry 1/);

    // 3. Nested map with duplicate keys
    expect(() =>
      toScVal({
        type: "map",
        value: [
          {
            key: { type: "symbol", value: "nested" },
            value: {
              type: "map",
              value: [
                {
                  key: { type: "i32", value: 42 },
                  value: { type: "bool", value: true },
                },
                {
                  key: { type: "i32", value: 42 },
                  value: { type: "bool", value: false },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(/Duplicate map key detected at entry 1/);
  });

  it("permits keys with different ScVal types even if their string representations match", () => {
    // Symbol "test" vs String "test"
    const m = toScVal({
      type: "map",
      value: [
        {
          key: { type: "symbol", value: "test" },
          value: { type: "u32", value: 1 },
        },
        {
          key: { type: "string", value: "test" },
          value: { type: "u32", value: 2 },
        },
      ],
    });
    expect(m.switch().name).toBe("scvMap");
    expect(m.map()?.length).toBe(2);
  });

  it("does not mutate the input fixture when sorting map entries", () => {
    const original = [
      {
        key: { type: "symbol", value: "z" },
        value: { type: "u32", value: 26 },
      },
      { key: { type: "symbol", value: "a" }, value: { type: "u32", value: 1 } },
    ];
    toScVal({ type: "map", value: original });
    expect(original[0].key.value).toBe("z");
    expect(original[1].key.value).toBe("a");
  });
});
