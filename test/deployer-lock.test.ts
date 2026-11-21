import { describe, it, expect, beforeEach } from "vitest";
import {
  DeployerLockManager,
  formatLockKey,
  acquireDeployerLock,
  withDeployerLock,
  deployerLockManager,
} from "../src/deployer-lock";
import { Keypair } from "@stellar/stellar-sdk";

describe("DeployerLockManager (same-process deployer locking #222)", () => {
  let manager: DeployerLockManager;
  const networkA = "Standalone Network ; February 2017";
  const networkB = "Test SDF Network ; September 2015";
  const account1 = Keypair.random().publicKey();
  const account2 = Keypair.random().publicKey();

  beforeEach(() => {
    manager = new DeployerLockManager();
    deployerLockManager.clear();
  });

  it("defines same-process locking keyed by network and public account", async () => {
    expect(formatLockKey(networkA, account1)).toBe(`${networkA}:${account1}`);
    expect(formatLockKey(networkB, account1)).toBe(`${networkB}:${account1}`);
    expect(formatLockKey(networkA, account2)).toBe(`${networkA}:${account2}`);

    const release1 = await manager.acquire(networkA, account1);
    expect(manager.getActiveLockCount()).toBe(1);

    // Locks for a different network or account do NOT block
    let account2Acquired = false;
    const release2 = await manager.acquire(networkA, account2);
    account2Acquired = true;
    expect(account2Acquired).toBe(true);

    let networkBAcquired = false;
    const release3 = await manager.acquire(networkB, account1);
    networkBAcquired = true;
    expect(networkBAcquired).toBe(true);

    release1();
    release2();
    release3();
  });

  it("serializes concurrent calls for the same network and account", async () => {
    const order: number[] = [];
    let concurrentRunning = 0;
    let maxConcurrent = 0;

    async function task(id: number, delayMs: number) {
      return manager.withLock(networkA, account1, async () => {
        concurrentRunning++;
        maxConcurrent = Math.max(maxConcurrent, concurrentRunning);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id);
        concurrentRunning--;
        return id;
      });
    }

    const results = await Promise.all([task(1, 30), task(2, 20), task(3, 10)]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxConcurrent).toBe(1);
    expect(manager.getActiveLockCount()).toBe(0);
  });

  it("releases ownership on rejected or failed transactions", async () => {
    let secondTaskExecuted = false;

    // First task fails
    await expect(
      manager.withLock(networkA, account1, async () => {
        throw new Error("Transaction submission rejected (status=ERROR)");
      }),
    ).rejects.toThrow("Transaction submission rejected (status=ERROR)");

    // Second task must still be able to acquire ownership without hanging
    const result = await manager.withLock(networkA, account1, async () => {
      secondTaskExecuted = true;
      return "success";
    });

    expect(secondTaskExecuted).toBe(true);
    expect(result).toBe("success");
    expect(manager.getActiveLockCount()).toBe(0);
  });

  it("releases ownership when acquire handle release is called twice", async () => {
    const release = await manager.acquire(networkA, account1);
    expect(manager.getActiveLockCount()).toBe(1);
    release();
    expect(() => release()).not.toThrow();
    expect(manager.getActiveLockCount()).toBe(0);
  });

  it("proves concurrent calls neither sign duplicate sequence numbers nor hang", async () => {
    // Simulated RPC state with an account sequence number
    let onChainSequence = 1000n;
    const signedSequences: bigint[] = [];

    // Simulated deployment call that reads sequence, simulates network latency, signs, and updates sequence
    async function deployTransaction(callId: string, shouldFail = false) {
      return manager.withLock(networkA, account1, async () => {
        // 1. Read on-chain account sequence (critical section)
        const currentSeq = onChainSequence;
        // Simulate network latency / transaction preparation
        await new Promise((r) => setTimeout(r, 15));

        if (shouldFail) {
          throw new Error(`Deployment ${callId} failed during submission`);
        }

        // 2. Sign transaction with sequence + 1
        const nextSeq = currentSeq + 1n;
        signedSequences.push(nextSeq);

        // 3. Confirm on-chain update
        onChainSequence = nextSeq;
        return { callId, sequence: nextSeq };
      });
    }

    // Launch 5 concurrent deployment attempts, including one failure in the middle
    const [call1, call2Fail, call3, call4, call5] = await Promise.allSettled([
      deployTransaction("deploy-1", false),
      deployTransaction("deploy-2-fail", true),
      deployTransaction("deploy-3", false),
      deployTransaction("deploy-4", false),
      deployTransaction("deploy-5", false),
    ]);

    expect(call1.status).toBe("fulfilled");
    expect(call2Fail.status).toBe("rejected");
    expect(call3.status).toBe("fulfilled");
    expect(call4.status).toBe("fulfilled");
    expect(call5.status).toBe("fulfilled");

    // All successful calls must have signed strictly increasing, non-duplicate sequence numbers
    expect(signedSequences).toEqual([1001n, 1002n, 1003n, 1004n]);
    const uniqueSequences = new Set(signedSequences);
    expect(uniqueSequences.size).toBe(signedSequences.length);

    // Verify manager clean release
    expect(manager.getActiveLockCount()).toBe(0);
  });

  it("supports global acquireDeployerLock and withDeployerLock helpers", async () => {
    let ran = false;
    await withDeployerLock(networkA, account1, async () => {
      ran = true;
    });
    expect(ran).toBe(true);

    const release = await acquireDeployerLock(networkA, account1);
    expect(typeof release).toBe("function");
    release();
  });
});
