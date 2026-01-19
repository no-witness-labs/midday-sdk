/**
 * Provider setup for contract interactions on Midnight Network.
 *
 * Creates the provider stack needed for deploying and interacting with contracts.
 *
 * @since 0.1.0
 * @module
 */

import * as ledger from '@midnight-ntwrk/ledger-v6';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { WalletProvider, MidnightProvider, BalancedProvingRecipe } from '@midnight-ntwrk/midnight-js-types';

import type { NetworkConfig } from './Config.js';
import type { WalletContext } from './Wallet.js';

export interface StorageConfig {
  /** Path for LevelDB private state storage (default: '.data/midnight-level-db') */
  path?: string;
  /** Storage password (default from MIDNIGHT_STORAGE_PASSWORD env or generated) */
  password?: string;
}

export interface ContractProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  privateStateProvider: ReturnType<typeof levelPrivateStateProvider>;
  proofProvider: ReturnType<typeof httpClientProofProvider>;
  zkConfigProvider: NodeZkConfigProvider<string>;
}

export function create(
  walletContext: WalletContext,
  zkConfigPath: string,
  networkConfig: NetworkConfig,
  storageConfig: StorageConfig = {},
): ContractProviders {
  // Set network ID
  setNetworkId(networkConfig.networkId as 'undeployed');

  // Storage configuration
  const storagePath = storageConfig.path || '.data/midnight-level-db';
  const storagePassword = storageConfig.password || process.env.MIDNIGHT_STORAGE_PASSWORD || '1234567890123456';

  // Wallet provider - handles transaction balancing
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => walletContext.shieldedSecretKeys.coinPublicKey as unknown as ledger.CoinPublicKey,
    getEncryptionPublicKey: () => walletContext.shieldedSecretKeys.encryptionPublicKey as unknown as ledger.EncPublicKey,
    balanceTx: async (tx: ledger.UnprovenTransaction, newCoins?: unknown[], ttl?: Date): Promise<BalancedProvingRecipe> => {
      const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      const provingRecipe = await walletContext.wallet.balanceTransaction(
        walletContext.shieldedSecretKeys,
        walletContext.dustSecretKey,
        tx as unknown as ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
        txTtl,
      );
      return provingRecipe as unknown as BalancedProvingRecipe;
    },
  };

  // Midnight provider - handles transaction submission
  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: ledger.FinalizedTransaction) => await walletContext.wallet.submitTransaction(tx),
  };

  // Public data provider - reads from indexer
  const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

  // Private state provider - local encrypted storage
  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: storagePath,
    privateStoragePasswordProvider: () => storagePassword,
  });

  // Proof provider - generates ZK proofs
  const proofProvider = httpClientProofProvider(networkConfig.proofServer);

  // ZK config provider - circuit keys and config
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  return {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    proofProvider,
    zkConfigProvider,
  };
}
