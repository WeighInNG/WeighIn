import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import * as exec from "@actions/exec";
import { parseFixtures } from "./identity";

export interface BuiltContract {
  wasm_path: string;
  manifest_path: string;
  package: string;
  wasm_sha256: string;
  stellar_version: string;
  rust_version: string;
}

export interface BuildInputSnapshot {
  files: Map<string, string | null>;
  packageRoots: string[];
  excludedPaths: Set<string>;
}

const IGNORED_INPUT_DIRS = new Set([
  "target",
  ".git",
  "node_modules",
  ".weighin-storage-probe",
]);

const TRACKED_MANIFEST_RELATIVES = [
  "Cargo.toml",
  "Cargo.lock",
  "build.rs",
  "rust-toolchain.toml",
  "rust-toolchain",
  path.join(".cargo", "config.toml"),
  path.join(".cargo", "config"),
];

function hashFileOrNull(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectPackageDirectoryFiles(
  rootDir: string,
  currentDir: string,
  excludedPaths: Set<string>,
  out: Map<string, string>,
): void {
  if (!fs.existsSync(currentDir)) return;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (IGNORED_INPUT_DIRS.has(entry.name)) continue;
    const fullPath = path.resolve(currentDir, entry.name);
    if (excludedPaths.has(fullPath)) continue;
    if (entry.isDirectory()) {
      // Do not descend into nested sub-crates that own their own Cargo.toml
      // unless that sub-crate is itself a selected package root.
      if (!fs.existsSync(path.join(fullPath, "Cargo.toml"))) {
        collectPackageDirectoryFiles(rootDir, fullPath, excludedPaths, out);
      }
      continue;
    }
    if (entry.isFile() && !fullPath.endsWith(".wasm")) {
      out.set(
        fullPath,
        createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex"),
      );
    }
  }
}

function recordManifestDirectoryCandidates(
  dir: string,
  files: Map<string, string | null>,
): void {
  const resolvedDir = path.resolve(dir);
  for (const rel of TRACKED_MANIFEST_RELATIVES) {
    const candidate = path.resolve(resolvedDir, rel);
    if (!files.has(candidate)) {
      files.set(candidate, hashFileOrNull(candidate));
    }
  }
}

/** Snapshot selected manifests, lockfiles, and tracked contract inputs before building. */
export function snapshotContractInputs(
  manifestPaths: string[],
  packageManifestPaths: string[],
  destinationPaths: string[],
  extraFiles: string[] = [],
  preExistingSnapshots?: Map<string, string | null>,
): BuildInputSnapshot {
  const files = new Map<string, string | null>(preExistingSnapshots ?? []);
  const excludedPaths = new Set(
    destinationPaths.map((dest) => path.resolve(dest)),
  );
  for (const extra of extraFiles) {
    const resolved = path.resolve(extra);
    if (!files.has(resolved)) {
      files.set(resolved, hashFileOrNull(resolved));
    }
  }
  const workspaceDirs = manifestPaths.map((m) => path.dirname(path.resolve(m)));
  for (const dir of workspaceDirs) {
    recordManifestDirectoryCandidates(dir, files);
  }
  const packageRoots: string[] = [];
  for (const pkgManifest of packageManifestPaths) {
    const pkgDir = path.dirname(path.resolve(pkgManifest));
    if (!packageRoots.includes(pkgDir)) packageRoots.push(pkgDir);
    recordManifestDirectoryCandidates(pkgDir, files);

    // Also snapshot Cargo.toml / Cargo.lock on any ancestor directories up to
    // the discovered owning manifest directory.
    let cursor = pkgDir;
    while (true) {
      recordManifestDirectoryCandidates(cursor, files);
      if (workspaceDirs.includes(cursor)) break;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }

    const discovered = new Map<string, string>();
    collectPackageDirectoryFiles(pkgDir, pkgDir, excludedPaths, discovered);
    for (const [filePath, digest] of discovered) {
      if (!files.has(filePath)) {
        files.set(filePath, digest);
      }
    }
  }
  return { files, packageRoots, excludedPaths };
}

