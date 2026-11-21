/**
 * Same-process locking keyed by network and public account.
 * Serializes transaction sequence usage for a caller-supplied shared deployer.
 */

export interface DeployerLockKey {
  network: string;
  publicAccount: string;
}

export function formatLockKey(network: string, publicAccount: string): string {
  return `${network}:${publicAccount}`;
}

export class DeployerLockManager {
  private activeLocks = new Map<string, Promise<void>>();

  /**
   * Acquire an exclusive lock for the given network and public account.
   * Returns a release function that MUST be called when done (e.g. in a finally block).
   */
  async acquire(network: string, publicAccount: string): Promise<() => void> {
    const key = formatLockKey(network, publicAccount);
    let releaseCurrent!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const previousLock = this.activeLocks.get(key) ?? Promise.resolve();
    // Chain our lock; whether previous succeeds or fails, we continue
    const currentWait = previousLock.then(
      () => lockPromise,
      () => lockPromise,
    );
    this.activeLocks.set(key, currentWait);

    // Wait for the previous holder to release
    try {
      await previousLock;
    } catch {
      // If previous lock somehow threw, we still acquire ownership
    }

    let released = false;
    return () => {
      if (!released) {
        released = true;
        releaseCurrent();
        if (this.activeLocks.get(key) === currentWait) {
          this.activeLocks.delete(key);
        }
      }
    };
  }

  /**
   * Execute an asynchronous action with exclusive ownership for the given
   * network and public account. Guarantees release even if action rejects or fails.
   */
  async withLock<T>(
    network: string,
    publicAccount: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(network, publicAccount);
    try {
      return await action();
    } finally {
      release();
    }
  }

  /** Inspect the number of active lock chains (for diagnostics and testing). */
  getActiveLockCount(): number {
    return this.activeLocks.size;
  }

  /** Reset all locks (for testing environments). */
  clear(): void {
    this.activeLocks.clear();
  }
}

export const deployerLockManager = new DeployerLockManager();

export async function acquireDeployerLock(
  network: string,
  publicAccount: string,
): Promise<() => void> {
  return deployerLockManager.acquire(network, publicAccount);
}

export async function withDeployerLock<T>(
  network: string,
  publicAccount: string,
  action: () => Promise<T>,
): Promise<T> {
  return deployerLockManager.withLock(network, publicAccount, action);
}
