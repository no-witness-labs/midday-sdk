/**
 * Provider setup for contract interactions on Midnight Network.
 *
 * Creates the provider stack needed for deploying and interacting with contracts.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.1.0
 * @module
 */

import { Effect } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {
  WalletProvider,
  MidnightProvider,
  ZKConfigProvider,
  PrivateStateProvider,
  ProofProvider,
  UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';

import type { NetworkConfig } from './Config.js';
import type { WalletContext } from './Wallet.js';
import { ProviderError } from './providers/errors.js';
import { runEffect } from './utils/effect-runtime.js';

// Re-export error type
export { ProviderError } from './providers/errors.js';

export interface StorageConfig {
  /** Storage password */
  password?: string;
}

/**
 * Base providers without zkConfig and proofProvider (shared at client level).
 * zkConfig and proofProvider are per-contract, so they're added when loading a contract.
 *
 * @since 0.5.0
 * @category model
 */
export interface BaseProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  privateStateProvider: PrivateStateProvider;
  /** Network configuration for creating per-contract proof providers */
  networkConfig: NetworkConfig;
}

/**
 * Full contract providers including zkConfig and proofProvider (per-contract).
 *
 * @since 0.1.0
 * @category model
 */
export interface ContractProviders extends Omit<BaseProviders, 'networkConfig'> {
  zkConfigProvider: ZKConfigProvider<string>;
  proofProvider: ProofProvider;
}

/**
 * Options for creating base providers (without zkConfig).
 *
 * @since 0.5.0
 * @category model
 */
export interface CreateBaseProvidersOptions {
  /** Network configuration */
  networkConfig: NetworkConfig;
  /** Private state provider */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storageConfig?: StorageConfig;
}

// =============================================================================
// Base Providers (without zkConfig - shared at client level)
// =============================================================================

/**
 * Create base providers without zkConfig.
 * @internal
 */
function createBaseEffect(
  walletContext: WalletContext,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ProviderError> {
  return Effect.try({
    try: () => {
      const { networkConfig, privateStateProvider } = options;

      // Set network ID
      setNetworkId(networkConfig.networkId as 'undeployed');

      // Wallet provider - handles transaction balancing
      const walletProvider: WalletProvider = {
        getCoinPublicKey: () => walletContext.shieldedSecretKeys.coinPublicKey as unknown as ledger.CoinPublicKey,
        getEncryptionPublicKey: () =>
          walletContext.shieldedSecretKeys.encryptionPublicKey as unknown as ledger.EncPublicKey,
        balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<ledger.FinalizedTransaction> => {
          const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
          const recipe = await walletContext.wallet.balanceUnboundTransaction(
            tx,
            {
              shieldedSecretKeys: walletContext.shieldedSecretKeys,
              dustSecretKey: walletContext.dustSecretKey,
            },
            { ttl: txTtl },
          );
          // Finalize the recipe to get the FinalizedTransaction
          const finalizedTx = await walletContext.wallet.finalizeRecipe(recipe);
          return finalizedTx;
        },
      };

      // Midnight provider - handles transaction submission
      const midnightProvider: MidnightProvider = {
        submitTx: async (tx: ledger.FinalizedTransaction) => await walletContext.wallet.submitTransaction(tx),
      };

      // Public data provider - reads from indexer
      const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

      return {
        walletProvider,
        midnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      };
    },
    catch: (cause) =>
      new ProviderError({
        cause,
        message: `Failed to create base providers: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Create base providers from wallet connector (no zkConfig).
 * @internal
 */
function createBaseFromWalletProvidersEffect(
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ProviderError> {
  return Effect.try({
    try: () => {
      const { networkConfig, privateStateProvider } = options;

      // Set network ID
      setNetworkId(networkConfig.networkId as 'undeployed');

      // Public data provider - reads from indexer
      const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

      return {
        walletProvider,
        midnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      };
    },
    catch: (cause) =>
      new ProviderError({
        cause,
        message: `Failed to create base providers from wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Promise API
// =============================================================================

/**
 * Create base providers without zkConfig (for client-level sharing).
 *
 * @param walletContext - Initialized wallet context
 * @param options - Provider options (no zkConfig)
 * @returns Base providers without zkConfig
 *
 * @since 0.5.0
 */
export function createBase(
  walletContext: WalletContext,
  options: CreateBaseProvidersOptions,
): BaseProviders {
  return runEffect(createBaseEffect(walletContext, options));
}

/**
 * Create base providers from wallet connector (no zkConfig).
 *
 * @param walletProvider - Provider for transaction balancing
 * @param midnightProvider - Provider for transaction submission
 * @param options - Provider options (no zkConfig)
 * @returns Base providers without zkConfig
 *
 * @since 0.5.0
 */
export function createBaseFromWalletProviders(
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  options: CreateBaseProvidersOptions,
): BaseProviders {
  return runEffect(createBaseFromWalletProvidersEffect(walletProvider, midnightProvider, options));
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  createBase: createBaseEffect,
  createBaseFromWalletProviders: createBaseFromWalletProvidersEffect,
};


