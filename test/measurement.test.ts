import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMeasurement } from "../src/measurement";
import { rpc, TransactionBuilder, Keypair } from "@stellar/stellar-sdk";
import * as fs from "fs";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

const { getNetworkMock } = vi.hoisted(() => ({ getNetworkMock: vi.fn() }));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  const TransactionBuilderMock = vi.fn();
  TransactionBuilderMock.prototype.addOperation = function () {
    throw new Error("STOP_EXECUTION");
  };
  TransactionBuilderMock.prototype.setTimeout = function () {
    return this;
  };
  TransactionBuilderMock.prototype.build = function () {
    return { hash: () => Buffer.from("tx") };
  };

  const ServerMock = vi.fn();
  ServerMock.prototype.getNetwork = getNetworkMock;
  ServerMock.prototype.getAccount = vi.fn().mockResolvedValue({});
  ServerMock.prototype.getLedgerEntries = vi
    .fn()
    .mockResolvedValue({ entries: [] });
  ServerMock.prototype.prepareTransaction = vi
    .fn()
    .mockResolvedValue({ sign: vi.fn() });
  ServerMock.prototype.sendTransaction = vi
    .fn()
    .mockResolvedValue({ hash: "abc" });
  ServerMock.prototype.getTransaction = vi
    .fn()
    .mockResolvedValue({ status: "SUCCESS" });
  ServerMock.prototype.simulateTransaction = vi.fn().mockResolvedValue({
    results: [{ auth: [], retval: { toXDR: () => Buffer.from("") } }],
    transactionData: { toXDR: () => Buffer.from("") },
    minResourceFee: "100",
  });

  return {
    ...actual,
    TransactionBuilder: TransactionBuilderMock,
    rpc: {
      ...actual.rpc,
      Server: ServerMock,
    },
  };
});

global.fetch = vi.fn().mockResolvedValue({ ok: true });

describe("runMeasurement network passphrase handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getNetworkMock.mockReset();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      if (path.toString().endsWith("fixtures.json")) {
        return JSON.stringify({
          contracts: [
            {
              wasm_path: "test.wasm",
              invocations: [{ function_name: "test", args: [] }],
            },
          ],
        });
      }
      if (path.toString().endsWith(".weighin-temp-key")) {
        return Keypair.random().secret();
      }
      return "";
    });
  });

  it("uses Standalone passphrase", async () => {
    getNetworkMock.mockResolvedValue({
      passphrase: "Standalone Network ; February 2017",
      friendbotUrl: "",
      protocolVersion: 20,
    });

    await expect(
      runMeasurement({
        fixturesPath: "fixtures.json",
        gitCommit: "abc",
        sdkVersion: "1.0",
        rpcUrl: "http://localhost:8000",
      }),
    ).rejects.toThrow("STOP_EXECUTION");

    expect(vi.mocked(TransactionBuilder).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        networkPassphrase: "Standalone Network ; February 2017",
      }),
    );
  });

  it("uses Testnet passphrase", async () => {
    getNetworkMock.mockResolvedValue({
      passphrase: "Test SDF Network ; September 2015",
      friendbotUrl: "",
      protocolVersion: 20,
    });

    await expect(
      runMeasurement({
        fixturesPath: "fixtures.json",
        gitCommit: "abc",
        sdkVersion: "1.0",
        rpcUrl: "http://testnet",
      }),
    ).rejects.toThrow("STOP_EXECUTION");

    expect(vi.mocked(TransactionBuilder).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
    );
  });

  it("uses Futurenet passphrase", async () => {
    getNetworkMock.mockResolvedValue({
      passphrase: "Test SDF Future Network ; October 2022",
      friendbotUrl: "",
      protocolVersion: 20,
    });

    await expect(
      runMeasurement({
        fixturesPath: "fixtures.json",
        gitCommit: "abc",
        sdkVersion: "1.0",
        rpcUrl: "http://futurenet",
      }),
    ).rejects.toThrow("STOP_EXECUTION");

    expect(vi.mocked(TransactionBuilder).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        networkPassphrase: "Test SDF Future Network ; October 2022",
      }),
    );
  });

  it("throws when getNetwork fails", async () => {
    getNetworkMock.mockRejectedValue(new Error("RPC down"));

    await expect(
      runMeasurement({
        fixturesPath: "fixtures.json",
        gitCommit: "abc",
        sdkVersion: "1.0",
      }),
    ).rejects.toThrow(/Failed to fetch network info from RPC.*RPC down/);
  });
});
