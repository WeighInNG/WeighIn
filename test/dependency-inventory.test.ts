import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildPurl,
  DEPENDENCY_INVENTORY_DISCLAIMER,
  DEPENDENCY_INVENTORY_SCHEMA_VERSION,
  generateDependencyInventory,
  verifyDependencyInventory,
} from "../src/dependency-inventory";

const rootDir = path.resolve(__dirname, "..");

function createSyntheticRepo(
  customize?: (files: {
    pkgJson: Record<string, any>;
    pkgLock: Record<string, any>;
    cargoToml: string;
    cargoLock: string;
  }) => void,
): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-inv-test-"));
  fs.mkdirSync(path.join(tmpDir, "native/simulation"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "bundled"), { recursive: true });

  const pkgJson = {
    name: "weighin",
    version: "1.0.0",
    files: [
      "dist",
      "bundled",
      "native/simulation/Cargo.toml",
      "native/simulation/Cargo.lock",
      "native/simulation/src",
      "action.yml",
      "comment",
    ],
    scripts: {
      "build:helper":
        "cargo +1.95.0 build --release --locked --manifest-path native/simulation/Cargo.toml --target x86_64-unknown-linux-gnu",
    },
    dependencies: {
      "@actions/core": "2.0.0",
      axios: "1.20.0",
    },
    devDependencies: {
      esbuild: "0.25.6",
      vitest: "4.1.11",
    },
  };

  const pkgLock = {
    name: "weighin",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "weighin",
        version: "1.0.0",
      },
      "node_modules/@actions/core": {
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/@actions/core/-/core-2.0.0.tgz",
        integrity: "sha512-actionscore200==",
        dependencies: {
          "shared-util": "^1.0.0",
        },
      },
      "node_modules/axios": {
        version: "1.20.0",
        resolved: "https://registry.npmjs.org/axios/-/axios-1.20.0.tgz",
        integrity: "sha512-axios1200==",
      },
      "node_modules/shared-util": {
        version: "1.0.0",
        resolved:
          "https://registry.npmjs.org/shared-util/-/shared-util-1.0.0.tgz",
        integrity: "sha512-sharedutil100==",
      },
      "node_modules/@actions/core/node_modules/shared-util": {
        version: "1.0.0",
        resolved:
          "https://registry.npmjs.org/shared-util/-/shared-util-1.0.0.tgz",
        integrity: "sha512-sharedutil100==",
      },
      "node_modules/esbuild": {
        version: "0.25.6",
        resolved: "https://registry.npmjs.org/esbuild/-/esbuild-0.25.6.tgz",
        integrity: "sha512-esbuild0256==",
        dev: true,
      },
      "node_modules/vitest": {
        version: "4.1.11",
        resolved: "https://registry.npmjs.org/vitest/-/vitest-4.1.11.tgz",
        integrity: "sha512-vitest4111==",
        dev: true,
        dependencies: {
          "shared-util": "^2.0.0",
        },
      },
      "node_modules/vitest/node_modules/shared-util": {
        version: "2.0.0",
        dev: true,
      },
    },
  };

  const state = {
    pkgJson,
    pkgLock,
    cargoToml: [
      "[package]",
      'name = "weighin-simulation"',
      'version = "0.0.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'soroban-env-host = { version = "=28.0.1", features = ["recording_mode", "testutils"] }',
      'serde = { version = "1", features = ["derive"] }',
      "",
    ].join("\n"),
    cargoLock: [
      "version = 4",
      "",
      "[[package]]",
      'name = "weighin-simulation"',
      'version = "0.0.0"',
      "dependencies = [",
      ' "serde 1.0.228",',
      ' "soroban-env-host 28.0.1",',
      "]",
      "",
      "[[package]]",
      'name = "soroban-env-host"',
      'version = "28.0.1"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      'checksum = "deadbeefcafebabe"',
      "",
      "[[package]]",
      'name = "serde"',
      'version = "1.0.228"',
      "",
    ].join("\n"),
  };

  if (customize) customize(state);

  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify(state.pkgJson, null, 2),
  );
  fs.writeFileSync(
    path.join(tmpDir, "package-lock.json"),
    JSON.stringify(state.pkgLock, null, 2),
  );
  fs.writeFileSync(
    path.join(tmpDir, "native/simulation/Cargo.toml"),
    state.cargoToml,
  );
  fs.writeFileSync(
    path.join(tmpDir, "native/simulation/Cargo.lock"),
    state.cargoLock,
  );
  fs.writeFileSync(
    path.join(tmpDir, "bundled/index.js"),
    "// node_modules/@actions/core/lib/core.js\n// node_modules/shared-util/index.js\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "bundled/comment-action.js"),
    "// node_modules/@actions/core/lib/core.js\n",
  );

  return tmpDir;
}

