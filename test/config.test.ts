import { describe, expect, it } from 'vitest';
import * as Config from '../src/Config.js';

describe('Config', () => {
  it('builds Blockfrost endpoints with the project token on each URL', () => {
    const c = Config.blockfrost('preprod', 'tok123');
    expect(c).toEqual({
      networkId: 'preprod',
      indexer: 'https://midnight-preprod.blockfrost.io/api/v0?project_id=tok123',
      indexerWS: 'wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=tok123',
      node: 'wss://rpc.midnight-preprod.blockfrost.io?project_id=tok123',
      proofServer: 'http://localhost:6300',
    });
    expect(Config.blockfrost('mainnet', 'm', { proofServer: 'http://p:6300' }).node).toBe(
      'wss://rpc.midnight-mainnet.blockfrost.io?project_id=m',
    );
  });

  it('requires a token', () => {
    expect(() => Config.blockfrost('preprod', '')).toThrow(/token/);
  });

  it('points Blockfrost-hosted names at Config.blockfrost instead of returning stale endpoints', () => {
    expect(() => Config.getNetworkConfig('preprod')).toThrow(/Config\.blockfrost\('preprod'/);
    expect(() => Config.getNetworkConfig('nope')).toThrow(/Unknown network/);
    expect(Config.getNetworkConfig('preview').indexer).toContain('indexer.preview.midnight.network');
  });

  it('redacts tokens', () => {
    expect(Config.redactUrl(Config.blockfrost('preprod', 'secret').indexerWS)).not.toContain('secret');
  });

  describe('withQueryTimeout', () => {
    const provider = {
      queryContractState: (address: string) => Promise.resolve(`state of ${address}`),
      queryZSwapAndContractState: () => new Promise<never>(() => {}),
      watchForTxData: () => new Promise<never>(() => {}),
    };

    it('fails a query that never answers instead of hanging', async () => {
      const bounded = Config.withQueryTimeout(provider, 20);
      await expect(bounded.queryZSwapAndContractState()).rejects.toMatchObject({
        _tag: 'IndexerQueryTimeoutError',
        method: 'queryZSwapAndContractState',
        timeout: 20,
      });
    });

    it('passes answers through and leaves watches unbounded', async () => {
      const bounded = Config.withQueryTimeout(provider, 20);
      await expect(bounded.queryContractState('abc')).resolves.toBe('state of abc');
      expect(bounded.watchForTxData).toBe(provider.watchForTxData);
    });
  });
});
