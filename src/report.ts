import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export interface OutputPathValidationOptions {
  headWorkspace: string;
  reportPath?: string;
  metadataPath?: string;
  fixturesPath?: string;
  configPath?: string;
  trustedPolicyPath?: string;
}

export interface CanonicalPathInfo {
  rawPath: string;
  lexicalPath: string;
  canonicalPath: string;
  symlinkPath: string | null;
}

function lstatOrNull(targetPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
}

function normalizeForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrParentPath(
  pathA: string,
  pathB: string,
): "same" | "parent" | null {
  const normA = normalizeForComparison(pathA);
  const normB = normalizeForComparison(pathB);
  if (normA === normB) return "same";
  const prefixA = normA.endsWith(path.sep) ? normA : normA + path.sep;
  const prefixB = normB.endsWith(path.sep) ? normB : normB + path.sep;
  if (normB.startsWith(prefixA) || normA.startsWith(prefixB)) {
    return "parent";
  }
  return null;
}

function findSymlinkAlongPath(
  resolvedWorkspace: string,
  lexicalPath: string,
): string | null {
  const normWorkspace = normalizeForComparison(resolvedWorkspace);
  const normLexical = normalizeForComparison(lexicalPath);
  const workspacePrefix = normWorkspace.endsWith(path.sep)
    ? normWorkspace
    : normWorkspace + path.sep;

  if (
    normLexical === normWorkspace ||
    normLexical.startsWith(workspacePrefix)
  ) {
    const rel = path.relative(resolvedWorkspace, lexicalPath);
    const parts = rel.split(path.sep).filter(Boolean);
    let current = resolvedWorkspace;
    for (const part of parts) {
      current = path.join(current, part);
      const stat = lstatOrNull(current);
      if (stat?.isSymbolicLink()) {
        return current;
      }
    }
    return null;
  }

  let current = lexicalPath;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat?.isSymbolicLink()) {
      return current;
    }
    if (stat) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveCanonicalTargetPath(
  targetPath: string,
  visited: Set<string> = new Set(),
): string {
  const missingSuffix: string[] = [];
  let current = path.resolve(targetPath);

  while (true) {
    const stat = lstatOrNull(current);
    if (stat) {
      if (stat.isSymbolicLink()) {
        const visitKey = normalizeForComparison(current);
        if (visited.has(visitKey)) {
          throw new Error(
            `Invalid output path: symlink loop detected while resolving ${targetPath}`,
          );
        }
        visited.add(visitKey);
        const linkTarget = fs.readlinkSync(current);
        const resolvedLink = path.resolve(path.dirname(current), linkTarget);
        const nextTarget =
          missingSuffix.length > 0
            ? path.join(resolvedLink, ...missingSuffix)
            : resolvedLink;
        return resolveCanonicalTargetPath(nextTarget, visited);
      }
      const realExisting = fs.realpathSync(current);
      return missingSuffix.length > 0
        ? path.join(realExisting, ...missingSuffix)
        : realExisting;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return missingSuffix.length > 0
        ? path.join(current, ...missingSuffix)
        : current;
    }
    missingSuffix.unshift(path.basename(current));
    current = parent;
  }
}

export function inspectWorkspacePath(
  headWorkspace: string,
  rawPath: string,
): CanonicalPathInfo {
  const resolvedWorkspace = path.resolve(headWorkspace);
  const lexicalPath = path.resolve(resolvedWorkspace, rawPath);
  const symlinkPath = findSymlinkAlongPath(resolvedWorkspace, lexicalPath);
  const canonicalPath = resolveCanonicalTargetPath(lexicalPath);
  return {
    rawPath,
    lexicalPath,
    canonicalPath,
    symlinkPath,
  };
}

function checkPairCollision(
  outputLabel: string,
  outputInfo: CanonicalPathInfo,
  otherLabel: string,
  otherInfo: CanonicalPathInfo,
): void {
  const lexicalRelation = isSameOrParentPath(
    outputInfo.lexicalPath,
    otherInfo.lexicalPath,
  );
  const canonicalRelation = isSameOrParentPath(
    outputInfo.canonicalPath,
    otherInfo.canonicalPath,
  );
  const relation = canonicalRelation ?? lexicalRelation;
  if (!relation) return;

  const viaSymlink =
    outputInfo.symlinkPath || otherInfo.symlinkPath
      ? ` via existing symlink (${outputInfo.symlinkPath ?? otherInfo.symlinkPath})`
      : "";

  if (relation === "same") {
    throw new Error(
      `Colliding output path: ${outputLabel} (${outputInfo.rawPath}) and ${otherLabel} (${otherInfo.rawPath}) resolve to the same destination (${outputInfo.canonicalPath})${viaSymlink}`,
    );
  }
  throw new Error(
    `Colliding output path: ${outputLabel} (${outputInfo.rawPath}) and ${otherLabel} (${otherInfo.rawPath}) conflict as parent/child paths (${outputInfo.canonicalPath} vs ${otherInfo.canonicalPath})${viaSymlink}`,
  );
}