describe("generateDependencyInventory", () => {
  it("produces deterministic output matching committed docs/dependency-inventory.json", () => {
    const first = generateDependencyInventory({ rootDir });
    const second = generateDependencyInventory({ rootDir });
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(DEPENDENCY_INVENTORY_SCHEMA_VERSION);
    expect(first.disclaimer).toBe(DEPENDENCY_INVENTORY_DISCLAIMER);

    const committedRaw = fs.readFileSync(
      path.join(rootDir, "docs/dependency-inventory.json"),
      "utf8",
    );
    const committed = JSON.parse(committedRaw);
    expect(() =>
      verifyDependencyInventory(committed, { rootDir }),
    ).not.toThrow();

    // Check key classifications and native metadata
    const sorobanHost = first.components.find(
      (c) => c.id === "cargo:soroban-env-host@28.0.1",
    );
    expect(sorobanHost).toBeDefined();
    expect(sorobanHost?.classification).toBe("native-helper");
    expect(sorobanHost?.direct).toBe(true);
    expect(sorobanHost?.nativeMetadata).toEqual({
      target: "x86_64-unknown-linux-gnu",
      declaredFeatures: ["recording_mode", "testutils"],
      edition: null,
    });

    const axiosComp = first.components.find((c) => c.id === "npm:axios@1.20.0");
    expect(axiosComp).toBeDefined();
    expect(axiosComp?.classification).toBe("shipped-runtime");
    expect(axiosComp?.bundleReachability?.inclusionBasis).toBe(
      "conservative-production-lock",
    );

    const coreComp = first.components.find(
      (c) => c.id === "npm:@actions/core@2.0.0",
    );
    expect(coreComp?.classification).toBe("shipped-runtime");
    expect(coreComp?.bundleReachability?.inActionBundle).toBe(true);
    expect(coreComp?.bundleReachability?.inCommentBundle).toBe(true);
    expect(coreComp?.bundleReachability?.inclusionBasis).toBe(
      "statically-bundled",
    );
  });

  it("deduplicates identical (name, version) paths while keeping distinct versions separate and handling absent metadata", () => {
    const tmpDir = createSyntheticRepo();
    try {
      const inv = generateDependencyInventory({ rootDir: tmpDir });

      // shared-util@1.0.0 appears at two locations -> deduplicated into one record
      const sharedV1 = inv.components.find(
        (c) => c.id === "npm:shared-util@1.0.0",
      );
      expect(sharedV1).toBeDefined();
      expect(sharedV1?.locations).toEqual([
        "node_modules/@actions/core/node_modules/shared-util",
        "node_modules/shared-util",
      ]);
      expect(sharedV1?.classification).toBe("shipped-runtime");
      expect(sharedV1?.metadataCompleteness).toBe("complete");

      // shared-util@2.0.0 is a distinct version under vitest with absent resolved/integrity
      const sharedV2 = inv.components.find(
        (c) => c.id === "npm:shared-util@2.0.0",
      );
      expect(sharedV2).toBeDefined();
      expect(sharedV2?.classification).toBe("dev-only");
      expect(sharedV2?.source).toBeNull();
      expect(sharedV2?.integrity).toBeNull();
      expect(sharedV2?.metadataCompleteness).toBe(
        "missing-source-or-integrity",
      );

      // serde in synthetic Cargo.lock has no source/checksum -> honest absent metadata
      const serdeCrate = inv.components.find(
        (c) => c.id === "cargo:serde@1.0.228",
      );
      expect(serdeCrate).toBeDefined();
      expect(serdeCrate?.source).toBeNull();
      expect(serdeCrate?.integrity).toBeNull();
      expect(serdeCrate?.metadataCompleteness).toBe(
        "missing-source-or-integrity",
      );
      expect(serdeCrate?.nativeMetadata?.declaredFeatures).toEqual(["derive"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("alters the inventory record and fails verification when a locked dependency changes", () => {
    const tmpDir = createSyntheticRepo();
    try {
      const baseline = generateDependencyInventory({ rootDir: tmpDir });
      const lockPath = path.join(tmpDir, "package-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock.packages["node_modules/axios"].version = "1.20.1";
      lock.packages["node_modules/axios"].integrity = "sha512-axios1201==";
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

      const updated = generateDependencyInventory({ rootDir: tmpDir });
      expect(updated.inputs.npmLockfileSha256).not.toBe(
        baseline.inputs.npmLockfileSha256,
      );
      expect(
        updated.components.find((c) => c.id === "npm:axios@1.20.1"),
      ).toBeDefined();
      expect(
        updated.components.find((c) => c.id === "npm:axios@1.20.0"),
      ).toBeUndefined();
      expect(() =>
        verifyDependencyInventory(baseline, { rootDir: tmpDir }),
      ).toThrow(/Dependency inventory does not match locked repository inputs/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("formats scoped npm and cargo purls canonically", () => {
    expect(buildPurl("npm", "@stellar/stellar-sdk", "16.0.1")).toBe(
      "pkg:npm/%40stellar/stellar-sdk@16.0.1",
    );
    expect(buildPurl("cargo", "soroban-env-host", "28.0.1")).toBe(
      "pkg:cargo/soroban-env-host@28.0.1",
    );
  });
});
