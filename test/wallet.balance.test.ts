import { describe, expect, it, vi } from 'vitest';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import * as Wallet from '../src/Wallet.js';

describe('seed wallet balancing', () => {
  it('forwards the selected token pools to the wallet facade', async () => {
    const tx = {} as UnboundTransaction;
    const ttl = new Date('2026-08-15T00:00:00.000Z');
    const recipe = {};
    const signedRecipe = {};
    const finalized = {};
    const shieldedSecretKeys = {};
    const dustSecretKey = {};

    const balanceUnboundTransaction = vi.fn().mockResolvedValue(recipe);
    const signRecipe = vi.fn().mockResolvedValue(signedRecipe);
    const finalizeRecipe = vi.fn().mockResolvedValue(finalized);
    const context = {
      wallet: { balanceUnboundTransaction, signRecipe, finalizeRecipe },
      shieldedSecretKeys,
      dustSecretKey,
      unshieldedKeystore: { signData: vi.fn() },
      networkId: 'undeployed',
    } as unknown as Wallet.WalletContext;

    const result = await Wallet.balanceAndFinalize(context, tx, ttl, {
      tokenKindsToBalance: ['unshielded', 'dust'],
    });

    expect(result).toBe(finalized);
    expect(balanceUnboundTransaction).toHaveBeenCalledWith(
      tx,
      { shieldedSecretKeys, dustSecretKey },
      { ttl, tokenKindsToBalance: ['unshielded', 'dust'] },
    );
  });
});
