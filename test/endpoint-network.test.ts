import { describe, it, expect } from "vitest";
import {
  validateRpcNetworkMetadata,
  SUPPORTED_NETWORK_PASSPHRASE,
  SUPPORTED_PROTOCOL_VERSION,
} from "../src/endpoint";

describe("validateRpcNetworkMetadata", () => {
  it("accepts valid standalone network metadata and protocol 28", () => {
    const valid = {
      passphrase: "Standalone Network ; February 2017",
      protocolVersion: 28,
    };
    const result = validateRpcNetworkMetadata(valid);
    expect(result.passphrase).toBe(SUPPORTED_NETWORK_PASSPHRASE);
    expect(result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSION);
  });

  it("trims whitespace from valid passphrase", () => {
    const valid = {
      passphrase: "  Standalone Network ; February 2017  ",
      protocolVersion: 28,
    };
    const result = validateRpcNetworkMetadata(valid);
    expect(result.passphrase).toBe(SUPPORTED_NETWORK_PASSPHRASE);
    expect(result.protocolVersion).toBe(28);
  });

  it("rejects missing, null, or empty passphrase", () => {
    expect(() => validateRpcNetworkMetadata(null)).toThrow(
      /missing or empty passphrase/,
    );
    expect(() => validateRpcNetworkMetadata({})).toThrow(
      /missing or empty passphrase/,
    );
    expect(() => validateRpcNetworkMetadata({ passphrase: "" })).toThrow(
      /missing or empty passphrase/,
    );
    expect(() => validateRpcNetworkMetadata({ passphrase: "   " })).toThrow(
      /missing or empty passphrase/,
    );
    expect(() => validateRpcNetworkMetadata({ passphrase: 12345 })).toThrow(
      /missing or empty passphrase/,
    );
  });

  it("rejects unsupported public or testnet network passphrases", () => {
    const testnet = {
      passphrase: "Test SDF Network ; September 2015",
      protocolVersion: 28,
    };
    expect(() => validateRpcNetworkMetadata(testnet)).toThrow(
      /Unsupported network passphrase: "Test SDF Network ; September 2015"/,
    );

    const publicNet = {
      passphrase: "Public Global Stellar Network ; September 2015",
      protocolVersion: 28,
    };
    expect(() => validateRpcNetworkMetadata(publicNet)).toThrow(
      /Unsupported network passphrase: "Public Global Stellar Network ; September 2015"/,
    );

    const custom = {
      passphrase: "Custom Network ; 2026",
      protocolVersion: 28,
    };
    expect(() => validateRpcNetworkMetadata(custom)).toThrow(
      /Unsupported network passphrase: "Custom Network ; 2026"/,
    );
  });

  it("rejects missing, non-integer, or wrong protocolVersion", () => {
    const missingProtocol = {
      passphrase: "Standalone Network ; February 2017",
    };
    expect(() => validateRpcNetworkMetadata(missingProtocol)).toThrow(
      /missing protocolVersion/,
    );

    const nonIntProtocol = {
      passphrase: "Standalone Network ; February 2017",
      protocolVersion: "28",
    };
    expect(() => validateRpcNetworkMetadata(nonIntProtocol)).toThrow(
      /missing protocolVersion/,
    );

    const oldProtocol = {
      passphrase: "Standalone Network ; February 2017",
      protocolVersion: 27,
    };
    expect(() => validateRpcNetworkMetadata(oldProtocol)).toThrow(
      /Unsupported protocol version: 27. WeighIn simulation helper only supports protocol 28/,
    );

    const newProtocol = {
      passphrase: "Standalone Network ; February 2017",
      protocolVersion: 29,
    };
    expect(() => validateRpcNetworkMetadata(newProtocol)).toThrow(
      /Unsupported protocol version: 29. WeighIn simulation helper only supports protocol 28/,
    );
  });
});
