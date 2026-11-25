// SPDX-License-Identifier: Apache-2.0
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export class CancellationError extends Error {
  constructor(message = "WeighIn run cancelled") {
    super(message);
    this.name = "CancellationError";
  }
}

interface OwnedCleanup {
  target: string;
  label: string;
  cleanup: () => Promise<void> | void;
}

export interface CancellationScope {
  readonly signal: AbortSignal;
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly ownedPaths: readonly string[];
  registerChild(child: childProcess.ChildProcess): void;
  registerOwnedPath(
    target: string,
    cleanup: () => Promise<void> | void,
    label?: string,
  ): void;
  exec(
    command: string,
    args?: string[],
    options?: exec.ExecOptions,
  ): Promise<number>;
  requestCancel(reason?: string | Error): void;
  shutdown(): Promise<void>;
  dispose(): void;
}

export interface CancellationScopeOptions {
  installSignalHandlers?: boolean;
  signals?: NodeJS.Signals[];
  setExitCodeOnCancel?: boolean;
  onCancel?: (reason: Error) => void;
}

const OWNED_PATH_PREFIX = "weighin-";
const CHILD_TERMINATION_GRACE_MS = 2_000;

let activeScope: CancellationScope | null = null;

class Scope implements CancellationScope {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly children = new Set<childProcess.ChildProcess>();
  private readonly cleanups: OwnedCleanup[] = [];
  private readonly signalHandlers = new Map<NodeJS.Signals, () => void>();
  private termination: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: CancellationScopeOptions) {
    this.signal = this.controller.signal;
    if (options.installSignalHandlers) {
      const signals = options.signals ?? ["SIGTERM", "SIGINT"];
      for (const signal of signals) {
        const handler = () => {
          this.requestCancel(`Received ${signal}; cancelling WeighIn run`);
        };
        process.on(signal, handler);
        this.signalHandlers.set(signal, handler);
      }
    }
  }

  get aborted(): boolean {
    return this.signal.aborted;
  }

  get reason(): unknown {
    return this.signal.reason;
  }

  get ownedPaths(): readonly string[] {
    return this.cleanups.map((item) => item.target);
  }

  registerChild(child: childProcess.ChildProcess): void {
    if (this.children.has(child)) return;
    if (child.exitCode !== null || child.signalCode !== null || child.killed)
      return;
    this.children.add(child);
    child.once("exit", () => {
      this.children.delete(child);
    });
  }

  registerOwnedPath(
    target: string,
    cleanup: () => Promise<void> | void,
    label = "owned temporary path",
  ): void {
    const resolved = path.resolve(target);
    let canonical: string;
    try {
      canonical = fs.realpathSync(resolved);
    } catch (error: any) {
      throw new Error(
        `Cannot register missing owned path ${target}: ${error.message}`,
      );
    }
    const tmpRoot = fs.realpathSync(os.tmpdir());
    if (
      path.dirname(canonical) !== tmpRoot ||
      !path.basename(canonical).startsWith(OWNED_PATH_PREFIX)
    ) {
      throw new Error(
        `Refusing to register non-owned path for cancellation cleanup: ${target}`,
      );
    }
    if (this.cleanups.some((item) => item.target === canonical)) return;
    this.cleanups.push({ target: canonical, label, cleanup });
  }

  async exec(
    command: string,
    args: string[] = [],
    options: exec.ExecOptions = {},
  ): Promise<number> {
    if (this.signal.aborted) throw this.cancelReason();

    const originalSpawn = childProcess.spawn;
    const patchedSpawn = ((...spawnArgs: any[]) => {
      const child = (originalSpawn as any)(
        ...spawnArgs,
      ) as childProcess.ChildProcess;
      this.registerChild(child);
      return child;
    }) as typeof childProcess.spawn;
    (childProcess as any).spawn = patchedSpawn;

    const running = exec.exec(command, args, options);
    running.catch(() => undefined);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      if (this.signal.aborted) reject(this.cancelReason());
      else {
        onAbort = () => reject(this.cancelReason());
        this.signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    try {
      return await Promise.race([running, aborted]);
    } finally {
      if (onAbort) this.signal.removeEventListener("abort", onAbort);
      if ((childProcess as any).spawn === patchedSpawn) {
        (childProcess as any).spawn = originalSpawn;
      }
    }
  }

  requestCancel(reason: string | Error = "WeighIn run cancelled"): void {
    if (this.signal.aborted) return;
    const error =
      reason instanceof Error ? reason : new CancellationError(reason);
    this.controller.abort(error);
    if (this.options.setExitCodeOnCancel) process.exitCode = 1;
    this.options.onCancel?.(error);
    void this.terminateChildren();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      await this.terminateChildren();
      const cleanups = [...this.cleanups].reverse();
      this.cleanups.length = 0;
      for (const item of cleanups) {
        try {
          await item.cleanup();
        } catch (error: any) {
          core.warning(
            `Could not clean up ${item.label} at ${item.target}: ${error.message}`,
          );
        }
      }
    })();
    return this.shutdownPromise;
  }

  dispose(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers.clear();
    if (activeScope === this) activeScope = null;
  }

  private cancelReason(): Error {
    const reason = this.signal.reason;
    return reason instanceof Error
      ? reason
      : new CancellationError(
          reason === undefined ? undefined : String(reason),
        );
  }

  private terminateChildren(): Promise<void> {
    if (this.termination) return this.termination;
    const children = [...this.children];
    this.termination = (async () => {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {}
              resolve();
            }, CHILD_TERMINATION_GRACE_MS);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }),
      );
      this.children.clear();
    })();
    return this.termination;
  }
}

export function createCancellationScope(
  options: CancellationScopeOptions = {},
): CancellationScope {
  return new Scope(options);
}

export function setActiveCancellationScope(
  scope: CancellationScope | null,
): void {
  activeScope = scope;
}

export function getActiveCancellationScope(): CancellationScope | null {
  return activeScope;
}

export async function trackedExec(
  command: string,
  args?: string[],
  options?: exec.ExecOptions,
): Promise<number> {
  const scope = activeScope;
  if (scope) return scope.exec(command, args, options);
  return exec.exec(command, args, options);
}

export function registerOwnedTempPath(
  target: string,
  cleanup: () => Promise<void> | void,
  label?: string,
): void {
  activeScope?.registerOwnedPath(target, cleanup, label);
}

export function registerChildProcess(child: childProcess.ChildProcess): void {
  activeScope?.registerChild(child);
}

export async function runWithCancellation<T>(
  scope: CancellationScope,
  work: (signal: AbortSignal) => Promise<T>,
  options?: { reportFailure?: boolean },
): Promise<T> {
  try {
    return await work(scope.signal);
  } catch (error) {
    if (scope.aborted && options?.reportFailure !== false) {
      const reason = scope.reason;
      core.setFailed(
        `WeighIn run cancelled: ${
          reason instanceof Error
            ? reason.message
            : String(reason ?? "unknown reason")
        }`,
      );
    }
    throw error;
  } finally {
    await scope.shutdown();
  }
}
