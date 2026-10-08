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
  async function command(
    tool: string,
    args: string[],
    cwd: string,
  ): Promise<string> {
    let stdout = "",
      stderr = "";
    try {
      await exec.exec(tool, args, {
        cwd,
        env,
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
      const outputDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "weighin-build-"),
      );
      try {
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
        );
        wasm = fs.readFileSync(
          path.join(outputDir, `${pkg.name.replace(/-/g, "_")}.wasm`),
        );
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
