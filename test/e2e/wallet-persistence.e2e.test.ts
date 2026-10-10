import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Cluster } from '../../src/devnet/index.js';
import * as Midday from '../../src/index.js';
import * as CounterContract from '../../contracts/counter/contract/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTER_CONTRACT_DIR = join(__dirname, '../../contracts/counter');

// Genesis wallet seed - pre-funded on devnet
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * E2E: persist a seed wallet's sync state, restore it, and keep transacting.
 *
 * Run with: pnpm test:e2e
 */
describe('Wallet persistence E2E', () => {
  const CLUSTER_NAME = 'e2e-wallet-persistence';
  const PORTS = { node: 19960, indexer: 18100, proofServer: 16320 };

  let cluster: Cluster.Cluster;
  let snapshot: string;
  let postTxSnapshot: string | undefined;
  let snapshotBalance: Midday.Wallet.WalletBalance;
  const timings: Record<string, number> = {};

  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    timings[label] = Math.round(performance.now() - start);
    return result;
  };

  beforeAll(async () => {
    cluster = await Cluster.make({
      clusterName: CLUSTER_NAME,
      node: { port: PORTS.node },
      indexer: { port: PORTS.indexer },
      proofServer: { port: PORTS.proofServer },
    });
    await cluster.start();
  }, 300_000);

  afterAll(async () => {
    console.log('[wallet-persistence] sync timings (ms):', JSON.stringify(timings));
    if (cluster) {
      try {
        await cluster.remove();
      } catch {
        // Ignore cleanup errors
      }
    }
  }, 120_000);

  it('syncs a fresh wallet and serializes its state', { timeout: 300_000 }, async () => {
    const wallet = await timed('freshSync', () => Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig));
    try {
      snapshotBalance = await wallet.getBalance();
      expect(Object.keys(snapshotBalance.unshielded).length).toBeGreaterThan(0);

      snapshot = await wallet.serializeState();
      const parsed = JSON.parse(snapshot) as Record<string, unknown>;
      expect(parsed.version).toBe(Midday.Wallet.WALLET_SNAPSHOT_VERSION);
      expect(parsed.networkId).toBe(cluster.networkConfig.networkId);
      expect(parsed.packages).toEqual(Midday.Wallet.WALLET_SNAPSHOT_PACKAGES);
      timings.snapshotBytes = snapshot.length;
    } finally {
      await wallet.close();
    }
  });

  it('restores from the snapshot with matching balances', { timeout: 300_000 }, async () => {
    expect(snapshot).toBeDefined();

    const restored = await timed('restoredSync', () =>
      Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig, { restoreState: snapshot }),
    );
    try {
      const balance = await restored.getBalance();
      expect(balance.shielded).toEqual(snapshotBalance.shielded);
      expect(balance.unshielded).toEqual(snapshotBalance.unshielded);
      expect(balance.dust.cap).toBe(snapshotBalance.dust.cap);
      // DUST accrues over time, so it can only have grown since the snapshot.
      expect(balance.dust.balance >= snapshotBalance.dust.balance).toBe(true);
    } finally {
      await restored.close();
    }

    // Ground truth at the current chain tip: a second fresh sync must agree.
    const fresh = await timed('freshSync2', () => Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig));
    try {
      const truth = await fresh.getBalance();
      expect(truth.shielded).toEqual(snapshotBalance.shielded);
      expect(truth.unshielded).toEqual(snapshotBalance.unshielded);
      expect(truth.dust.cap).toBe(snapshotBalance.dust.cap);
    } finally {
      await fresh.close();
    }
  });

  it('rejects the snapshot for a different seed', { timeout: 60_000 }, async () => {
    await expect(
      Midday.Wallet.fromSeed('b'.repeat(64), cluster.networkConfig, { restoreState: snapshot }),
    ).rejects.toMatchObject({ _tag: 'WalletSnapshotError', reason: 'key-mismatch' });
  });

  it('submits transactions from a restored wallet', { timeout: 600_000 }, async () => {
    const restored = await Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig, { restoreState: snapshot });
    const client = await Midday.Client.create({
      wallet: restored,
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
      logging: false,
      balance: { tokenKindsToBalance: ['unshielded', 'dust'] },
    });
    try {
      const loaded = await client.loadContract({
        module: CounterContract,
        zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
        privateStateId: 'wallet-persistence-e2e',
      });
      const contract = await loaded.deploy();
      expect(contract.address).toMatch(/^[0-9a-f]+$/i);

      const result = await contract.actions.increment();
      expect(result.txHash).toBeDefined();
      expect(result.blockHeight).toBeGreaterThan(0);

      // Once submissions settle, the wallet can be snapshotted again.
      let next: string | undefined;
      for (let attempt = 0; attempt < 30 && next === undefined; attempt++) {
        try {
          next = await restored.serializeState();
        } catch (err) {
          if ((err as { reason?: string }).reason !== 'pending-transactions') throw err;
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }
      expect(next).toBeDefined();
      postTxSnapshot = next;
    } finally {
      await client.close();
      await restored.close();
    }
  });

  it('restores a post-transaction snapshot that matches a fresh sync', { timeout: 300_000 }, async () => {
    expect(postTxSnapshot).toBeDefined();
    const restored = await timed('restoredSyncPostTx', () =>
      Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig, { restoreState: postTxSnapshot }),
    );
    const fresh = await timed('freshSyncPostTx', () => Midday.Wallet.fromSeed(GENESIS_SEED, cluster.networkConfig));
    try {
      const [a, b] = await Promise.all([restored.getBalance(), fresh.getBalance()]);
      expect(a.shielded).toEqual(b.shielded);
      expect(a.unshielded).toEqual(b.unshielded);
      expect(a.dust.cap).toBe(b.dust.cap);
    } finally {
      await Promise.all([restored.close(), fresh.close()]);
    }
  });
});
