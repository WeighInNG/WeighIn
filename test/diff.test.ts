import { describe, it, expect } from "vitest";
import {
  diffBenchmarks,
  calculateDiff,
  formatDiffDelta,
  getMetricBadge,
} from "../src/diff";
import {
  trend,
  fmtDelta,
  fmtPct,
  renderFunctionTable,
  renderComment,
} from "../src/comment";
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

  describe("calculateDiff and zero-delta formatting (#317)", () => {
    it("calculateDiff aliases diffBenchmarks and preserves diff structure", () => {
      const base: ContractBenchmark[] = [
        {
          contract_id: "c1",
          git_commit: "abc",
          soroban_sdk_version: "1.0",
          timestamp: 0,
          benchmarks: [
            {
              function_name: "noop",
              wasm_sha256: "h1",
              metrics: createMetrics(500),
            },
          ],
        },
      ];
      const head: ContractBenchmark[] = [
        {
          contract_id: "c1",
          git_commit: "def",
          soroban_sdk_version: "1.0",
          timestamp: 1,
          benchmarks: [
            {
              function_name: "noop",
              wasm_sha256: "h1",
              metrics: createMetrics(500),
            },
          ],
        },
      ];

      const diff = calculateDiff(base, head);
      expect(diff.hasRegression).toBe(false);
      expect(diff.contracts).toHaveLength(1);
      expect(diff.contracts[0].functions[0].metrics[0].delta).toBe(0);
    });

    it("formats zero delta cleanly as 0 (0.00%) or - without signs", () => {
      // Default zero-delta display
      expect(formatDiffDelta(0, 0)).toBe("0 (0.00%)");
      expect(formatDiffDelta(0, 0.0)).toBe("0 (0.00%)");

      // Zero delta with dash option
      expect(formatDiffDelta(0, 0, { zeroAsDash: true })).toBe("-");

      // Positive change
      expect(formatDiffDelta(50, 10)).toBe("+50 (+10.00%)");

      // Negative change (improvement)
      expect(formatDiffDelta(-25, -5)).toBe("-25 (-5.00%)");
    });

    it("ensures status indicator is neutral for zero deltas (e.g. ▫️ or ⚪)", () => {
      expect(getMetricBadge(0)).toBe("⚪");
      expect(getMetricBadge(0, { style: "neutral_symbol" })).toBe("▫️");
      expect(trend(0)).toBe("⚪");
    });

    it("strictly prevents negative zero (-0% or -0) from displaying", () => {
      // -0 float
      const negZero = -0;
      expect(formatDiffDelta(negZero, negZero)).toBe("0 (0.00%)");
      expect(formatDiffDelta(negZero, negZero, { zeroAsDash: true })).toBe("-");

      // Rounding artifact like -0.0001%
      expect(formatDiffDelta(0, -0.0001)).toBe("0 (0.00%)");

      // fmtDelta and fmtPct in comment helpers
      expect(fmtDelta(negZero)).toBe("±0");
      expect(fmtPct(negZero)).toBe("—");
      expect(fmtPct(-0.001)).toBe("—");
      expect(fmtPct(0)).not.toContain("-0");
    });

    it("table rendering helpers cleanly render zero changes in markdown", () => {
      const base: ContractBenchmark[] = [
        {
          contract_id: "c1",
          git_commit: "abc",
          soroban_sdk_version: "1.0",
          timestamp: 0,
          benchmarks: [
            {
              function_name: "stable_fn",
              wasm_sha256: "h1",
              metrics: createMetrics(2000, 50000),
            },
          ],
        },
      ];
      const head: ContractBenchmark[] = [
        {
          contract_id: "c1",
          git_commit: "def",
          soroban_sdk_version: "1.0",
          timestamp: 1,
          benchmarks: [
            {
              function_name: "stable_fn",
              wasm_sha256: "h1",
              metrics: createMetrics(2000, 50000),
            },
          ],
        },
      ];

      const diff = diffBenchmarks(base, head);
      const table = renderFunctionTable(diff.contracts[0].functions[0]);

      // Verify clean zero delta representation in table rows
      expect(table).toContain(
        "| ⚪ | CPU Instructions | 2,000 | 2,000 | ±0 | — | 50,000 |",
      );
      expect(table).toContain(
        "| ⚪ | Memory Bytes | 2,000 | 2,000 | ±0 | — | 50,000 |",
      );
      expect(table).not.toContain("-0");
      expect(table).not.toContain("-0.0%");
    });
  });

  describe("positive and negative regression emoji badges (#318)", () => {
    it("assigns green improvement badge for CPU and Memory reductions", () => {
      // Reductions in CPU (-500) and Memory (-1024)
      expect(getMetricBadge(-500)).toBe("🟢");
      expect(getMetricBadge(-1024)).toBe("🟢");
      expect(trend(-500)).toBe("🟢");
      expect(trend(-1024)).toBe("🟢");
    });

    it("assigns neutral indicator for unchanged metrics", () => {
      expect(getMetricBadge(0)).toBe("⚪");
      expect(trend(0)).toBe("⚪");
    });

    it("assigns warning indicator for regressions within threshold", () => {
      // Regression within threshold (e.g. allowed increase)
      expect(getMetricBadge(100, { withinThreshold: true })).toBe("⚠️");
    });

    it("assigns failure alert badge for regressions exceeding threshold", () => {
      // Regression exceeding threshold (or default unconstrained regression)
      expect(getMetricBadge(100, { withinThreshold: false })).toBe("🔴");
      expect(getMetricBadge(50)).toBe("🔴");
      expect(trend(50)).toBe("🔴");
    });

    it("verifies markdown output strings in function table and comment for all badge types", () => {
      // Contract with improvement, unchanged, and regression metrics
      const baseMetrics = createMetrics(1000);
      const headMetrics = createMetrics(1000);
      headMetrics.cpu_instructions.consumed = 900; // -100 improvement
      headMetrics.memory_bytes.consumed = 1200; // +200 regression
      headMetrics.tx_size_bytes.consumed = 1000; // 0 unchanged

      const base: ContractBenchmark[] = [
        {
          contract_id: "badge-contract",
          git_commit: "base",
          soroban_sdk_version: "1.0",
          timestamp: 0,
          benchmarks: [
            {
              function_name: "badge_test",
              wasm_sha256: "w1",
              metrics: baseMetrics,
            },
          ],
        },
      ];
      const head: ContractBenchmark[] = [
        {
          contract_id: "badge-contract",
          git_commit: "head",
          soroban_sdk_version: "1.0",
          timestamp: 1,
          benchmarks: [
            {
              function_name: "badge_test",
              wasm_sha256: "w1",
              metrics: headMetrics,
            },
          ],
        },
      ];

      const diff = diffBenchmarks(base, head);
      const fnTable = renderFunctionTable(diff.contracts[0].functions[0]);

      // Green improvement badge
      expect(fnTable).toContain(
        "| 🟢 | CPU Instructions | 1,000 | 900 | -100 | -10.0% |",
      );
      // Red regression badge
      expect(fnTable).toContain(
        "| 🔴 | Memory Bytes | 1,000 | 1,200 | +200 | +20.0% |",
      );
      // Neutral unchanged badge
      expect(fnTable).toContain(
        "| ⚪ | Tx Size Bytes | 1,000 | 1,000 | ±0 | — |",
      );

      // Full comment verification with violation exceeding threshold
      const violation = {
        contract_id: "badge-contract",
        function_name: "badge_test",
        metric: "memory_bytes" as const,
        delta: 200,
        pct: 20,
        rule: "strict_zero_tolerance",
        message: "Memory limit exceeded by 20%",
      };
      const commentWithViolation = renderComment(
        diff,
        [violation],
        "main",
        "headsha123",
      );
      expect(commentWithViolation).toContain("## 🔴 WeighIn Benchmark Report");
      expect(commentWithViolation).toContain("### ❌ Violations");
      expect(commentWithViolation).toContain("Memory limit exceeded by 20%");

      // Full comment verification without violation (all passed or within threshold)
      const commentPassed = renderComment(diff, [], "main", "headsha123");
      expect(commentPassed).toContain("## 🟢 WeighIn Benchmark Report");
      expect(commentPassed).toContain("**All thresholds passed**");
      expect(commentPassed).not.toContain("### ❌ Violations");
    });
  });
});