export function validateOutputPaths(options: OutputPathValidationOptions): {
  report: CanonicalPathInfo | null;
  metadata: CanonicalPathInfo | null;
} {
  const resolvedWorkspace = path.resolve(options.headWorkspace);
  const canonicalWorkspace = resolveCanonicalTargetPath(resolvedWorkspace);

  const reportRaw = options.reportPath ?? "";
  const metadataRaw = options.metadataPath ?? "";

  if (reportRaw.length > 0 && reportRaw.trim() === "") {
    throw new Error(
      "Invalid output path: report-path must not be blank or whitespace-only",
    );
  }
  if (metadataRaw.length > 0 && metadataRaw.trim() === "") {
    throw new Error(
      "Invalid output path: metadata-path must not be blank or whitespace-only",
    );
  }

  const reportInfo = reportRaw
    ? inspectWorkspacePath(resolvedWorkspace, reportRaw)
    : null;
  const metadataInfo = metadataRaw
    ? inspectWorkspacePath(resolvedWorkspace, metadataRaw)
    : null;

  const fixturesRaw =
    options.fixturesPath ||
    core.getInput("fixtures-path") ||
    "weighin-fixtures.json";
  const configRaw =
    options.configPath || core.getInput("config-path") || "weighin.toml";
  const trustedPolicyRaw =
    options.trustedPolicyPath || core.getInput("trusted-policy-path") || "";

  const inputSpecs: Array<{ label: string; info: CanonicalPathInfo }> = [
    {
      label: "fixtures-path",
      info: inspectWorkspacePath(resolvedWorkspace, fixturesRaw),
    },
    {
      label: "config-path",
      info: inspectWorkspacePath(resolvedWorkspace, configRaw),
    },
  ];
  if (trustedPolicyRaw.trim()) {
    inputSpecs.push({
      label: "trusted-policy-path",
      info: inspectWorkspacePath(resolvedWorkspace, trustedPolicyRaw.trim()),
    });
  }

  if (reportInfo && metadataInfo) {
    checkPairCollision(
      "report-path",
      reportInfo,
      "metadata-path",
      metadataInfo,
    );
  }

  for (const [outputLabel, outputInfo] of [
    ["report-path", reportInfo],
    ["metadata-path", metadataInfo],
  ] as const) {
    if (!outputInfo) continue;

    if (
      normalizeForComparison(outputInfo.canonicalPath) ===
        normalizeForComparison(canonicalWorkspace) ||
      normalizeForComparison(outputInfo.lexicalPath) ===
        normalizeForComparison(resolvedWorkspace)
    ) {
      throw new Error(
        `Invalid output path: ${outputLabel} (${outputInfo.rawPath}) resolves to the workspace root directory (${outputInfo.canonicalPath})`,
      );
    }

    for (const inputSpec of inputSpecs) {
      checkPairCollision(
        outputLabel,
        outputInfo,
        inputSpec.label,
        inputSpec.info,
      );
    }

    if (outputInfo.symlinkPath) {
      throw new Error(
        `Invalid output path: ${outputLabel} (${outputInfo.rawPath}) aliases or traverses an existing symlink (${outputInfo.symlinkPath} -> ${outputInfo.canonicalPath})`,
      );
    }
  }

  return { report: reportInfo, metadata: metadataInfo };
}

export function writeMetadataFile(
  metadataPathInput: string,
  headWorkspace: string,
  content: string,
  options?: Omit<OutputPathValidationOptions, "headWorkspace" | "metadataPath">,
): void {
  if (!metadataPathInput) return;
  const { metadata } = validateOutputPaths({
    headWorkspace,
    metadataPath: metadataPathInput,
    reportPath: options?.reportPath ?? core.getInput("report-path"),
    ...options,
  });
  const targetPath = metadata!.lexicalPath;
  try {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, content, "utf8");
    core.info(`Wrote PR metadata to ${targetPath}`);
  } catch (err: any) {
    throw new Error(
      `Failed to write WeighIn metadata to ${targetPath}: ${err.message}`,
    );
  }
}

export function writeReportFile(
  reportPathInput: string,
  headWorkspace: string,
  body: string,
  options?: Omit<OutputPathValidationOptions, "headWorkspace" | "reportPath">,
): void {
  if (!reportPathInput) return;
  const { report } = validateOutputPaths({
    headWorkspace,
    reportPath: reportPathInput,
    metadataPath: options?.metadataPath ?? core.getInput("metadata-path"),
    ...options,
  });
  const targetPath = report!.lexicalPath;
  try {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, body, "utf8");
    core.info(`Wrote Markdown report to ${targetPath}`);
  } catch (err: any) {
    throw new Error(
      `Failed to write WeighIn report to ${targetPath}: ${err.message}`,
    );
  }
}
