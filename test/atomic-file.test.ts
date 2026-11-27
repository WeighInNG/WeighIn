import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mocked = {
    ...actual,
    openSync: vi.fn(actual.openSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    closeSync: vi.fn(actual.closeSync),
    renameSync: vi.fn(actual.renameSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
  return { ...mocked, default: mocked };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { temporaryFilePath, writeFileAtomically } from "../src/atomic-file";

const actualFs = await vi.importActual<typeof import("fs")>("fs");

function errno(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

function temporaryPaths(): string[] {
  return vi
    .mocked(fs.openSync)
    .mock.calls.map((call) => String(call[0]))
    .filter((candidate) => candidate.endsWith(".tmp"));
}

describe("atomic result delivery", () => {
  let tempDir: string;
  let target: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weighin-cli-output-"));
    target = path.join(tempDir, "nested", "deep", "results.json");
  });

  afterEach(() => {
    vi.resetAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates missing parents and publishes complete JSON through a temporary file in the destination directory", () => {
    const payload = { contract_id: "example", benchmarks: [] };
    writeFileAtomically(target, JSON.stringify(payload, null, 2));

    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual(payload);
    const writes = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writes).toHaveLength(1);
    expect(typeof writes[0][0]).toBe("number");

    const temporaries = temporaryPaths();
    expect(temporaries).toHaveLength(1);
    expect(path.dirname(temporaries[0])).toBe(path.dirname(target));
    expect(temporaries[0]).not.toBe(target);

    const renames = vi.mocked(fs.renameSync).mock.calls;
    expect(renames).toHaveLength(1);
    expect(renames[0][0]).toBe(temporaries[0]);
    expect(renames[0][1]).toBe(target);
  });

  it("closes the temporary handle before replacing the destination", () => {
    writeFileAtomically(target, "{}");

    const closed = vi.mocked(fs.closeSync).mock.invocationCallOrder[0];
    const renamed = vi.mocked(fs.renameSync).mock.invocationCallOrder[0];
    expect(closed).toBeLessThan(renamed);
  });

  it("preserves an existing destination when the write fails after a partial write", () => {
    actualFs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = '{"previous":true}';
    actualFs.writeFileSync(target, previous);
    vi.mocked(fs.writeFileSync).mockImplementationOnce((handle: any) => {
      actualFs.writeFileSync(handle, '{"partial":');
      throw errno("ENOSPC", "no space left on device");
    });

    expect(() => writeFileAtomically(target, '{"next":true}')).toThrow(
      /ENOSPC/,
    );
    expect(fs.readFileSync(target, "utf8")).toBe(previous);
    expect(fs.existsSync(temporaryPaths()[0])).toBe(false);
  });

  it("preserves an existing destination when the rename fails", () => {
    actualFs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = '{"previous":true}';
    actualFs.writeFileSync(target, previous);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw errno("EXDEV", "cross-device link not permitted");
    });

    expect(() => writeFileAtomically(target, '{"next":true}')).toThrow(/EXDEV/);
    expect(fs.readFileSync(target, "utf8")).toBe(previous);
    expect(fs.existsSync(temporaryPaths()[0])).toBe(false);
  });

  it("never removes another writer's temporary file", () => {
    actualFs.mkdirSync(path.dirname(target), { recursive: true });
    const foreign = path.join(
      path.dirname(target),
      ".results.json.foreign.tmp",
    );
    actualFs.writeFileSync(foreign, "another writer");
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw errno("ENOSPC", "no space left on device");
    });

    expect(() => writeFileAtomically(target, "{}")).toThrow(/ENOSPC/);
    expect(fs.readFileSync(foreign, "utf8")).toBe("another writer");
  });

  it("reports a cleanup failure without masking the original write error", () => {
    actualFs.mkdirSync(path.dirname(target), { recursive: true });
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw errno("ENOSPC", "no space left on device");
    });
    vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
      throw errno("EACCES", "permission denied");
    });
    const onCleanupError = vi.fn();

    expect(() => writeFileAtomically(target, "{}", { onCleanupError })).toThrow(
      /ENOSPC/,
    );
    expect(onCleanupError).toHaveBeenCalledWith(
      temporaryPaths()[0],
      expect.any(Error),
    );
  });

  it("uses a different temporary file for each invocation", () => {
    expect(temporaryFilePath(target)).not.toBe(temporaryFilePath(target));

    writeFileAtomically(target, "first");
    writeFileAtomically(target, "second");

    const temporaries = temporaryPaths();
    expect(temporaries).toHaveLength(2);
    expect(new Set(temporaries).size).toBe(2);
    expect(fs.readFileSync(target, "utf8")).toBe("second");
  });

  it("fails predictably when the destination parent cannot be created", () => {
    const blocker = path.join(tempDir, "blocker");
    actualFs.writeFileSync(blocker, "not a directory");

    expect(() =>
      writeFileAtomically(path.join(blocker, "results.json"), "{}"),
    ).toThrow(/ENOTDIR|EEXIST/);
    expect(actualFs.readFileSync(blocker, "utf8")).toBe("not a directory");
  });
});
