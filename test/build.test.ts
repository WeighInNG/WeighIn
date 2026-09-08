import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildContracts } from "../src/action";
import * as exec from "@actions/exec";
import * as fs from "fs";

vi.mock("@actions/exec");
vi.mock("fs");

describe("buildContracts decision logic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips build when skip-build is true", async () => {
    await buildContracts("fixtures.json", "/workspace", "", true);
    expect(exec.exec).not.toHaveBeenCalled();
  });

  it("runs custom build command when provided", async () => {
    vi.mocked(exec.exec).mockResolvedValue(0);
    await buildContracts(
      "fixtures.json",
      "/workspace",
      "make my_contract",
      false,
    );

    expect(exec.exec).toHaveBeenCalledWith("sh", ["-c", "make my_contract"], {
      cwd: "/workspace",
    });
  });

  it("throws clear error on custom build failure", async () => {
    vi.mocked(exec.exec).mockRejectedValue(new Error("exit code 2"));
    await expect(
      buildContracts("fixtures.json", "/workspace", "make fail", false),
    ).rejects.toThrow(/Custom build command failed: exit code 2/);
  });

  it("runs default cargo build when no custom command and not skipping", async () => {
    // mock fixtures
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        contracts: [{ wasm_path: "foo.wasm" }],
      }),
    );
    // mock Cargo.toml discovery
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path.endsWith("Cargo.toml")) return true;
      return false;
    });

    vi.mocked(exec.exec).mockResolvedValue(0);

    await buildContracts("/workspace/fixtures.json", "/workspace", "", false);

    expect(exec.exec).toHaveBeenCalledWith(
      "cargo",
      ["build", "--release", "--target", "wasm32-unknown-unknown"],
      expect.any(Object),
    );
  });
});
