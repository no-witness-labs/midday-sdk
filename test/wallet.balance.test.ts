import { describe, expect, it, vi } from 'vitest';
import * as Wallet from '../src/Wallet.js';
import { unboundHandle } from './helpers/ledger.js';

describe('seed wallet balancing', () => {
  it('forwards the selected token pools to the wallet facade', async () => {
    const tx = await unboundHandle();
    const ttl = new Date('2026-08-15T00:00:00.000Z');
    const adopted = {};
    const recipe = {};
    const signedRecipe = {};
    const finalizedBytes = new Uint8Array([1, 2, 3]);
    const signDataAsync = vi.fn();

    const adoptTransaction = vi.fn().mockReturnValue(adopted);
    const balanceUnboundTransaction = vi.fn().mockResolvedValue(recipe);
    const signRecipe = vi.fn().mockResolvedValue(signedRecipe);
    const finalizeRecipe = vi.fn().mockResolvedValue({ serialize: () => finalizedBytes });
    const context = {
      wallet: { adoptTransaction, balanceUnboundTransaction, signRecipe, finalizeRecipe },
      unshieldedKeystore: { signDataAsync },
      networkId: 'undeployed',
    } as unknown as Wallet.WalletContext;

    const result = await Wallet.balanceAndFinalize(context, tx, ttl, {
      tokenKindsToBalance: ['unshielded', 'dust'],
    });

    expect(result).toBe(finalizedBytes);
    expect(adoptTransaction).toHaveBeenCalledWith(tx.serialize(), 'Unbound');
    expect(balanceUnboundTransaction).toHaveBeenCalledWith(adopted, { ttl, tokenKindsToBalance: ['unshielded', 'dust'] });
    expect(signRecipe).toHaveBeenCalledWith(recipe, signDataAsync);
    expect(finalizeRecipe).toHaveBeenCalledWith(signedRecipe);
  });
});
