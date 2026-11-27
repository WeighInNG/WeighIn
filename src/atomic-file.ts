// SPDX-License-Identifier: Apache-2.0

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const TEMPORARY_FILE_ATTEMPTS = 5;

interface OwnedTemporaryFile {
  path: string;
  fd: number;
}

export interface AtomicWriteOptions {
  onCleanupError?: (temporaryPath: string, error: Error) => void;
}

export function temporaryFilePath(targetPath: string): string {
  const unique = `${process.pid.toString(36)}-${crypto
    .randomBytes(8)
    .toString("hex")}`;
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${unique}.tmp`,
  );
}

function createOwnedTemporaryFile(targetPath: string): OwnedTemporaryFile {
  let lastError: unknown;
  for (let attempt = 0; attempt < TEMPORARY_FILE_ATTEMPTS; attempt++) {
    const candidate = temporaryFilePath(targetPath);
    try {
      const fd = fs.openSync(candidate, "wx", 0o666);
      return { path: candidate, fd };
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  }
  throw lastError;
}

function removeOwnedTemporaryFile(
  temporaryPath: string,
  onCleanupError?: (temporaryPath: string, error: Error) => void,
): void {
  try {
    fs.unlinkSync(temporaryPath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    onCleanupError?.(temporaryPath, error);
  }
}

export function writeFileAtomically(
  targetPath: string,
  body: string,
  options: AtomicWriteOptions = {},
): void {
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  const temporary = createOwnedTemporaryFile(targetPath);
  let closed = false;
  try {
    fs.writeFileSync(temporary.fd, body, "utf8");
    fs.closeSync(temporary.fd);
    closed = true;
    fs.renameSync(temporary.path, targetPath);
  } catch (error) {
    if (!closed) {
      try {
        fs.closeSync(temporary.fd);
      } catch {}
    }
    removeOwnedTemporaryFile(temporary.path, options.onCleanupError);
    throw error;
  }
}