/** Fail if any snapshotted manifest, lockfile, or contract input was mutated, added, or removed. */
export function assertContractInputsUnchanged(
  snapshot: BuildInputSnapshot,
): void {
  const mutated = new Set<string>();
  for (const [filePath, expectedDigest] of snapshot.files) {
    if (snapshot.excludedPaths.has(filePath)) continue;
    const actualDigest = hashFileOrNull(filePath);
    if (actualDigest !== expectedDigest) {
      mutated.add(filePath);
    }
  }
  for (const pkgDir of snapshot.packageRoots) {
    const currentFiles = new Map<string, string>();
    collectPackageDirectoryFiles(
      pkgDir,
      pkgDir,
      snapshot.excludedPaths,
      currentFiles,
    );
    for (const [filePath, digest] of currentFiles) {
      if (!snapshot.files.has(filePath)) {
        mutated.add(filePath);
      } else if (snapshot.files.get(filePath) !== digest) {
        mutated.add(filePath);
      }
    }
  }
  if (mutated.size > 0) {
    const sorted = [...mutated].sort();
    throw new Error(
      `Default contract build mutated input file(s): ${sorted.join(", ")}`,
    );
  }
}

interface CargoPackage {
  id: string;
  name: string;
  manifest_path: string;
  targets: Array<{ crate_types: string[] }>;
}

/** Detect storage errors that the optimizer's temporary-file writer may hide. */
function verifyBuildStorage(directory: string, bytes = 1024 * 1024): void {
  const probePath = path.join(directory, ".weighin-storage-probe");
  const expected = Buffer.alloc(bytes, 0xa5);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(probePath, "wx", 0o600);
    fs.writeFileSync(descriptor, expected);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (!fs.readFileSync(probePath).equals(expected))
      throw new Error(
        "temporary-file contents did not survive a write/read round trip",
      );
  } catch (error: any) {
    throw new Error(
      `Build temporary storage is unusable at ${directory}: ${error.message}. Provide healthy temporary storage (TMPDIR on Unix); refusing to accept optimizer output.`,
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(probePath, { force: true });
  }
}

/** Build exactly the configured contracts, and measure fresh CLI output rather
 * than a potentially stale artifact already present at the fixture path. */
