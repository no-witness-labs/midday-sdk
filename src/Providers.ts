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
import type {
  WalletProvider,
  MidnightProvider,
  BalancedProvingRecipe,
  ZKConfigProvider,
  PrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-types';

import type { NetworkConfig } from './Config.js';
import type { WalletContext } from './Wallet.js';

export interface StorageConfig {
  /** Storage password */
  password?: string;
}

export interface ContractProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  privateStateProvider: PrivateStateProvider;
  proofProvider: ReturnType<typeof httpClientProofProvider>;
  zkConfigProvider: ZKConfigProvider<string>;
}

/**
 * Options for creating providers.
 */
export interface CreateProvidersOptions {
  /** Network configuration */
  networkConfig: NetworkConfig;
  /** ZK configuration provider */
  zkConfigProvider: ZKConfigProvider<string>;
  /** Private state provider */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storageConfig?: StorageConfig;
}

/**
 * Create contract providers from wallet context.
 *
 * @param walletContext - Initialized wallet context
 * @param options - Provider options including zkConfig and privateState providers
 * @returns Contract providers for deploying and interacting with contracts
 */
export function create(
  walletContext: WalletContext,
  options: CreateProvidersOptions,
): ContractProviders {
  const { networkConfig, zkConfigProvider, privateStateProvider } = options;

  // Set network ID
  setNetworkId(networkConfig.networkId as 'undeployed');

  // Wallet provider - handles transaction balancing
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => walletContext.shieldedSecretKeys.coinPublicKey as unknown as ledger.CoinPublicKey,
    getEncryptionPublicKey: () =>
      walletContext.shieldedSecretKeys.encryptionPublicKey as unknown as ledger.EncPublicKey,
    balanceTx: async (
      tx: ledger.UnprovenTransaction,
      newCoins?: unknown[],
      ttl?: Date,
    ): Promise<BalancedProvingRecipe> => {
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

  // Proof provider - generates ZK proofs
  const proofProvider = httpClientProofProvider(networkConfig.proofServer);

  return {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    proofProvider,
    zkConfigProvider,
  };
}

/**
 * Create contract providers from pre-configured wallet and midnight providers.
 *
 * This is used when connecting via wallet connector (browser) where the wallet
 * handles balancing and submission.
 *
 * @param walletProvider - Provider for transaction balancing
 * @param midnightProvider - Provider for transaction submission
 * @param options - Additional provider options
 * @returns Contract providers for deploying and interacting with contracts
 */
export function createFromWalletProviders(
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  options: CreateProvidersOptions,
): ContractProviders {
  const { networkConfig, zkConfigProvider, privateStateProvider } = options;

  // Set network ID
  setNetworkId(networkConfig.networkId as 'undeployed');

  // Public data provider - reads from indexer
  const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

  // Proof provider - generates ZK proofs
  const proofProvider = httpClientProofProvider(networkConfig.proofServer);

  return {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    proofProvider,
    zkConfigProvider,
  };
}
