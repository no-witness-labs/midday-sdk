import { describe, expect, it } from 'vitest';
import * as Config from '../src/Config.js';
import * as Contract from '../src/Contract.js';

const ADDRESS = '0'.repeat(63) + 'c';

/** A public data provider that answers state queries from a stub. */
const providerWith = (impl: Partial<Record<string, unknown>>) => impl as unknown as Contract.PublicDataProvider;

describe('state read failures keep their identity', () => {
  it('reports a parser failure as StateDecodeError with the address', async () => {
    const provider = providerWith({ queryContractState: async () => ({ data: { not: 'ledger' } }) });
    const parser = () => {
      throw new Error('unexpected shape');
    };
    await expect(Contract.readState(ADDRESS, provider, parser)).rejects.toMatchObject({
      _tag: 'StateDecodeError',
      address: ADDRESS,
      message: expect.stringMatching(/unexpected shape/),
    });
  });

  it('passes an indexer query timeout through instead of wrapping it', async () => {
    const timeout = new Config.IndexerQueryTimeoutError({ method: 'queryContractState', timeout: 5, message: 'slow' });
    const provider = providerWith({ queryContractState: async () => Promise.reject(timeout) });
    await expect(Contract.readStateValue(ADDRESS, provider)).rejects.toMatchObject({ _tag: 'IndexerQueryTimeoutError', method: 'queryContractState' });
  });

  it('still distinguishes a missing contract', async () => {
    const provider = providerWith({ queryContractState: async () => null });
    await expect(Contract.readStateValue(ADDRESS, provider)).rejects.toMatchObject({ _tag: 'ContractStateNotFoundError', address: ADDRESS });
  });
});

describe('subscriptions report failures to the observer', () => {
  it('calls error when the state stream fails and stops', async () => {
    const provider = providerWith({
      contractStateObservable: () => ({
        subscribe: (o: { next: (v: unknown) => void; error: (e: unknown) => void }) => {
          setTimeout(() => o.error(new Error('indexer went away')), 0);
          return { unsubscribe: () => undefined };
        },
      }),
    });
    const failure = new Promise<unknown>((resolve) => {
      Contract.watchStateValue(ADDRESS, provider, { next: () => undefined, error: resolve });
    });
    await expect(failure).resolves.toMatchObject({ _tag: 'ContractError', message: expect.stringMatching(/indexer went away/) });
  });

  it('surfaces a decode failure through the observer too', async () => {
    const provider = providerWith({
      contractStateObservable: () => ({
        subscribe: (o: { next: (v: unknown) => void; error: (e: unknown) => void }) => {
          setTimeout(() => o.next({ data: 'x' }), 0);
          return { unsubscribe: () => undefined };
        },
      }),
    });
    const failure = new Promise<unknown>((resolve) => {
      Contract.watchState(
        ADDRESS,
        provider,
        () => {
          throw new Error('cannot decode');
        },
        { next: () => undefined, error: resolve },
      );
    });
    await expect(failure).resolves.toMatchObject({ _tag: 'StateDecodeError', address: ADDRESS });
  });
});