export async function buildContracts(
  fixturesPath: string,
  rustToolchain?: string,
): Promise<BuiltContract[]> {
  const fixtures = parseFixtures(
    fs.readFileSync(fixturesPath, "utf8"),
    path.basename(fixturesPath),
  );
  const fixturesDir = path.dirname(path.resolve(fixturesPath));
  const env = {
    ...process.env,
    ...(rustToolchain ? { RUSTUP_TOOLCHAIN: rustToolchain } : {}),
  } as Record<string, string>;
  const resolvedFixturesPath = path.resolve(fixturesPath);
  const preBuildSnapshots = new Map<string, string | null>([
    [resolvedFixturesPath, hashFileOrNull(resolvedFixturesPath)],
  ]);
  let inputSnapshot: BuildInputSnapshot | undefined;
  async function command(
    tool: string,
    args: string[],
    cwd: string,
    commandEnv = env,
  ): Promise<string> {
    let stdout = "",
      stderr = "";
    try {
      await exec.exec(tool, args, {
        cwd,
        env: commandEnv,
        silent: true,
        listeners: {
          stdout: (data) => {
            stdout += data.toString();
          },
          stderr: (data) => {
            stderr += data.toString();
          },
        },
      });
    } catch (error: any) {
      throw new Error(
        `${tool} ${args.join(" ")} failed: ${stderr || error.message}`,
      );
    }
    if (stderr.includes("Optimization skipped"))
      throw new Error(
        "Stellar CLI lacks optimization support; install the official release binary",
      );
    if (tool === "stellar" && args[0] === "contract") {
      process.stdout.write(stdout + stderr);
      if (inputSnapshot) assertContractInputsUnchanged(inputSnapshot);
    }
    return stdout.trim();
  }
  const rustVersion = await command("rustc", ["--version"], fixturesDir);
  const rust = rustVersion.match(/^rustc (\d+)\.(\d+)\./);
  if (
    !rust ||
    Number(rust[1]) < 1 ||
    (Number(rust[1]) === 1 && Number(rust[2]) < 84)
  ) {
    throw new Error(
      `Rust 1.84+ is required for wasm32v1-none; got ${rustVersion}`,
    );
  }
  const stellarVersion = await command("stellar", ["--version"], fixturesDir);
  const stellar = stellarVersion.match(/stellar (\d+)\.(\d+)\.(\d+)/);
  if (
    !stellar ||
    Number(stellar[1]) < 28 ||
    (Number(stellar[1]) === 28 && Number(stellar[2]) < 1)
  ) {
    throw new Error(
      `Stellar CLI 28.1+ with optimization support is required; got ${stellarVersion}`,
    );
  }

  const plans: Array<{ destination: string; pkg: CargoPackage }> = [];
  const metadataCache = new Map<string, CargoPackage[]>();
  for (const contract of fixtures.contracts) {
    const destination = path.resolve(fixturesDir, contract.wasm_path);
    let dir = path.dirname(destination);
    while (!fs.existsSync(path.join(dir, "Cargo.toml"))) {
      const parent = path.dirname(dir);
      if (parent === dir)
        throw new Error(
          `No Cargo.toml found for wasm_path ${contract.wasm_path}`,
        );
      dir = parent;
    }
    const manifest = path.join(dir, "Cargo.toml");
    recordManifestDirectoryCandidates(dir, preBuildSnapshots);
    let packages = metadataCache.get(manifest);
    if (!packages) {
      const metadata = JSON.parse(
        await command(
          "cargo",
          [
            "metadata",
            "--no-deps",
            "--locked",
            "--format-version",
            "1",
            "--manifest-path",
            manifest,
          ],
          dir,
        ),
      );
      packages = (metadata.packages as CargoPackage[]).filter(
        (pkg) =>
          metadata.workspace_members.includes(pkg.id) &&
          pkg.targets.some((target) => target.crate_types.includes("cdylib")),
      );
      metadataCache.set(manifest, packages);
    }
    const matches = packages.filter(
      (pkg) =>
        `${pkg.name.replace(/-/g, "_")}.wasm` === path.basename(destination),
    );
    if (matches.length !== 1)
      throw new Error(
        `wasm_path ${contract.wasm_path} must identify exactly one Cargo cdylib package; found ${matches.length}`,
      );
    plans.push({ destination, pkg: matches[0] });
  }

  const artifacts = new Map<string, Buffer>();
  const results: BuiltContract[] = [];
  for (const { destination, pkg } of plans) {
    let wasm = artifacts.get(pkg.manifest_path);
    if (!wasm) {
      let outputDir: string;
      try {
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-build-"));
      } catch (error: any) {
        throw new Error(
          `Cannot create build temporary storage: ${error.message}`,
        );
      }
      try {
        if (!inputSnapshot) {
          inputSnapshot = snapshotContractInputs(
            Array.from(metadataCache.keys()),
            plans.map((plan) => plan.pkg.manifest_path),
            plans.map((plan) => plan.destination),
            [resolvedFixturesPath],
            preBuildSnapshots,
          );
        }
        assertContractInputsUnchanged(inputSnapshot);
        verifyBuildStorage(outputDir);
        await command(
          "stellar",
          [
            "contract",
            "build",
            "--manifest-path",
            pkg.manifest_path,
            "--package",
            pkg.name,
            "--locked",
            "--optimize=true",
            "--out-dir",
            outputDir,
          ],
          path.dirname(pkg.manifest_path),
          { ...env, TMPDIR: outputDir, TMP: outputDir, TEMP: outputDir },
        );
        wasm = fs.readFileSync(
          path.join(outputDir, `${pkg.name.replace(/-/g, "_")}.wasm`),
        );
        verifyBuildStorage(outputDir, Math.max(1024 * 1024, wasm.length));
        if (
          !wasm
            .subarray(0, 8)
            .equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
        )
          throw new Error("Stellar build did not produce a valid WASM module");
        artifacts.set(pkg.manifest_path, wasm);
      } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, wasm);
    const record = {
      wasm_path: destination,
      manifest_path: pkg.manifest_path,
      package: pkg.name,
      wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
      stellar_version: stellarVersion,
      rust_version: rustVersion,
    };
    console.log(
      `Built ${record.package}: ${destination}; SHA256 ${record.wasm_sha256}; ${stellarVersion}; ${rustVersion}`,
    );
    results.push(record);
  }
  return results;
}
