import { Keypair, xdr } from '@stellar/stellar-sdk';

const DEADLINE_MS = 120_000;
const REQUEST_MS = 15_000;
const RETRY_MS = 2_000;
const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);
class TemporaryReadinessError extends Error {}

/** Confirm account inclusion through RPC; funding success alone is insufficient.
 * Only transport/timeouts and temporary HTTP failures are retried. Invalid RPC,
 * permanent funding errors and deadline exhaustion fail before measurement.
 */
export async function ensureAccountReady(rpcUrl: string, publicKey: string): Promise<void> {
  const base = new URL(rpcUrl);
  base.pathname = base.pathname.replace(/\/rpc\/?$/, '').replace(/\/$/, '') + '/friendbot';
  base.search = ''; base.hash = ''; base.searchParams.set('addr', publicKey);
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
    accountId: Keypair.fromPublicKey(publicKey).xdrPublicKey(),
  })).toXDR('base64');
  const deadline = Date.now() + DEADLINE_MS;
  let funded = false, lastError = 'account has not appeared in RPC';
  async function request(url: string, options: RequestInit = {}): Promise<string> {
    try {
      const response = await fetch(url, { ...options,
        signal: AbortSignal.timeout(Math.max(1, Math.min(REQUEST_MS, deadline - Date.now()))) });
      if (!response.ok) {
        // Consume the response under the same timeout before retrying.
        await response.text();
        const message = `HTTP ${response.status} ${response.statusText}`;
        if (TRANSIENT_HTTP.has(response.status)) throw new TemporaryReadinessError(message);
        throw new Error(message);
      }
      return await response.text();
    } catch (error: any) {
      if (error instanceof TemporaryReadinessError) throw error;
      if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error?.name)) {
        throw new TemporaryReadinessError(`transport failure: ${error.message}`);
      }
      throw error;
    }
  }
  while (Date.now() < deadline) {
    try {
      const response = await request(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedgerEntries', params: { keys: [key] } }) });
      const json = JSON.parse(response) as any;
      if (json.error) throw new Error(`Account readiness RPC error: ${JSON.stringify(json.error)}`);
      const entries = json.result?.entries;
      if (!Number.isInteger(json.result?.latestLedger) || json.result.latestLedger <= 0 ||
          !Array.isArray(entries) || entries.length > 1) throw new Error('Invalid account readiness RPC response');
      if (entries.length === 1) {
        const entry = entries[0];
        const value = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64');
        if (entry.key !== key || value.switch().name !== 'account' ||
            value.account().accountId().toXDR('base64') !== Keypair.fromPublicKey(publicKey).xdrPublicKey().toXDR('base64')) {
          throw new Error('Account readiness RPC returned an unrelated account');
        }
        console.log(`Deployer account confirmed in RPC: ${publicKey}`);
        return;
      }
      if (!funded) {
        console.log(`Funding deployer account: ${publicKey} via friendbot...`);
        await request(base.toString());
        funded = true;
      }
      lastError = 'funded account has not appeared in RPC';
    } catch (error: any) {
      // A response body can time out after fetch has resolved.
      if (!(error instanceof TemporaryReadinessError) && !['TimeoutError', 'AbortError'].includes(error?.name)) throw error;
      lastError = error.message;
      console.warn(`Account readiness retry: ${lastError}`);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(RETRY_MS, remaining)));
  }
  throw new Error(`Account readiness failed within ${DEADLINE_MS / 1000}s: ${lastError}`);
}
