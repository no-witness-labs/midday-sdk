import { Effect } from 'effect';
import { CostModel } from '@midnight-ntwrk/ledger-v8';
import { describe, expect, it, vi } from 'vitest';
import * as Client from '../src/Client.js';
import * as Contract from '../src/Contract.js';
import * as PrivateState from '../src/PrivateState.js';
import type * as Wallet from '../src/Wallet.js';

const keys = {
  get: vi.fn(),
  getZKIR: vi.fn(),
  getProverKey: vi.fn(),
  getVerifierKey: vi.fn(),
  getVerifierKeys: vi.fn(),
} as unknown as Parameters<typeof Contract.walletProofProvider>[1];

const provingProvider: Wallet.ProvingProvider = { check: vi.fn(), prove: vi.fn() };

function unprovenTx() {
  return { prove: vi.fn(async () => 'proven') } as unknown as Parameters<Contract.ContractProviders['proofProvider']['proveTx']>[0];
}

describe('walletProofProvider', () => {
  it("proves a transaction with the wallet's proving provider for the contract's keys", async () => {
    const walletProving = vi.fn(async () => provingProvider);
    const proofProvider = Contract.walletProofProvider(walletProving, keys);
    const tx = unprovenTx();

    expect(await proofProvider.proveTx(tx)).toBe('proven');
    await proofProvider.proveTx(unprovenTx());

    expect(walletProving).toHaveBeenCalledTimes(1);
    expect(walletProving).toHaveBeenCalledWith(keys);
    expect(tx.prove).toHaveBeenCalledWith(provingProvider, expect.any(CostModel));
  });

  it('asks the wallet again after a failed request', async () => {
    const walletProving = vi.fn()
      .mockRejectedValueOnce(new Error('user rejected'))
      .mockResolvedValueOnce(provingProvider);
    const proofProvider = Contract.walletProofProvider(walletProving, keys);

    await expect(proofProvider.proveTx(unprovenTx())).rejects.toThrow('user rejected');
    expect(await proofProvider.proveTx(unprovenTx())).toBe('proven');
    expect(walletProving).toHaveBeenCalledTimes(2);
  });
});

describe('Client.fromWallet proving', () => {
  const connection = (proverServerUri?: string) => ({
    wallet: { getProvingProvider: vi.fn(async () => provingProvider) },
    config: {
      networkId: 'preprod',
      indexerUri: 'https://indexer.example/api/v4/graphql',
      indexerWsUri: 'wss://indexer.example/api/v4/graphql/ws',
      substrateNodeUri: 'wss://node.example',
      proverServerUri,
    },
    addresses: {},
    coinPublicKey: '',
    encryptionPublicKey: '',
  }) as unknown as Wallet.WalletConnection;
  const privateStateProvider = PrivateState.inMemoryPrivateStateProvider();

  it('proves through the wallet by default, without a proof server', async () => {
    const conn = connection();
    const client = await Client.fromWallet(conn, { privateStateProvider });
    const prover = await client.providers.walletProving!(keys);
    expect(prover).toBe(provingProvider);
    expect(conn.wallet.getProvingProvider).toHaveBeenCalledWith(keys);
  });

  it("uses the wallet's proof server only when asked, and requires one", async () => {
    const client = await Client.fromWallet(connection('http://localhost:6300'), { privateStateProvider, proving: 'proof-server' });
    expect(client.providers.walletProving).toBeUndefined();
    await expect(Client.fromWallet(connection(), { privateStateProvider, proving: 'proof-server' }))
      .rejects.toThrow(/needs a wallet that reports proverServerUri/);
  });
});

describe('Client.create proving with a connected wallet', () => {
  const privateStateProvider = PrivateState.inMemoryPrivateStateProvider();
  const connectedWallet = (provingProvider?: Wallet.ConnectedWallet['provingProvider']) => ({
    type: 'connected',
    source: provingProvider ? 'browser' : 'seed',
    networkId: 'undeployed',
    addresses: { shielded: '', unshielded: '' },
    coinPublicKey: '',
    encryptionPublicKey: '',
    ...(provingProvider ? { provingProvider } : {}),
    effect: { providers: () => Effect.succeed({ walletProvider: {}, midnightProvider: {} }) },
  }) as unknown as Wallet.ConnectedWallet;

  it('proves through a browser wallet by default and through the proof server when asked', async () => {
    const prove = vi.fn(async () => provingProvider);
    const viaWallet = await Client.create({ wallet: connectedWallet(prove), privateStateProvider });
    expect(viaWallet.providers.walletProving).toBe(prove);
    const viaServer = await Client.create({ wallet: connectedWallet(prove), privateStateProvider, proving: 'proof-server' });
    expect(viaServer.providers.walletProving).toBeUndefined();
  });

  it('keeps the proof server for a seed wallet and refuses wallet proving for it', async () => {
    const client = await Client.create({ wallet: connectedWallet(), privateStateProvider });
    expect(client.providers.walletProving).toBeUndefined();
    await expect(Client.create({ wallet: connectedWallet(), privateStateProvider, proving: 'wallet' }))
      .rejects.toThrow(/needs a browser wallet/);
  });
});
