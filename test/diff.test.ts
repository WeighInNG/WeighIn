import { describe, it, expect } from "vitest";
import { diffBenchmarks } from "../src/diff";
import { ContractBenchmark, Metrics } from "../src/measurement";

function createMetrics(consumed: number, limit: number = 0): Metrics {
  return {
    cpu_instructions: { consumed, limit },
    memory_bytes: { consumed, limit },
    ledger_read_entries: { consumed, limit },
    ledger_read_bytes: { consumed, limit },
    ledger_write_entries: { consumed, limit },
    ledger_write_bytes: { consumed, limit },
    historical_data_read_bytes: { consumed, limit },
    contract_data_hard_limit: { consumed, limit },
    tx_size_bytes: { consumed, limit },
    events_count: { consumed, limit },
    event_data_bytes: { consumed, limit },
  };
}

describe("diffBenchmarks", () => {
  it("handles identical baseline and head", () => {
    const metrics = createMetrics(100);
    const base: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [{ function_name: "test", wasm_sha256: "xyz", metrics }],
      },
    ];
    const head: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [{ function_name: "test", wasm_sha256: "xyz", metrics }],
      },
    ];

    const diff = diffBenchmarks(base, head);

    expect(diff.hasRegression).toBe(false);
    expect(diff.newContracts).toEqual([]);
    expect(diff.removedContracts).toEqual([]);
    expect(diff.contracts).toHaveLength(1);

    const fns = diff.contracts[0].functions;
    expect(fns).toHaveLength(1);
    expect(fns[0].hasRegression).toBe(false);

    const cpuDiff = fns[0].metrics.find((m) => m.key === "cpu_instructions");
    expect(cpuDiff?.delta).toBe(0);
    expect(cpuDiff?.pct).toBe(0);
    expect(cpuDiff?.regression).toBe(false);
  });

  it("handles positive resource change (regression)", () => {
    const base: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
    ];
    const head: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(110),
          },
        ],
      },
    ];

    const diff = diffBenchmarks(base, head);
    expect(diff.hasRegression).toBe(true);

    const cpuDiff = diff.contracts[0].functions[0].metrics.find(
      (m) => m.key === "cpu_instructions",
    );
    expect(cpuDiff?.delta).toBe(10);
    expect(cpuDiff?.pct).toBe(10);
    expect(cpuDiff?.regression).toBe(true);
  });

  it("handles negative resource change (improvement)", () => {
    const base: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
    ];
    const head: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(90),
          },
        ],
      },
    ];

    const diff = diffBenchmarks(base, head);
    expect(diff.hasRegression).toBe(false);

    const cpuDiff = diff.contracts[0].functions[0].metrics.find(
      (m) => m.key === "cpu_instructions",
    );
    expect(cpuDiff?.delta).toBe(-10);
    expect(cpuDiff?.pct).toBe(-10);
    expect(cpuDiff?.regression).toBe(false);
  });

  it("handles zero base values gracefully", () => {
    const base: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(0),
          },
        ],
      },
    ];
    const head: ContractBenchmark[] = [
      {
        contract_id: "contract-a",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(10),
          },
        ],
      },
    ];

    const diff = diffBenchmarks(base, head);
    expect(diff.hasRegression).toBe(true);

    const cpuDiff = diff.contracts[0].functions[0].metrics.find(
      (m) => m.key === "cpu_instructions",
    );
    expect(cpuDiff?.delta).toBe(10);
    expect(cpuDiff?.pct).toBeNull(); // should be null to avoid division by zero
    expect(cpuDiff?.regression).toBe(true);
  });

  it("identifies new and removed functions and contracts", () => {
    const base: ContractBenchmark[] = [
      {
        contract_id: "contract-base-only",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
      {
        contract_id: "contract-shared",
        git_commit: "abc",
        soroban_sdk_version: "1.0",
        timestamp: 0,
        benchmarks: [
          {
            function_name: "removed-fn",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
    ];
    const head: ContractBenchmark[] = [
      {
        contract_id: "contract-head-only",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [
          {
            function_name: "test",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
      {
        contract_id: "contract-shared",
        git_commit: "def",
        soroban_sdk_version: "1.0",
        timestamp: 1,
        benchmarks: [
          {
            function_name: "new-fn",
            wasm_sha256: "xyz",
            metrics: createMetrics(100),
          },
        ],
      },
    ];

    const diff = diffBenchmarks(base, head);
    expect(diff.newContracts).toEqual(["contract-head-only"]);
    expect(diff.removedContracts).toEqual(["contract-base-only"]);

    expect(diff.contracts).toHaveLength(1);
    expect(diff.contracts[0].contract_id).toBe("contract-shared");
    expect(diff.contracts[0].newFunctions).toEqual(["new-fn"]);
    expect(diff.contracts[0].removedFunctions).toEqual(["removed-fn"]);
  });
});
