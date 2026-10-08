import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "@actions/exec";
import { buildContracts } from "../src/build";
import { buildForRevision } from "../src/build-selection";

vi.mock("@actions/exec");
vi.mock("../src/build", () => ({
  buildContracts: vi.fn().mockResolvedValue([]),
}));

describe("build selection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the modern Stellar builder by default", async () => {
    await buildForRevision(
      "/workspace/fixtures.json",
      "/workspace",
      "1.95.0",
      "",
      false,
    );
    expect(buildContracts).toHaveBeenCalledWith(
      "/workspace/fixtures.json",
      "1.95.0",
    );
  });

  it("runs the configured custom command in each revision's worktree", async () => {
    vi.mocked(exec.exec).mockResolvedValue(0);
    await buildForRevision(
      "fixtures.json",
      "/base",
      "1.95.0",
      "make contract",
      false,
    );
    expect(exec.exec).toHaveBeenCalledWith(
      "sh",
      ["-c", "make contract"],
      expect.objectContaining({ cwd: "/base" }),
    );
  });

  it("uses configured prebuilt WASM when build is skipped", async () => {
    await buildForRevision("fixtures.json", "/workspace", "1.95.0", "", true);
    expect(exec.exec).not.toHaveBeenCalled();
    expect(buildContracts).not.toHaveBeenCalled();
  });

  it("rejects ambiguous build configuration", async () => {
    await expect(
      buildForRevision("fixtures.json", "/workspace", "", "make", true),
    ).rejects.toThrow(/cannot be used together/);
  });

  it("makes custom command failures explicit", async () => {
    vi.mocked(exec.exec).mockRejectedValue(new Error("exit code 2"));
    await expect(
      buildForRevision("fixtures.json", "/head", "", "make fail", false),
    ).rejects.toThrow(/Custom build command failed: exit code 2/);
  });
});
