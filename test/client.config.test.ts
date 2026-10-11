import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Client from '../src/Client.js';
import * as Config from '../src/Config.js';
import * as Contract from '../src/Contract.js';
import * as PrivateState from '../src/PrivateState.js';

// These checks must fail before any wallet or network I/O, so they run without Docker.
const privateStateProvider = PrivateState.inMemoryPrivateStateProvider();
const preprod = Config.blockfrost('preprod', 'tok');

describe('Client.create network and seed guards', () => {
  it('does not imply the development seed for a custom network config', async () => {
    await expect(Client.create({ networkConfig: preprod, privateStateProvider })).rejects.toMatchObject({
      _tag: 'ClientError',
      message: expect.stringMatching(/seed is required for network 'preprod'/),
    });
  });

  it('refuses the development seed on a public network even when passed explicitly', async () => {
    await expect(
      Client.create({ networkConfig: preprod, seed: Config.DEV_WALLET_SEED, privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Refusing the development wallet seed/) });
    await expect(
      Client.create({ network: 'preview', seed: Config.DEV_WALLET_SEED, privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Refusing the development wallet seed/) });
  });

  it('rejects a preset name that contradicts the custom network config', async () => {
    await expect(
      Client.create({ network: 'preview', networkConfig: preprod, seed: 'ab'.repeat(32), privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/contradicts networkConfig/) });
    expect(() => Client.createReadonly({ network: 'preview', networkConfig: preprod })).toThrow(
      /contradicts networkConfig/,
    );
  });

  it('rejects feeRelay for a seed wallet instead of ignoring it', async () => {
    await expect(
      Client.create({ network: 'preview', seed: 'ab'.repeat(32), feeRelay: { url: 'http://relay' }, privateStateProvider }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/feeRelay requires a browser wallet/) });
  });

  describe('with a connected wallet', () => {
    const fakeWallet = (networkId: string, networkConfig?: Config.NetworkConfig) =>
      ({
        type: 'connected',
        source: 'browser',
        networkId,
        ...(networkConfig ? { networkConfig } : {}),
        address: 'addr',
        coinPublicKey: '',
        encryptionPublicKey: '',
        effect: { providers: () => Effect.succeed({ walletProvider: {}, midnightProvider: {} }) },
      }) as never;

    it("uses the wallet's network when none is given", async () => {
      const client = await Client.create({ wallet: fakeWallet('preview'), privateStateProvider });
      expect(client.networkConfig.networkId).toBe('preview');
      expect(client.networkConfig.indexer).toBe(Config.NETWORKS.preview.indexer);
    });

    it("prefers the wallet's own endpoints when it carries them", async () => {
      const custom = { ...Config.NETWORKS.local, indexer: 'http://custom:8088/api/v3/graphql' };
      const client = await Client.create({ wallet: fakeWallet('undeployed', custom), privateStateProvider });
      expect(client.networkConfig.indexer).toBe('http://custom:8088/api/v3/graphql');
    });

    it('rejects a preset or config that disagrees with the wallet', async () => {
      await expect(Client.create({ wallet: fakeWallet('preview'), network: 'local', privateStateProvider })).rejects.toMatchObject({
        message: expect.stringMatching(/wallet is on 'preview'/),
      });
      await expect(
        Client.create({ wallet: fakeWallet('preview'), networkConfig: preprod, privateStateProvider }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/wallet is on 'preview'/) });
    });

    it('asks for a config when the wallet is on a network without a preset', async () => {
      await expect(Client.create({ wallet: fakeWallet('preprod'), privateStateProvider })).rejects.toMatchObject({
        message: expect.stringMatching(/Config\.blockfrost\('preprod'/),
      });
    });
  });

  it('exposes one TxTimeoutError class under one tag', () => {
    expect(Client.TxTimeoutError).toBe(Contract.TxTimeoutError);
    const e = new Client.TxTimeoutError({ operation: 'waitForTx', timeout: 1, message: 'm', txHash: 'h' });
    expect(e._tag).toBe('TxTimeoutError');
  });

  it('still requires a seed for a named public preset', async () => {
    await expect(Client.create({ network: 'preview', privateStateProvider })).rejects.toMatchObject({
      message: expect.stringMatching(/seed is required for network 'preview'/),
    });
  });
});
