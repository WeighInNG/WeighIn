import { describe, it, expect } from "vitest";
import {
  buildPrMetadata,
  parsePrMetadata,
  PR_METADATA_SCHEMA_VERSION,
  validateReportArtifact,
} from "../src/pr-metadata";
import { COMMENT_MARKER, renderComment } from "../src/comment";

const headSha = "f".repeat(40);

describe("buildPrMetadata", () => {
  it("emits the versioned producer shape", () => {
    expect(buildPrMetadata("WeighInNG/WeighIn", 27, headSha)).toEqual({
      schemaVersion: PR_METADATA_SCHEMA_VERSION,
      repository: "WeighInNG/WeighIn",
      prNumber: 27,
      headSha,
    });
  });
});

describe("parsePrMetadata", () => {
  it("round-trips a producer artifact for the trusted repository", () => {
    const raw = JSON.stringify(
      buildPrMetadata("WeighInNG/WeighIn", 27, headSha),
    );
    expect(parsePrMetadata(raw, "WeighInNG/WeighIn")).toEqual({
      schemaVersion: 1,
      repository: "WeighInNG/WeighIn",
      prNumber: 27,
      headSha,
    });
  });

  it("matches the trusted repository case-insensitively", () => {
    const raw = JSON.stringify(
      buildPrMetadata("weighinng/weighin", 27, headSha),
    );
    expect(parsePrMetadata(raw, "WeighInNG/WeighIn").prNumber).toBe(27);
  });

  it("rejects unsupported metadata before returning a number", () => {
    const cases: Array<[string, string]> = [
      ["malformed JSON", "{ not json"],
      ["legacy unversioned metadata", JSON.stringify({ prNumber: 27 })],
      [
        "unsupported schema version",
        JSON.stringify({
          ...buildPrMetadata("WeighInNG/WeighIn", 27, headSha),
          schemaVersion: 2,
        }),
      ],
      [
        "another repository",
        JSON.stringify(buildPrMetadata("attacker/WeighIn", 27, headSha)),
      ],
      [
        "string PR number",
        JSON.stringify({
          ...buildPrMetadata("WeighInNG/WeighIn", 27, headSha),
          prNumber: "27",
        }),
      ],
      [
        "malformed SHA",
        JSON.stringify({
          ...buildPrMetadata("WeighInNG/WeighIn", 27, headSha),
          headSha: "abc",
        }),
      ],
    ];
    for (const [label, raw] of cases) {
      expect(() => parsePrMetadata(raw, "WeighInNG/WeighIn"), label).toThrow();
    }
  });
});

describe("validateReportArtifact", () => {
  it("accepts renderer-produced passing and failing reports without altering bytes", () => {
    const diff = {
      contracts: [],
      hasRegression: false,
      newContracts: [],
      removedContracts: [],
    };
    const passing = renderComment(diff, [], "main", headSha);
    expect(validateReportArtifact(passing)).toBe(passing);

    const failing = renderComment(
      diff,
      [
        {
          contract_id: "greeting",
          function_name: "hello",
          metric: "cpu_instructions",
          delta: 10,
          pct: 10,
          rule: "strict_zero_tolerance",
          message: "Fail msg",
        },
      ],
      "main",
      headSha,
    );
    expect(validateReportArtifact(failing)).toBe(failing);
  });

  it("rejects empty, whitespace-only, marker-only, missing-marker and missing-heading payloads", () => {
    expect(() => validateReportArtifact("")).toThrow(
      /Report artifact is empty/,
    );
    expect(() => validateReportArtifact("   \n\t  ")).toThrow(
      /Report artifact contains only whitespace/,
    );
    expect(() => validateReportArtifact(COMMENT_MARKER)).toThrow(
      /Report artifact contains only the report marker/,
    );
    expect(() => validateReportArtifact(`  ${COMMENT_MARKER}\n\n`)).toThrow(
      /Report artifact contains only the report marker/,
    );
    expect(() =>
      validateReportArtifact(
        "## 🟢 WeighIn Benchmark Report\n\n**All thresholds passed**\n",
      ),
    ).toThrow(/Report artifact is missing required marker/);
    expect(() =>
      validateReportArtifact(
        "<!-- weighin-comment -->\n# Resource report\nCPU instructions: 565371\n",
      ),
    ).toThrow(/Report artifact is missing required marker/);
    expect(() =>
      validateReportArtifact(
        `${COMMENT_MARKER}\n# Resource report\nCPU instructions: 565371\n`,
      ),
    ).toThrow(
      /Report artifact is missing required WeighIn Benchmark Report heading/,
    );
  });
});
