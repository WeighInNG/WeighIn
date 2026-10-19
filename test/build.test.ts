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

  it("detects manifest, lockfile, and source mutations while allowing target outputs and preexisting edits", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const actualBuild =
      await vi.importActual<typeof import("../src/build")>("../src/build");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-input-snap-"));
    try {
      const workspaceManifest = path.join(dir, "Cargo.toml");
      const workspaceLock = path.join(dir, "Cargo.lock");
      const crateDir = path.join(dir, "contracts", "greeting");
      const crateManifest = path.join(crateDir, "Cargo.toml");
      const crateSrc = path.join(crateDir, "src", "lib.rs");
      const destWasm = path.join(
        crateDir,
        "target",
        "wasm32v1-none",
        "release",
        "greeting.wasm",
      );

      fs.mkdirSync(path.dirname(crateSrc), { recursive: true });
      fs.writeFileSync(workspaceManifest, "[workspace]\n");
      fs.writeFileSync(workspaceLock, "# lock v1\n");
      fs.writeFileSync(crateManifest, '[package]\nname = "greeting"\n');
      fs.writeFileSync(crateSrc, "// preexisting dirty source\n");

      const snap = actualBuild.snapshotContractInputs(
        [workspaceManifest],
        [crateManifest],
        [destWasm],
      );
      expect(() =>
        actualBuild.assertContractInputsUnchanged(snap),
      ).not.toThrow();

      // Generated output changes inside target/ and destination WASM are permitted.
      fs.mkdirSync(path.dirname(destWasm), { recursive: true });
      fs.writeFileSync(destWasm, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
      expect(() =>
        actualBuild.assertContractInputsUnchanged(snap),
      ).not.toThrow();

      // Mutating Cargo.lock fails closed.
      fs.writeFileSync(workspaceLock, "# lock v2\n");
      expect(() => actualBuild.assertContractInputsUnchanged(snap)).toThrow(
        /Default contract build mutated input file\(s\).*Cargo\.lock/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
