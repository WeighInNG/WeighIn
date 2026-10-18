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

interface CargoPackage {
  id: string;
  name: string;
  manifest_path: string;
  targets: Array<{ crate_types: string[] }>;
}

export interface BuildContractsOptions {
  fixturesPath: string;
  workspaceRoot: string;
  rustToolchain?: string;
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

/** Build exactly the configured contracts within an explicit allowed workspace root,
 * rejecting traversal and symlink escapes, and measuring fresh CLI output rather
 * than a potentially stale artifact already present at the fixture path. */
export async function buildContracts(
  fixturesPathOrOptions: string | BuildContractsOptions,
  workspaceRoot?: string,
  rustToolchain?: string,
): Promise<BuiltContract[]> {
  let fixturesPath: string;
  let root: string;
  let toolchain: string | undefined;

  if (
    typeof fixturesPathOrOptions === "object" &&
    fixturesPathOrOptions !== null
  ) {
    fixturesPath = fixturesPathOrOptions.fixturesPath;
    root = fixturesPathOrOptions.workspaceRoot;
    toolchain = fixturesPathOrOptions.rustToolchain;
  } else if (typeof fixturesPathOrOptions === "string") {
    fixturesPath = fixturesPathOrOptions;
    root = workspaceRoot as string;
    toolchain = rustToolchain;
  } else {
    throw new Error("Invalid arguments: fixturesPath is required");
  }

  if (!root || typeof root !== "string" || !root.trim()) {
    throw new Error(
      "Workspace root is required: an explicit allowed directory must be specified",
    );
  }

  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Workspace root does not exist: ${root}`);
  }
  const rootStat = fs.statSync(resolvedRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }
  const canonicalRoot = fs.realpathSync(resolvedRoot);

  const resolvedFixturesPath = path.resolve(canonicalRoot, fixturesPath);
  if (!fs.existsSync(resolvedFixturesPath)) {
    throw new Error(`Fixtures file not found: ${fixturesPath}`);
  }
  const canonicalFixturesFile = fs.realpathSync(resolvedFixturesPath);
  const relFixtures = path.relative(canonicalRoot, canonicalFixturesFile);
  if (relFixtures.startsWith("..") || path.isAbsolute(relFixtures)) {
    throw new Error(`Fixtures path escapes workspace root: ${fixturesPath}`);
  }

  const fixtures = parseFixtures(
    fs.readFileSync(canonicalFixturesFile, "utf8"),
    path.basename(canonicalFixturesFile),
  );
  const fixturesDir = path.dirname(canonicalFixturesFile);
  const env = {
    ...process.env,
    ...(toolchain ? { RUSTUP_TOOLCHAIN: toolchain } : {}),
  } as Record<string, string>;
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
    if (tool === "stellar" && args[0] === "contract")
      process.stdout.write(stdout + stderr);
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

  function validateDestinationPath(
    destination: string,
    contractWasmPath: string,
  ): void {
    const relFromRoot = path.relative(canonicalRoot, destination);
    if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
      throw new Error(
        `WASM destination escapes workspace root for wasm_path ${contractWasmPath}: ${destination}`,
      );
    }

    let check = destination;
    while (
      check !== canonicalRoot &&
      path.relative(canonicalRoot, check) !== ""
    ) {
      try {
        const lstat = fs.lstatSync(check);
        if (lstat.isSymbolicLink()) {
          const canonicalCheck = fs.realpathSync(check);
          const relCheck = path.relative(canonicalRoot, canonicalCheck);
          if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
            throw new Error(
              `WASM destination symlink escapes workspace root for wasm_path ${contractWasmPath}: ${check} -> ${canonicalCheck}`,
            );
          }
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;
      }
      const parent = path.dirname(check);
      if (parent === check) break;
      check = parent;
    }
  }

  const plans: Array<{
    destination: string;
    pkg: CargoPackage;
    wasmPath: string;
  }> = [];
  const metadataCache = new Map<string, CargoPackage[]>();
  for (const contract of fixtures.contracts) {
    const destination = path.resolve(fixturesDir, contract.wasm_path);
    validateDestinationPath(destination, contract.wasm_path);

    let dir = path.dirname(destination);
    let manifest: string | null = null;
    while (true) {
      const relDir = path.relative(canonicalRoot, dir);
      if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
        throw new Error(
          `Manifest search escaped workspace root for wasm_path ${contract.wasm_path}`,
        );
      }
      if (fs.existsSync(dir)) {
        const canonicalDir = fs.realpathSync(dir);
        const relCanonical = path.relative(canonicalRoot, canonicalDir);
        if (relCanonical.startsWith("..") || path.isAbsolute(relCanonical)) {
          throw new Error(
            `Manifest search traversed symlink escaping workspace root for wasm_path ${contract.wasm_path}`,
          );
        }
      }

      const candidate = path.join(dir, "Cargo.toml");
      if (fs.existsSync(candidate)) {
        const canonicalManifest = fs.realpathSync(candidate);
        const relManifest = path.relative(canonicalRoot, canonicalManifest);
        if (relManifest.startsWith("..") || path.isAbsolute(relManifest)) {
          throw new Error(
            `Cargo.toml symlink escapes workspace root for wasm_path ${contract.wasm_path}`,
          );
        }
        manifest = candidate;
        break;
      }

      const currentCanonical = fs.existsSync(dir)
        ? fs.realpathSync(dir)
        : path.resolve(dir);
      if (
        currentCanonical === canonicalRoot ||
        path.relative(canonicalRoot, currentCanonical) === ""
      ) {
        break;
      }

      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }

    if (!manifest) {
      throw new Error(
        `No Cargo.toml found for wasm_path ${contract.wasm_path}`,
      );
    }

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

    const canonicalPkgManifest = fs.realpathSync(matches[0].manifest_path);
    const relPkg = path.relative(canonicalRoot, canonicalPkgManifest);
    if (relPkg.startsWith("..") || path.isAbsolute(relPkg)) {
      throw new Error(
        `Cargo package ${matches[0].name} manifest escapes workspace root: ${matches[0].manifest_path}`,
      );
    }

    plans.push({ destination, pkg: matches[0], wasmPath: contract.wasm_path });
  }

  const artifacts = new Map<string, Buffer>();
  const results: BuiltContract[] = [];
  for (const { destination, pkg, wasmPath } of plans) {
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
    validateDestinationPath(destination, wasmPath);
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
