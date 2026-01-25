/**
 * Provider factory for wallet-connected clients.
 *
 * Creates WalletProvider and MidnightProvider from a connected wallet.
 *
 * @since 0.2.0
 * @module
 */

import type { WalletProvider, MidnightProvider, BalancedProvingRecipe } from '@midnight-ntwrk/midnight-js-types';
import * as ledger from '@midnight-ntwrk/ledger-v6';

import type { DAppConnectorWalletAPI } from './connector.js';
import { hexToBytes } from '../utils/hex.js';

/**
 * Wallet keys needed for provider creation.
 */
export interface WalletKeys {
  /** Coin public key as hex or bech32m string */
  coinPublicKey: string;
  /** Encryption public key as hex or bech32m string */
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
 * Create providers from a connected wallet.
 *
 * These providers use the wallet extension to balance and submit transactions.
 *
 * @param wallet - Connected wallet API from DAppConnector
 * @param keys - Public keys from wallet state
 * @returns WalletProvider and MidnightProvider
 *
 * @example
 * ```typescript
 * const connection = await connectWallet();
 * const { walletProvider, midnightProvider } = createWalletProviders(
 *   connection.wallet,
 *   {
 *     coinPublicKey: connection.coinPublicKey,
 *     encryptionPublicKey: connection.encryptionPublicKey,
 *   }
 * );
 * ```
 */
export function createWalletProviders(wallet: DAppConnectorWalletAPI, keys: WalletKeys): WalletProviders {
  // The keys from the wallet are bech32m encoded, we need to handle both hex and bech32m
  // For now, we'll use them as-is since the wallet provider just needs to return them
  const coinPublicKeyBytes = tryParsePublicKey(keys.coinPublicKey);
  const encryptionPublicKeyBytes = tryParsePublicKey(keys.encryptionPublicKey);

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKeyBytes as unknown as ledger.CoinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKeyBytes as unknown as ledger.EncPublicKey,
    balanceTx: async (
      tx: ledger.UnprovenTransaction,
      newCoins?: unknown[],
      _ttl?: Date,
    ): Promise<BalancedProvingRecipe> => {
      // Use the new balanceAndProveTransaction API
      const result = await wallet.balanceAndProveTransaction(tx, newCoins ?? []);
      return result as unknown as BalancedProvingRecipe;
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: ledger.FinalizedTransaction) => {
      const txId = await wallet.submitTransaction(tx);
      return txId as unknown as ledger.TransactionId;
    },
  };

  return {
    walletProvider,
    midnightProvider,
  };
}

/**
 * Try to parse a public key from hex or bech32m format.
 */
function tryParsePublicKey(key: string): Uint8Array {
  // If it looks like hex (64 chars for 32 bytes), parse as hex
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return hexToBytes(key);
  }

  // Otherwise, assume it's bech32m and return as-is for the wallet to handle
  // The midnight wallet SDK should handle bech32m encoded keys
  return new TextEncoder().encode(key);
}
