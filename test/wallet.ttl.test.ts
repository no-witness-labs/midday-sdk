import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Wallet from '../src/Wallet.js';

/**
 * Seed-wallet `balanceTx` with a fake wallet whose sync wait takes a long time.
 * The TTL must be taken after that wait, or a slow sync leaves an already
 * expired intent for the node to reject (error 182).
 */
const T0 = new Date('2026-10-11T00:00:00Z').getTime();
const SYNC_MS = 40 * 60_000; // longer than the 30-minute default TTL
const sentinel = new Error('stop at balancing');

function fakeContext(recorded: { ttl?: Date }) {
  const wallet = {
    waitForSyncedState: async () => {
      vi.setSystemTime(T0 + SYNC_MS);
    },
    balanceUnboundTransaction: async (_tx: unknown, _keys: unknown, opts: { ttl: Date }) => {
      recorded.ttl = opts.ttl;
      throw sentinel;
    },
  };
  return { wallet, shieldedSecretKeys: {}, dustSecretKey: {}, unshieldedKeystore: {} } as unknown as Wallet.WalletContext;
}

describe('seed wallet balanceTx TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('anchors the default TTL after the sync wait', async () => {
    const recorded: { ttl?: Date } = {};
    const { walletProvider } = await Effect.runPromise(Wallet.effect.providers(fakeContext(recorded)));

    await expect(walletProvider.balanceTx({} as never)).rejects.toBe(sentinel);
    // Old behaviour: T0 + 30 min, already 10 minutes in the past once the sync finished.
    expect(recorded.ttl!.getTime()).toBe(T0 + SYNC_MS + 30 * 60_000);
  });

  it('honours txTtlMs after the wait', async () => {
    const recorded: { ttl?: Date } = {};
    const { walletProvider } = await Effect.runPromise(
      Wallet.effect.providers(fakeContext(recorded), { txTtlMs: 5 * 60_000 }),
    );
    await expect(walletProvider.balanceTx({} as never)).rejects.toBe(sentinel);
    expect(recorded.ttl!.getTime()).toBe(T0 + SYNC_MS + 5 * 60_000);
  });

  it('fails a caller TTL that expired during the wait instead of balancing a doomed transaction', async () => {
    const recorded: { ttl?: Date } = {};
    const { walletProvider } = await Effect.runPromise(Wallet.effect.providers(fakeContext(recorded)));

    await expect(walletProvider.balanceTx({} as never, new Date(T0 + 60_000))).rejects.toThrow(
      /TTL .* expired while waiting for the wallet to sync/,
    );
    expect(recorded.ttl).toBeUndefined();
  });
});
