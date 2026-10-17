import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as TOML from "toml";

export const DEPENDENCY_INVENTORY_SCHEMA_VERSION =
  "weighin.dependency-inventory.v1";

export const DEPENDENCY_INVENTORY_DISCLAIMER =
  "This dependency inventory is a reproducible component and provenance record only. It is not vulnerability clearance, an advisory audit outcome, or a license/legal certification.";

export type ComponentEcosystem = "npm" | "cargo";

export type ComponentClassification =
  "shipped-runtime" | "native-helper" | "build-tooling" | "dev-only";

export type MetadataCompleteness =
  "complete" | "missing-source-or-integrity" | "workspace-root";

export interface BundleReachability {
  inActionBundle: boolean;
  inCommentBundle: boolean;
  inclusionBasis: "statically-bundled" | "conservative-production-lock";
  rationale: string;
}

export interface NativeTargetMetadata {
  target: string;
  declaredFeatures: string[];
  edition: string | null;
}

export interface InventoryComponent {
  id: string;
  purl: string;
  ecosystem: ComponentEcosystem;
  name: string;
  version: string;
  classification: ComponentClassification;
  direct: boolean;
  source: string | null;
  integrity: string | null;
  metadataCompleteness: MetadataCompleteness;
  locations: string[];
  dependencies: string[];
  bundleReachability?: BundleReachability;
  nativeMetadata?: NativeTargetMetadata;
}

export interface BundleReconciliation {
  bundlePath: string;
  bundledPackages: string[];
  bundledLocations: string[];
  bundledModuleCount: number;
  bundledModulesSha256: string;
  unreconciledPackages: string[];
}

export interface DependencyInventory {
  schemaVersion: string;
  disclaimer: string;
  deduplicationPolicy: {
    identityKey: string;
    sameVersionMultiplePaths: string;
    distinctVersionsSameName: string;
  };
  inputs: {
    packageManifestSha256: string;
    npmLockfileSha256: string;
    cargoManifestSha256: string;
    cargoLockfileSha256: string;
    nativeTarget: string;
  };
  packageDistribution: {
    packageName: string;
    packageVersion: string;
    requiredShippedPaths: string[];
    actionBundle: BundleReconciliation;
    commentBundle: BundleReconciliation;
  };
  summary: {
    totalComponents: number;
    npmComponents: number;
    cargoComponents: number;
    byClassification: Record<ComponentClassification, number>;
    conservativeRuntimeComponents: number;
  };
  components: InventoryComponent[];
}

export interface InventoryOptions {
  rootDir?: string;
}

const BUILD_TOOL_ROOTS = new Set(["typescript", "esbuild", "@types/node"]);

const REQUIRED_SHIPPED_PATHS = [
  "dist",
  "bundled",
  "native/simulation/Cargo.toml",
  "native/simulation/Cargo.lock",
  "native/simulation/src",
  "action.yml",
  "comment",
];

