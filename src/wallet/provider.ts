/**
 * Provider factory for wallet-connected clients.
 *
 * Creates WalletProvider and MidnightProvider from a connected wallet.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.2.0
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import type { WalletProvider, MidnightProvider, BalancedProvingRecipe } from '@midnight-ntwrk/midnight-js-types';
import { NOTHING_TO_PROVE } from '@midnight-ntwrk/midnight-js-types';
import { Transaction, type FinalizedTransaction, type TransactionId, type UnprovenTransaction } from '@midnight-ntwrk/ledger-v6';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import type { ConnectedAPI, ShieldedAddresses } from './connector.js';
import { ProviderError } from '../errors/index.js';
import { bytesToHex, hexToBytes } from '../utils/hex.js';
import { runEffectPromise } from '../utils/effect-runtime.js';

/**
 * Wallet keys needed for provider creation.
 */
export interface WalletKeys {
  /** Coin public key (Bech32m string) */
  coinPublicKey: string;
  /** Encryption public key (Bech32m string) */
  encryptionPublicKey: string;
}

/**
 * Providers created from wallet connection.
 */
export interface WalletProviders {
  /** Provider for transaction balancing */
  walletProvider: WalletProvider;
  /** Provider for transaction submission */
  midnightProvider: MidnightProvider;
}

/**
 * Effect-based interface for wallet provider operations.
 */
export interface WalletProviderEffect {
  readonly balanceTx: (wallet: ConnectedAPI, tx: UnprovenTransaction) => Effect.Effect<BalancedProvingRecipe, ProviderError>;
  readonly submitTx: (wallet: ConnectedAPI, tx: FinalizedTransaction) => Effect.Effect<TransactionId, ProviderError>;
}

// =============================================================================
// Effect API
// =============================================================================

function balanceTxEffect(wallet: ConnectedAPI, tx: UnprovenTransaction): Effect.Effect<BalancedProvingRecipe, ProviderError> {
  return Effect.tryPromise({
    try: async () => {
      // Serialize the transaction to hex string
      const txBytes = tx.serialize();
      const serializedTx = bytesToHex(txBytes);

      // Use wallet's balance API
      const result = await wallet.balanceUnsealedTransaction(serializedTx);

      // Deserialize the returned transaction - markers for FinalizedTransaction
      const resultBytes = hexToBytes(result.tx);
      const networkId = getNetworkId();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transaction = (Transaction as any).deserialize(
        { SignatureEnabled: true },
        { Proof: true },
        { Binding: true },
        resultBytes,
        networkId,
      ) as FinalizedTransaction;

      // Return as NothingToProve since the wallet handles proving
      return {
        type: NOTHING_TO_PROVE,
        transaction,
      } as BalancedProvingRecipe;
    },
    catch: (cause) =>
      new ProviderError({
        cause,
        message: `Failed to balance transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function submitTxEffect(wallet: ConnectedAPI, tx: FinalizedTransaction): Effect.Effect<TransactionId, ProviderError> {
  return Effect.tryPromise({
    try: async () => {
      // Serialize the transaction to hex string
      const txBytes = tx.serialize();
      const serializedTx = bytesToHex(txBytes);

      // Submit via wallet
      await wallet.submitTransaction(serializedTx);

      // Return the hex string as TransactionId
      return serializedTx as TransactionId;
    },
    catch: (cause) =>
      new ProviderError({
        cause,
        message: `Failed to submit transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Effect-based API for wallet provider operations.
 */
export const WalletProviderEffectAPI: WalletProviderEffect = {
  balanceTx: balanceTxEffect,
  submitTx: submitTxEffect,
};

// =============================================================================
// Promise API (backwards compatible)
// =============================================================================

/**
 * Create providers from a connected wallet (v4 API).
 *
 * These providers use the wallet extension to balance and submit transactions.
 *
 * @param wallet - Connected wallet API from DAppConnector v4
 * @param addresses - Shielded addresses from wallet
 * @returns WalletProvider and MidnightProvider
 *
 * @example
 * ```typescript
 * const connection = await connectWallet('testnet');
 * const { walletProvider, midnightProvider } = createWalletProviders(
 *   connection.wallet,
 *   connection.addresses,
 * );
 * ```
 */
export function createWalletProviders(wallet: ConnectedAPI, addresses: ShieldedAddresses): WalletProviders {
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => addresses.shieldedCoinPublicKey as unknown as ReturnType<WalletProvider['getCoinPublicKey']>,
    getEncryptionPublicKey: () =>
      addresses.shieldedEncryptionPublicKey as unknown as ReturnType<WalletProvider['getEncryptionPublicKey']>,

    async balanceTx(tx: UnprovenTransaction, _newCoins?: unknown[], _ttl?: Date): Promise<BalancedProvingRecipe> {
      return runEffectPromise(balanceTxEffect(wallet, tx));
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      return runEffectPromise(submitTxEffect(wallet, tx));
    },
  };

  return {
    walletProvider,
    midnightProvider,
  };
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  balanceTx: balanceTxEffect,
  submitTx: submitTxEffect,
};

// Legacy export for backwards compatibility
export { WalletProviderEffectAPI as Effect };

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

/**
 * Service interface for WalletProvider operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface WalletProviderServiceImpl {
  readonly balanceTx: (
    wallet: ConnectedAPI,
    tx: UnprovenTransaction,
  ) => Effect.Effect<BalancedProvingRecipe, ProviderError>;
  readonly submitTx: (wallet: ConnectedAPI, tx: FinalizedTransaction) => Effect.Effect<TransactionId, ProviderError>;
}

/**
 * Context.Tag for WalletProviderService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class WalletProviderService extends Context.Tag('WalletProviderService')<
  WalletProviderService,
  WalletProviderServiceImpl
>() {}

// =============================================================================
// Effect DI - Live Layer
// =============================================================================

/**
 * Live Layer for WalletProviderService.
 *
 * @since 0.2.0
 * @category layer
 */
export const WalletProviderLive: Layer.Layer<WalletProviderService> = Layer.succeed(WalletProviderService, {
  balanceTx: balanceTxEffect,
  submitTx: submitTxEffect,
});
