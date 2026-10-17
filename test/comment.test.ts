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

  it("collapses verbose provenance hashes and metric sources into expandable details while keeping summary evidence visible", () => {
    const diff = createMockDiff(true);
    const fn = diff.contracts[0].functions[0];
    fn.case_id = "id:case-1";
    fn.base_provenance = {
      source: "soroban-simulation",
      source_version: "28.0.1",
      protocol: 28,
      helper_sha256: "helper-hash-base",
      network_id: "local-net",
      ledger: 100,
      header_sha256: "header-base",
      snapshot_sha256: "snap-base",
      config_sha256: "cfg-base-sha",
      compute_config_sha256: "compute-cfg-sha",
      resource_limits_sha256: "limits-sha-256",
      input_sha256: "input-base",
      seed: [0],
      auth_mode: "recording(true,true)",
      host_features: ["recording_mode", "testutils"],
    };
    fn.head_provenance = {
      ...fn.base_provenance,
      ledger: 105,
      config_sha256: "cfg-head-sha",
      helper_sha256: "helper-hash-head",
    };
    fn.metrics = [
      {
        key: "cpu_instructions",
        availability: "comparable",
        base: {
          consumed: 100,
          limit: 1000,
          source: "soroban-simulation.simulated_instructions",
          limit_source: "ConfigSettingContractComputeV0.txMaxInstructions",
        },
        head: {
          consumed: 110,
          limit: 1000,
          source: "soroban-simulation.simulated_instructions",
          limit_source: "ConfigSettingContractComputeV0.txMaxInstructions",
        },
        delta: 10,
        pct: 10,
        regression: true,
      },
      {
        key: "historical_data_read_bytes",
        availability: "unavailable",
        reason: "No verified consumption source",
        base: { consumed: null, limit: null },
        head: { consumed: null, limit: null },
        delta: null,
        pct: null,
        regression: false,
      },
    ];

    const violation: Violation = {
      logical_id: "id:contract-a",
      contract_id: "contract-a",
      function_name: "test-fn",
      case_id: "id:case-1",
      metric: "cpu_instructions",
      delta: 10,
      pct: 10,
      rule: "strict_zero_tolerance",
      message: "CPU regression exceeded zero tolerance",
    };

    const report = renderComment(diff, [violation], "main", "abcdef123456");
    const visibleOnly = report.replace(/<details>[\s\S]*?<\/details>/g, "");

    expect(visibleOnly).toContain("id:contract-a");
    expect(visibleOnly).toContain("#### `test-fn / id:case-1`");
    expect(visibleOnly).toContain(
      "Compute source: soroban-simulation 28.0.1; protocol 28.",
    );
    expect(visibleOnly).toContain(
      "| 🔴 | CPU Instructions | 100 | 110 | +10 | +10.0% | 1,000 |",
    );
    expect(visibleOnly).toContain(
      "- **Historical Read Bytes unavailable**: No verified consumption source",
    );
    expect(visibleOnly).toContain("### ❌ Violations");
    expect(visibleOnly).toContain("CPU regression exceeded zero tolerance");

    expect(visibleOnly).not.toContain("Snapshot ledgers:");
    expect(visibleOnly).not.toContain("compute-cfg-sha");
    expect(visibleOnly).not.toContain("cfg-head-sha");
    expect(visibleOnly).not.toContain("limits-sha-256");
    expect(visibleOnly).not.toContain("helper-hash-head");
    expect(visibleOnly).not.toContain(
      "ConfigSettingContractComputeV0.txMaxInstructions",
    );

    expect(report).toContain(
      "<details><summary>Provenance and metric sources</summary>",
    );
    expect(report).toContain(
      "Snapshot ledgers: BASE 100 → HEAD 105; compute config SHA256: `compute-cfg-sha`.",
    );
    expect(report).toContain(
      "Full config SHA256: BASE `cfg-base-sha` → HEAD `cfg-head-sha`.",
    );
    expect(report).toContain("Resource limits SHA256: `limits-sha-256`.");
    expect(report).toContain("Helper SHA256: `helper-hash-head`.");
    expect(report).toContain(
      "- **CPU Instructions** source: `soroban-simulation.simulated_instructions`; limit: `ConfigSettingContractComputeV0.txMaxInstructions`.",
    );

    const legacyReport = renderComment(
      createMockDiff(false),
      [],
      "main",
      "abcdef123456",
    );
    expect(legacyReport).not.toContain(
      "<details><summary>Provenance and metric sources</summary>",
    );
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
});