function sha256Text(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function buildPurl(
  ecosystem: ComponentEcosystem,
  name: string,
  version: string,
): string {
  if (ecosystem === "npm") {
    if (name.startsWith("@")) {
      const [scope, pkg] = name.split("/");
      return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}`;
    }
    return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  }
  return `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

export function extractPackageNameFromNodeModulesPath(
  location: string,
): string | null {
  const normalized = location.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("node_modules/");
  if (idx === -1) return null;
  const remainder = normalized.slice(idx + "node_modules/".length);
  const parts = remainder.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0].startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0];
}

export function extractInstallLocationFromModulePath(
  modulePath: string,
): string | null {
  const normalized = modulePath.replace(/\\/g, "/");
  const nmIndex = normalized.indexOf("node_modules/");
  if (nmIndex === -1) return null;
  const fromNm = normalized.slice(nmIndex);
  const match =
    /^(node_modules\/(?:@[^/]+\/[^/]+|[^/]+)(?:\/node_modules\/(?:@[^/]+\/[^/]+|[^/]+))*)(?:\/|$)/.exec(
      fromNm,
    );
  return match ? match[1] : null;
}

export function inspectBundle(
  bundlePath: string,
  bundleContent: string,
  shippedRuntimeLocations: Set<string>,
): BundleReconciliation {
  const modulePaths = new Set<string>();
  const packageNames = new Set<string>();
  const installLocations = new Set<string>();
  const regex = /^\/\/ ((?:(?:\.\.\/)*[^\r\n]*\/)?node_modules\/[^\r\n]+)$/gm;
  for (const match of bundleContent.matchAll(regex)) {
    const rawMod = match[1];
    const nmIndex = rawMod.indexOf("node_modules/");
    const normalizedMod = nmIndex >= 0 ? rawMod.slice(nmIndex) : rawMod;
    modulePaths.add(normalizedMod);
    const installLoc = extractInstallLocationFromModulePath(normalizedMod);
    if (installLoc) {
      installLocations.add(installLoc);
      const pkgName = extractPackageNameFromNodeModulesPath(installLoc);
      if (pkgName) {
        packageNames.add(pkgName);
      }
    }
  }
  const sortedModules = [...modulePaths].sort();
  const sortedPackages = [...packageNames].sort();
  const sortedLocations = [...installLocations].sort();
  const unreconciledPackages = sortedLocations.filter(
    (loc) => !shippedRuntimeLocations.has(loc),
  );
  return {
    bundlePath,
    bundledPackages: sortedPackages,
    bundledLocations: sortedLocations,
    bundledModuleCount: sortedModules.length,
    bundledModulesSha256: sha256Text(sortedModules.join("\n")),
    unreconciledPackages,
  };
}

function extractNativeTarget(buildHelperScript: string | undefined): string {
  if (!buildHelperScript) {
    throw new Error(
      "package.json scripts['build:helper'] is required to determine native simulation target",
    );
  }
  const match = /--target\s+([A-Za-z0-9_.-]+)/.exec(buildHelperScript);
  if (!match) {
    throw new Error(
      `Unable to parse --target from scripts['build:helper']: ${buildHelperScript}`,
    );
  }
  return match[1];
}

interface RawCargoPackage {
  name?: unknown;
  version?: unknown;
  source?: unknown;
  checksum?: unknown;
  dependencies?: unknown;
}

export function generateDependencyInventory(
  options: InventoryOptions = {},
): DependencyInventory {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const pkgJsonPath = path.join(rootDir, "package.json");
  const pkgLockPath = path.join(rootDir, "package-lock.json");
  const cargoTomlPath = path.join(rootDir, "native/simulation/Cargo.toml");
  const cargoLockPath = path.join(rootDir, "native/simulation/Cargo.lock");
  const actionBundlePath = path.join(rootDir, "bundled/index.js");
  const commentBundlePath = path.join(rootDir, "bundled/comment-action.js");

  for (const requiredFile of [
    pkgJsonPath,
    pkgLockPath,
    cargoTomlPath,
    cargoLockPath,
    actionBundlePath,
    commentBundlePath,
  ]) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(
        `Required inventory input not found: ${path.relative(rootDir, requiredFile)}`,
      );
    }
  }

  const pkgJsonRaw = normalizeLf(fs.readFileSync(pkgJsonPath, "utf8"));
  const pkgLockRaw = normalizeLf(fs.readFileSync(pkgLockPath, "utf8"));
  const cargoTomlRaw = normalizeLf(fs.readFileSync(cargoTomlPath, "utf8"));
  const cargoLockRaw = normalizeLf(fs.readFileSync(cargoLockPath, "utf8"));
  const actionBundleRaw = normalizeLf(
    fs.readFileSync(actionBundlePath, "utf8"),
  );
  const commentBundleRaw = normalizeLf(
    fs.readFileSync(commentBundlePath, "utf8"),
  );

  const pkgJson = JSON.parse(pkgJsonRaw) as {
    name?: string;
    version?: string;
    files?: string[];
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, unknown>;
  };

  if (typeof pkgJson.name !== "string" || typeof pkgJson.version !== "string") {
    throw new Error("package.json must declare string name and version");
  }

  const declaredFiles = Array.isArray(pkgJson.files) ? pkgJson.files : [];
  for (const requiredEntry of REQUIRED_SHIPPED_PATHS) {
    if (!declaredFiles.includes(requiredEntry)) {
      throw new Error(
        `package.json files list is missing required shipped path: ${requiredEntry}`,
      );
    }
  }

  const nativeTarget = extractNativeTarget(pkgJson.scripts?.["build:helper"]);

  // Canonical hash of dependency-relevant package.json declarations so unrelated
  // documentation glob additions do not invalidate locked dependency provenance.
  const packageManifestSha256 = sha256Text(
    JSON.stringify({
      name: pkgJson.name,
      version: pkgJson.version,
      dependencies: pkgJson.dependencies ?? {},
      devDependencies: pkgJson.devDependencies ?? {},
      overrides: pkgJson.overrides ?? {},
      buildHelper: pkgJson.scripts?.["build:helper"] ?? "",
    }),
  );

  const pkgLock = JSON.parse(pkgLockRaw) as {
    lockfileVersion?: number;
    packages?: Record<
      string,
      {
        name?: string;
        version?: string;
        resolved?: string;
        integrity?: string;
        dev?: boolean;
        dependencies?: Record<string, string>;
      }
    >;
  };

  if (!pkgLock.packages || typeof pkgLock.packages !== "object") {
    throw new Error("package-lock.json must contain a packages object");
  }

  // First pass over npm lockfile entries: resolve every install location to its exact
  // locked (name, version) and build the package-level dependency graph.
  const directProdNames = new Set(Object.keys(pkgJson.dependencies ?? {}));
  const directDevNames = new Set(Object.keys(pkgJson.devDependencies ?? {}));

  interface NpmNode {
    location: string;
    name: string;
    version: string;
    resolved: string | null;
    integrity: string | null;
    dev: boolean;
    depNames: string[];
  }

  const npmNodesByLocation = new Map<string, NpmNode>();
  for (const [location, entry] of Object.entries(pkgLock.packages)) {
    if (location === "") continue;
    const name =
      typeof entry.name === "string" && entry.name.trim() !== ""
        ? entry.name.trim()
        : extractPackageNameFromNodeModulesPath(location);
    if (!name) {
      throw new Error(
        `Unable to determine package name for lockfile path: ${location}`,
      );
    }
    if (typeof entry.version !== "string" || entry.version.trim() === "") {
      throw new Error(
        `Lockfile entry ${location} (${name}) is missing an exact version string`,
      );
    }
    npmNodesByLocation.set(location, {
      location,
      name,
      version: entry.version.trim(),
      resolved:
        typeof entry.resolved === "string" && entry.resolved.trim() !== ""
          ? entry.resolved.trim()
          : null,
      integrity:
        typeof entry.integrity === "string" && entry.integrity.trim() !== ""
          ? entry.integrity.trim()
          : null,
      dev: Boolean(entry.dev),
      depNames: Object.keys(entry.dependencies ?? {}).sort(),
    });
  }

  // Resolve a dependency package name from a given node_modules location by walking up
  // nested node_modules directories, matching Node/npm resolution semantics.
  function resolveNpmTarget(
    fromLocation: string,
    depName: string,
  ): NpmNode | undefined {
    let prefix = fromLocation;
    while (true) {
      const candidate = prefix
        ? `${prefix}/node_modules/${depName}`
        : `node_modules/${depName}`;
      const found = npmNodesByLocation.get(candidate);
      if (found) return found;
      const parentIdx = prefix.lastIndexOf("/node_modules/");
      if (parentIdx === -1) {
        return npmNodesByLocation.get(`node_modules/${depName}`);
      }
      prefix = prefix.slice(0, parentIdx);
    }
  }

  // Compute build-tooling reachability from BUILD_TOOL_ROOTS
  const buildToolLocations = new Set<string>();
  const buildQueue: string[] = [];
  for (const rootName of BUILD_TOOL_ROOTS) {
    const node = npmNodesByLocation.get(`node_modules/${rootName}`);
    if (node) {
      buildToolLocations.add(node.location);
      buildQueue.push(node.location);
    }
  }
  while (buildQueue.length > 0) {
    const loc = buildQueue.shift()!;
    const node = npmNodesByLocation.get(loc);
    if (!node) continue;
    for (const depName of node.depNames) {
      const target = resolveNpmTarget(loc, depName);
      if (target && !buildToolLocations.has(target.location)) {
        buildToolLocations.add(target.location);
        buildQueue.push(target.location);
      }
    }
  }

  // Preliminary bundle scan to know which exact lockfile install locations are statically present in bundles
  const allNpmLocations = new Set(npmNodesByLocation.keys());
  const prelimActionBundle = inspectBundle(
    "bundled/index.js",
    actionBundleRaw,
    allNpmLocations,
  );
  const prelimCommentBundle = inspectBundle(
    "bundled/comment-action.js",
    commentBundleRaw,
    allNpmLocations,
  );
  const actionBundleLocSet = new Set(prelimActionBundle.bundledLocations);
  const commentBundleLocSet = new Set(prelimCommentBundle.bundledLocations);

  // Deduplicate npm nodes by canonical identity `npm:<name>@<version>`
  const npmComponentsById = new Map<
    string,
    {
      id: string;
      name: string;
      version: string;
      locations: Set<string>;
      dependencies: Set<string>;
      resolved: string | null;
      integrity: string | null;
      hasProdLocation: boolean;
      hasBuildToolLocation: boolean;
      direct: boolean;
    }
  >();

  for (const node of npmNodesByLocation.values()) {
    const id = `npm:${node.name}@${node.version}`;
    let existing = npmComponentsById.get(id);
    if (!existing) {
      existing = {
        id,
        name: node.name,
        version: node.version,
        locations: new Set<string>(),
        dependencies: new Set<string>(),
        resolved: node.resolved,
        integrity: node.integrity,
        hasProdLocation: false,
        hasBuildToolLocation: false,
        direct:
          node.location === `node_modules/${node.name}` &&
          (directProdNames.has(node.name) || directDevNames.has(node.name)),
      };
      npmComponentsById.set(id, existing);
    }
    existing.locations.add(node.location);
    if (!existing.resolved && node.resolved) existing.resolved = node.resolved;
    if (!existing.integrity && node.integrity)
      existing.integrity = node.integrity;
    if (!node.dev) existing.hasProdLocation = true;
    if (buildToolLocations.has(node.location))
      existing.hasBuildToolLocation = true;
    if (
      node.location === `node_modules/${node.name}` &&
      (directProdNames.has(node.name) || directDevNames.has(node.name))
    ) {
      existing.direct = true;
    }
    for (const depName of node.depNames) {
      const target = resolveNpmTarget(node.location, depName);
      if (target) {
        existing.dependencies.add(`npm:${target.name}@${target.version}`);
      }
    }
  }

  const npmComponents: InventoryComponent[] = [];
  const shippedRuntimeLocations = new Set<string>();

  for (const item of npmComponentsById.values()) {
    const sortedLocations = [...item.locations].sort();
    const inActionBundle = sortedLocations.some((loc) =>
      actionBundleLocSet.has(loc),
    );
    const inCommentBundle = sortedLocations.some((loc) =>
      commentBundleLocSet.has(loc),
    );
    const isShippedRuntime =
      item.hasProdLocation || inActionBundle || inCommentBundle;

    let classification: ComponentClassification;
    let bundleReachability: BundleReachability | undefined;

    if (isShippedRuntime) {
      classification = "shipped-runtime";
      for (const loc of sortedLocations) {
        shippedRuntimeLocations.add(loc);
      }
      const staticallyBundled = inActionBundle || inCommentBundle;
      bundleReachability = {
        inActionBundle,
        inCommentBundle,
        inclusionBasis: staticallyBundled
          ? "statically-bundled"
          : "conservative-production-lock",
        rationale: staticallyBundled
          ? "Observed directly in committed esbuild Action bundle module markers."
          : "Not emitted into committed esbuild bundles, but retained conservatively because it belongs to the non-dev production lock subgraph installed for dist/ library and CLI consumers.",
      };
    } else if (item.hasBuildToolLocation) {
      classification = "build-tooling";
    } else {
      classification = "dev-only";
    }

    const metadataCompleteness: MetadataCompleteness =
      item.resolved && item.integrity
        ? "complete"
        : "missing-source-or-integrity";

    npmComponents.push({
      id: item.id,
      purl: buildPurl("npm", item.name, item.version),
      ecosystem: "npm",
      name: item.name,
      version: item.version,
      classification,
      direct: item.direct,
      source: item.resolved,
      integrity: item.integrity,
      metadataCompleteness,
      locations: sortedLocations,
      dependencies: [...item.dependencies].sort(),
      ...(bundleReachability ? { bundleReachability } : {}),
    });
  }

  const actionBundle = inspectBundle(
    "bundled/index.js",
    actionBundleRaw,
    shippedRuntimeLocations,
  );
  const commentBundle = inspectBundle(
    "bundled/comment-action.js",
    commentBundleRaw,
    shippedRuntimeLocations,
  );
  if (actionBundle.unreconciledPackages.length > 0) {
    throw new Error(
      `Unreconciled packages in bundled/index.js: ${actionBundle.unreconciledPackages.join(", ")}`,
    );
  }
  if (commentBundle.unreconciledPackages.length > 0) {
    throw new Error(
      `Unreconciled packages in bundled/comment-action.js: ${commentBundle.unreconciledPackages.join(", ")}`,
    );
  }

  // Parse native/simulation/Cargo.toml and Cargo.lock
  const cargoToml = TOML.parse(cargoTomlRaw) as {
    package?: { name?: string; version?: string; edition?: string };
    dependencies?: Record<
      string,
      string | { version?: string; features?: string[] }
    >;
  };
  const rootCrateName = cargoToml.package?.name;
  const rootCrateEdition = cargoToml.package?.edition ?? null;
  if (typeof rootCrateName !== "string" || rootCrateName.trim() === "") {
    throw new Error("native/simulation/Cargo.toml must declare [package].name");
  }

  const declaredCargoDeps = cargoToml.dependencies ?? {};
  const directCargoNames = new Set(Object.keys(declaredCargoDeps));
  const declaredCargoFeatures = new Map<string, string[]>();
  for (const [depName, spec] of Object.entries(declaredCargoDeps)) {
    if (
      typeof spec === "object" &&
      spec !== null &&
      Array.isArray(spec.features)
    ) {
      declaredCargoFeatures.set(depName, [...spec.features].map(String).sort());
    } else {
      declaredCargoFeatures.set(depName, []);
    }
  }

  const cargoLock = TOML.parse(cargoLockRaw) as {
    package?: RawCargoPackage[];
  };
  if (!Array.isArray(cargoLock.package) || cargoLock.package.length === 0) {
    throw new Error(
      "native/simulation/Cargo.lock must contain [[package]] entries",
    );
  }

  interface ParsedCargoPkg {
    id: string;
    name: string;
    version: string;
    source: string | null;
    checksum: string | null;
    rawDeps: string[];
  }

  const cargoById = new Map<string, ParsedCargoPkg>();
  const cargoByName = new Map<string, ParsedCargoPkg[]>();

  for (const rawPkg of cargoLock.package) {
    if (
      typeof rawPkg.name !== "string" ||
      rawPkg.name.trim() === "" ||
      typeof rawPkg.version !== "string" ||
      rawPkg.version.trim() === ""
    ) {
      throw new Error(
        "Cargo.lock [[package]] entry is missing required string name or version",
      );
    }
    const name = rawPkg.name.trim();
    const version = rawPkg.version.trim();
    const id = `cargo:${name}@${version}`;
    const source =
      typeof rawPkg.source === "string" && rawPkg.source.trim() !== ""
        ? rawPkg.source.trim()
        : null;
    const checksum =
      typeof rawPkg.checksum === "string" && rawPkg.checksum.trim() !== ""
        ? rawPkg.checksum.trim()
        : null;
    const rawDeps = Array.isArray(rawPkg.dependencies)
      ? rawPkg.dependencies.map(String)
      : [];

    const existing = cargoById.get(id);
    if (!existing) {
      const parsed: ParsedCargoPkg = {
        id,
        name,
        version,
        source,
        checksum,
        rawDeps,
      };
      cargoById.set(id, parsed);
      const byName = cargoByName.get(name) ?? [];
      byName.push(parsed);
      cargoByName.set(name, byName);
    }
  }

  function resolveCargoDepSpecs(rawDeps: string[]): string[] {
    const resolved = new Set<string>();
    for (const spec of rawDeps) {
      const parts = spec.trim().split(/\s+/);
      const depName = parts[0];
      const depVersion = parts[1];
      if (depVersion) {
        const exact = cargoById.get(`cargo:${depName}@${depVersion}`);
        if (exact) {
          resolved.add(exact.id);
          continue;
        }
      }
      const candidates = cargoByName.get(depName) ?? [];
      if (candidates.length === 1) {
        resolved.add(candidates[0].id);
      } else {
        for (const c of candidates) {
          resolved.add(c.id);
        }
      }
    }
    return [...resolved].sort();
  }

  const rootCrates = cargoByName.get(rootCrateName) ?? [];
  if (rootCrates.length !== 1) {
    throw new Error(
      `Expected exactly one root crate ${rootCrateName} in Cargo.lock, found ${rootCrates.length}`,
    );
  }
  const rootCrate = rootCrates[0];

  // Traverse reachable Cargo graph from rootCrate
  const reachableCargoIds = new Set<string>([rootCrate.id]);
  const cargoQueue: string[] = [rootCrate.id];
  const resolvedCargoDepsById = new Map<string, string[]>();

  while (cargoQueue.length > 0) {
    const currentId = cargoQueue.shift()!;
    const pkg = cargoById.get(currentId);
    if (!pkg) continue;
    const deps = resolveCargoDepSpecs(pkg.rawDeps);
    resolvedCargoDepsById.set(currentId, deps);
    for (const depId of deps) {
      if (!reachableCargoIds.has(depId)) {
        reachableCargoIds.add(depId);
        cargoQueue.push(depId);
      }
    }
  }

  const cargoComponents: InventoryComponent[] = [];
  for (const id of [...reachableCargoIds].sort()) {
    const pkg = cargoById.get(id)!;
    const isRoot = pkg.name === rootCrateName;
    const isDirect = isRoot || directCargoNames.has(pkg.name);
    const metadataCompleteness: MetadataCompleteness = isRoot
      ? "workspace-root"
      : pkg.source && pkg.checksum
        ? "complete"
        : "missing-source-or-integrity";

    cargoComponents.push({
      id: pkg.id,
      purl: buildPurl("cargo", pkg.name, pkg.version),
      ecosystem: "cargo",
      name: pkg.name,
      version: pkg.version,
      classification: "native-helper",
      direct: isDirect,
      source: pkg.source,
      integrity: pkg.checksum ? `sha256:${pkg.checksum}` : null,
      metadataCompleteness,
      locations: isRoot
        ? ["native/simulation/Cargo.toml", "native/simulation/Cargo.lock"]
        : ["native/simulation/Cargo.lock"],
      dependencies: resolvedCargoDepsById.get(id) ?? [],
      nativeMetadata: {
        target: nativeTarget,
        declaredFeatures: isRoot
          ? []
          : (declaredCargoFeatures.get(pkg.name) ?? []),
        edition: isRoot ? rootCrateEdition : null,
      },
    });
  }

  const components = [...npmComponents, ...cargoComponents].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const byClassification: Record<ComponentClassification, number> = {
    "shipped-runtime": 0,
    "native-helper": 0,
    "build-tooling": 0,
    "dev-only": 0,
  };
  let conservativeRuntimeComponents = 0;
  for (const comp of components) {
    byClassification[comp.classification] += 1;
    if (
      comp.bundleReachability?.inclusionBasis === "conservative-production-lock"
    ) {
      conservativeRuntimeComponents += 1;
    }
  }

  return {
    schemaVersion: DEPENDENCY_INVENTORY_SCHEMA_VERSION,
    disclaimer: DEPENDENCY_INVENTORY_DISCLAIMER,
    deduplicationPolicy: {
      identityKey: "<ecosystem>:<name>@<version>",
      sameVersionMultiplePaths:
        "Deduplicated into a single component entry with all sorted install locations preserved.",
      distinctVersionsSameName:
        "Retained as separate component records so exact locked version and integrity metadata are never conflated.",
    },
    inputs: {
      packageManifestSha256,
      npmLockfileSha256: sha256Text(pkgLockRaw),
      cargoManifestSha256: sha256Text(cargoTomlRaw),
      cargoLockfileSha256: sha256Text(cargoLockRaw),
      nativeTarget,
    },
    packageDistribution: {
      packageName: pkgJson.name,
      packageVersion: pkgJson.version,
      requiredShippedPaths: [...REQUIRED_SHIPPED_PATHS],
      actionBundle,
      commentBundle,
    },
    summary: {
      totalComponents: components.length,
      npmComponents: npmComponents.length,
      cargoComponents: cargoComponents.length,
      byClassification,
      conservativeRuntimeComponents,
    },
    components,
  };
}

export function verifyDependencyInventory(
  inventory: DependencyInventory,
  options: InventoryOptions = {},
): void {
  const expected = generateDependencyInventory(options);
  const actualJson = JSON.stringify(inventory, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  if (actualJson !== expectedJson) {
    throw new Error(
      "Dependency inventory does not match locked repository inputs; regenerate docs/dependency-inventory.json",
    );
  }
}
