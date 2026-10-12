import { afterAll, describe, expect, it } from 'vitest';
import { Cluster, Faucet, FeeRelay } from '../src/devnet/index.js';
import * as Wallet from '../src/Wallet.js';

/**
 * The shipped faucet and fee-relay images: built from this SDK, started next to
 * a devnet cluster, and exercised over HTTP the way browser examples use them.
 * Requires Docker; builds the images on first run (several minutes).
 */
const CLUSTER = 'midday-servers-test';
const FAUCET_PORT = 23001;
const RELAY_PORT = 23002;

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${url}/health not healthy after ${timeoutMs}ms: ${lastError}`);
}

describe('devnet helper-server images', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  });

  it('faucet and fee-relay containers start from the SDK-built images and serve requests', { timeout: 900_000 }, async () => {
    const cluster = await Cluster.make({
      clusterName: CLUSTER,
      node: { port: 29945 },
      indexer: { port: 28089 },
      proofServer: { port: 26301 },
    });
    cleanup.push(() => cluster.remove());
    await cluster.start();

    const faucetId = await Faucet.startDocker(cluster.networkConfig, { clusterName: CLUSTER, port: FAUCET_PORT });
    cleanup.push(() => Faucet.stopDocker(faucetId));
    const relayId = await FeeRelay.startDocker(cluster.networkConfig, { clusterName: CLUSTER, port: RELAY_PORT });
    cleanup.push(() => FeeRelay.stopDocker(relayId));

    await waitForHealth(`http://localhost:${FAUCET_PORT}`, 120_000);
    await waitForHealth(`http://localhost:${RELAY_PORT}`, 120_000);

    // A fresh wallet's unshielded address, funded through the container.
    const seed = 'ab'.repeat(31) + '07';
    const wallet = await Wallet.fromSeed(seed, cluster.networkConfig);
    cleanup.push(() => wallet.close());
    const res = await fetch(`http://localhost:${FAUCET_PORT}/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unshieldedAddress: wallet.addresses.unshielded }),
    });
    const body = (await res.json()) as { txId?: string; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.txId).toMatch(/^[0-9a-f]{32,}$/); // a ledger TransactionIdentifier, hex

    // The relay rejects a malformed body instead of crashing or hanging.
    const bad = await fetch(`http://localhost:${RELAY_PORT}/balance-finalized-tx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
  });
});
