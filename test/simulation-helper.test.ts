import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeHelperCacheKey,
  resolveSimulationHelper,
  _resetSimulationHelperState,
} from "../src/simulation";

describe("Simulation Helper Provisioning & Cache (Issues #75 & #76)", () => {
  beforeEach(() => {
    _resetSimulationHelperState();
    delete process.env.WEIGHIN_HELPER_PATH;
  });

  afterEach(() => {
    _resetSimulationHelperState();
    delete process.env.WEIGHIN_HELPER_PATH;
    vi.restoreAllMocks();
  });

  describe("computeHelperCacheKey (Issue #76)", () => {
    it("generates a deterministic cache key with complete compatibility inputs", () => {
      const key1 = computeHelperCacheKey({
        os: "linux",
        arch: "x64",
        toolchain: "1.95.0",
        target: "x86_64-unknown-linux-gnu",
        features: ["testutils"],
        flags: ["--release", "--locked"],
      });
      const key2 = computeHelperCacheKey({
        os: "linux",
        arch: "x64",
        toolchain: "1.95.0",
        target: "x86_64-unknown-linux-gnu",
        features: ["testutils"],
        flags: ["--release", "--locked"],
      });

      expect(key1).toBe(key2);
      expect(key1).toContain(
        "linux-x64-cargo-simulation-helper-1.95.0-x86_64-unknown-linux-gnu-",
      );
    });

    it("invalidates cache key when toolchain, target, features or flags differ", () => {
      const baseKey = computeHelperCacheKey({ toolchain: "1.95.0" });
      const diffToolchain = computeHelperCacheKey({ toolchain: "1.96.0" });
      const diffTarget = computeHelperCacheKey({
        target: "aarch64-unknown-linux-gnu",
      });
      const diffFeatures = computeHelperCacheKey({
        features: ["extra-feature"],
      });
      const diffFlags = computeHelperCacheKey({ flags: ["--debug"] });

      expect(diffToolchain).not.toBe(baseKey);
      expect(diffTarget).not.toBe(baseKey);
      expect(diffFeatures).not.toBe(baseKey);
      expect(diffFlags).not.toBe(baseKey);
    });
  });

  describe("resolveSimulationHelper recovery and deduplication (Issue #75)", () => {
    it("respects explicit executable overrides", async () => {
      const nodeExe = process.execPath;
      const helper = await resolveSimulationHelper(nodeExe);
      expect(helper).toBe(nodeExe);
    });

    it("rejects invalid or missing explicit helper override", async () => {
      await expect(
        resolveSimulationHelper("/nonexistent/helper/path"),
      ).rejects.toThrow(/Simulation helper missing or not executable/);
    });

    it("recovers on subsequent attempt after a failed build attempt", async () => {
      let attempts = 0;
      const failingBuild = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Cargo build failed: network error");
        }
        return "/target/release/weighin-simulation";
      };

      // First attempt fails
      await expect(
        resolveSimulationHelper(undefined, failingBuild),
      ).rejects.toThrow(/Cargo build failed: network error/);
      expect(attempts).toBe(1);

      // Second attempt succeeds and returns binary
      const recovered = await resolveSimulationHelper(undefined, failingBuild);
      expect(recovered).toBe("/target/release/weighin-simulation");
      expect(attempts).toBe(2);

      // Third attempt reuses the successful cached helper
      const cached = await resolveSimulationHelper(undefined, failingBuild);
      expect(cached).toBe("/target/release/weighin-simulation");
      expect(attempts).toBe(2);
    });

    it("deduplicates concurrent callers onto the same in-flight build", async () => {
      let buildCount = 0;
      const slowBuild = async () => {
        buildCount++;
        await new Promise((r) => setTimeout(r, 20));
        return "/target/release/weighin-simulation";
      };

      const [res1, res2, res3] = await Promise.all([
        resolveSimulationHelper(undefined, slowBuild),
        resolveSimulationHelper(undefined, slowBuild),
        resolveSimulationHelper(undefined, slowBuild),
      ]);

      expect(buildCount).toBe(1);
      expect(res1).toBe("/target/release/weighin-simulation");
      expect(res2).toBe("/target/release/weighin-simulation");
      expect(res3).toBe("/target/release/weighin-simulation");
    });
  });
});
