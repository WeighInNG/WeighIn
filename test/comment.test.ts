import { describe, it, expect } from "vitest";
import { renderComment } from "../src/comment";
import { DiffResult } from "../src/diff";
import { Violation } from "../src/threshold";

function createMockDiff(regression: boolean): DiffResult {
  return {
    contracts: [
      {
        fixture_id: "path:fixtures.json",
        logical_id: "id:contract-a",
        contract_id: "contract-a",
        base_contract_id: "base-contract-a",
        head_contract_id: "contract-a",
        base_commit: "abc",
        head_commit: "def",
        hasRegression: regression,
        newFunctions: [],
        removedFunctions: [],
        newBenchmarks: [],
        removedBenchmarks: [],
        functions: [
          {
            function_name: "test-fn",
            hasRegression: regression,
            metrics: [
              {
                key: "cpu_instructions",
                base: { consumed: 100, limit: 1000 },
                head: { consumed: regression ? 110 : 100, limit: 1000 },
                delta: regression ? 10 : 0,
                pct: regression ? 10 : 0,
                regression,
              },
            ],
          },
        ],
      },
    ],
    hasRegression: regression,
    newContracts: [],
    removedContracts: [],
  };
}

describe("renderComment", () => {
  it("renders a success status when no regressions and no violations", () => {
    const diff = createMockDiff(false);
    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("🟢");
    expect(comment).toContain("**All thresholds passed**");
  });

  it("renders a success status when there are regressions but no threshold violations", () => {
    const diff = createMockDiff(true);
    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("🟢");
    expect(comment).toContain("**All thresholds passed**");
    expect(comment).toContain(
      "🔴 | CPU Instructions | 100 | 110 | +10 | +10.0% | 1,000 |",
    );
  });

  it("renders a failure status when threshold violations exist", () => {
    const diff = createMockDiff(true);
    const violation: Violation = {
      contract_id: "contract-a",
      function_name: "test-fn",
      metric: "cpu_instructions",
      delta: 10,
      pct: 10,
      rule: "strict_zero_tolerance",
      message: "Fail msg",
    };
    const comment = renderComment(diff, [violation], "main", "abcdef123");
    expect(comment).toContain("🔴");
    expect(comment).toContain("**1 threshold violation**");
    expect(comment).toContain("### ❌ Violations");
    expect(comment).toContain("Fail msg");
  });

  it("keeps primary evidence visible inline with source details in the report body", () => {
    const diff = createMockDiff(true);
    const fn = diff.contracts[0].functions[0];
    fn.case_id = "args:[]";
    fn.base_provenance = {
      source: "soroban-simulation",
      source_version: "28.0.1",
      protocol: 28,
      helper_sha256: "a".repeat(64),
      network_id: "test-network",
      ledger: 229,
      header_sha256: "b".repeat(64),
      snapshot_sha256: "c".repeat(64),
      config_sha256: "d".repeat(64),
      compute_config_sha256: "e".repeat(64),
      input_sha256: "f".repeat(64),
      seed: [],
      auth_mode: "recording",
      host_features: [],
      resource_limits_sha256: "1".repeat(64),
    };
    fn.head_provenance = {
      ...fn.base_provenance,
      ledger: 230,
      helper_sha256: "2".repeat(64),
      snapshot_sha256: "3".repeat(64),
      config_sha256: "4".repeat(64),
      compute_config_sha256: "5".repeat(64),
      input_sha256: "6".repeat(64),
      resource_limits_sha256: "7".repeat(64),
    };
    fn.metrics[0].head.source = "simulated_instructions";
    fn.metrics[0].head.limit_source = "protocol_limit";
    fn.metrics.push({
      key: "memory_bytes",
      base: { consumed: null, limit: null, reason: "Unavailable in BASE" },
      head: {
        consumed: null,
        limit: null,
        reason: "Unsupported by this simulator",
        source: "native-memory-meter",
        limit_reason: "No independent cap",
      },
      availability: "unavailable",
      reason: "BASE: Unavailable in BASE; HEAD: Unsupported by this simulator",
      delta: null,
      pct: null,
      regression: false,
    });

    const report = renderComment(
      diff,
      [
        {
          contract_id: "contract-a",
          function_name: "test-fn",
          case_id: "args:[]",
          metric: "cpu_instructions",
          delta: 10,
          pct: 10,
          rule: "strict_zero_tolerance",
          message: "CPU policy breach",
        },
      ],
      "main",
      "abcdef123",
    );

    expect(report).toContain(
      "Compute source: soroban-simulation 28.0.1; protocol 28.",
    );
    expect(report).toContain("CPU policy breach");
    expect(report).toContain(
      "| 🔴 | CPU Instructions | 100 | 110 | +10 | +10.0% | 1,000 |",
    );
    expect(report).toContain("Unsupported by this simulator");
    expect(report).toContain(
      "Snapshot ledgers: BASE 229 → HEAD 230; compute config SHA256:",
    );
    expect(report).toContain("No independent cap");
    expect(report).toContain("simulated_instructions");
    expect(report).toContain("native-memory-meter");
    expect(report).not.toContain("<details><summary>Snapshot and metric provenance</summary>");
  });

  it("renders legacy records without provenance as a normal Markdown table", () => {
    const report = renderComment(
      createMockDiff(false),
      [],
      "main",
      "abcdef123",
    );
    expect(report).toContain(
      "| | Metric | Base | Head | Delta | Change | Limit |",
    );
    expect(report).toContain("#### `test-fn`");
    expect(report).not.toContain("Snapshot and metric provenance");
    expect(report).toContain("<!-- weighin-report -->");
  });

  it("formats missing functions and contracts", () => {
    const diff = createMockDiff(false);
    diff.newContracts.push("new-contract");
    diff.removedContracts.push("old-contract");
    diff.contracts[0].newBenchmarks.push({
      function_name: "new-fn",
      case_id: "args:[]",
    });
    diff.contracts[0].removedBenchmarks.push({
      function_name: "old-fn",
      case_id: "args:[]",
    });

    const comment = renderComment(diff, [], "main", "abcdef123");
    expect(comment).toContain("new-contract");
    expect(comment).toContain("old-contract");
    expect(comment).toContain("new-fn");
    expect(comment).toContain("old-fn");
  });

  it("renders byte-identical output for equivalent reordered contracts and functions without mutating inputs", () => {
    const fn1 = {
      function_name: "alpha_fn",
      case_id: "id:case-1",
      hasRegression: false,
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 100, limit: 1000 },
          head: { consumed: 100, limit: 1000 },
          delta: 0,
          pct: 0,
          regression: false,
        },
      ],
    };
    const fn2 = {
      function_name: "beta_fn",
      case_id: "id:case-2",
      hasRegression: false,
      metrics: [
        {
          key: "cpu_instructions" as const,
          base: { consumed: 200, limit: 1000 },
          head: { consumed: 200, limit: 1000 },
          delta: 0,
          pct: 0,
          regression: false,
        },
      ],
    };

    const contractA = {
      fixture_id: "path:fixtures-a.json",
      logical_id: "id:contract-a",
      contract_id: "CAAA",
      base_contract_id: "base-CAAA",
      head_contract_id: "CAAA",
      base_commit: "abc",
      head_commit: "def",
      hasRegression: false,
      newFunctions: [],
      removedFunctions: [],
      newBenchmarks: [
        { function_name: "new_b", case_id: "id:1" },
        { function_name: "new_a", case_id: "id:1" },
      ],
      removedBenchmarks: [
        { function_name: "rem_b", case_id: "id:1" },
        { function_name: "rem_a", case_id: "id:1" },
      ],
      functions: [fn2, fn1],
    };

    const contractB = {
      fixture_id: "path:fixtures-b.json",
      logical_id: "id:contract-b",
      contract_id: "CBBB",
      base_contract_id: "base-CBBB",
      head_contract_id: "CBBB",
      base_commit: "abc",
      head_commit: "def",
      hasRegression: false,
      newFunctions: [],
      removedFunctions: [],
      newBenchmarks: [],
      removedBenchmarks: [],
      functions: [fn1],
    };

    const diff1: DiffResult = {
      contracts: [contractB, contractA],
      hasRegression: false,
      newContracts: ["zeta_contract", "alpha_contract"],
      removedContracts: ["theta_contract", "beta_contract"],
    };

    const diff2: DiffResult = {
      contracts: [
        {
          ...contractA,
          newBenchmarks: [
            { function_name: "new_a", case_id: "id:1" },
            { function_name: "new_b", case_id: "id:1" },
          ],
          removedBenchmarks: [
            { function_name: "rem_a", case_id: "id:1" },
            { function_name: "rem_b", case_id: "id:1" },
          ],
          functions: [fn1, fn2],
        },
        contractB,
      ],
      hasRegression: false,
      newContracts: ["alpha_contract", "zeta_contract"],
      removedContracts: ["beta_contract", "theta_contract"],
    };

    const violations1: Violation[] = [
      {
        contract_id: "CAAA",
        function_name: "beta_fn",
        metric: "memory_bytes",
        delta: 5,
        pct: 5,
        rule: "strict_zero_tolerance",
        message: "viol 2",
      },
      {
        contract_id: "CAAA",
        function_name: "alpha_fn",
        metric: "cpu_instructions",
        delta: 10,
        pct: 10,
        rule: "strict_zero_tolerance",
        message: "viol 1",
      },
    ];

    const violations2: Violation[] = [violations1[1], violations1[0]];

    const comment1 = renderComment(diff1, violations1, "main", "abcdef123");
    const comment2 = renderComment(diff2, violations2, "main", "abcdef123");

    expect(comment1).toBe(comment2);

    // Verify inputs were not mutated
    expect(diff1.contracts[0].contract_id).toBe("CBBB");
    expect(violations1[0].function_name).toBe("beta_fn");
  });
});
