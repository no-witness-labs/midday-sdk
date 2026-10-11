import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Wallet from '../src/Wallet.js';

/** Browser-wallet submission: Lace's `submitTransaction` returns nothing, so the id must come from the transaction itself. */
describe('browser submitTx transaction id', () => {
  const tx = (ids: string[]) =>
    ({ serialize: () => new Uint8Array([1, 2, 3]), identifiers: () => ids }) as never;

  it('returns the first ledger identifier, not the serialized bytes', async () => {
    const submitted: string[] = [];
    const wallet = { submitTransaction: async (hex: string) => void submitted.push(hex) } as never;

    const id = await Effect.runPromise(Wallet.effect.submitTx(wallet, tx(['id-0', 'id-1'])));
    expect(id).toBe('id-0');
    expect(submitted).toEqual(['010203']);
  });

  it('fails when the transaction carries no identifiers', async () => {
    const wallet = { submitTransaction: async () => undefined } as never;
    await expect(Effect.runPromise(Wallet.effect.submitTx(wallet, tx([])))).rejects.toThrow(/no identifiers/);
  });

  it('exposes the same rule as transactionIdOf', () => {
    expect(Wallet.transactionIdOf(tx(['x']))).toBe('x');
  });
});
