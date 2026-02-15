/**
 * Fee relay provider overrides.
 *
 * Centralises the logic for delegating `balanceTx` / `submitTx` to either
 * a local seed-based relay wallet or a remote HTTP relay server. Used
 * internally by {@link Client} — not part of the public API.
 *
 * @internal
 * @since 0.11.0
 * @module
 */

import { Transaction } from '@midnight-ntwrk/ledger-v7';
import type {
  WalletProvider,
  MidnightProvider,
} from '@midnight-ntwrk/midnight-js-types';

import type { WalletContext } from './Wallet.js';
import { bytesToHex, hexToBytes } from './Utils.js';
import { DEFAULT_TX_TTL_MS } from './Config.js';

// =============================================================================
// Types
// =============================================================================

/**
 * The subset of provider overrides produced by fee relay helpers.
 *
 * @internal
 */
export interface FeeRelayProviders {
  readonly walletProvider: WalletProvider;
  readonly midnightProvider: MidnightProvider;
}

// =============================================================================
// Seed-based relay
// =============================================================================

/**
 * Override `balanceTx` and `submitTx` to use a pre-initialised relay wallet.
 *
 * The relay wallet pays fees (balance + submit), while the original wallet
 * provider is preserved for ZK proof generation. This is the Node.js path.
 *
 * @param relayCtx  Pre-initialised and synced relay wallet context.
 * @param baseWalletProvider  Original wallet provider (ZK proofs stay here).
 * @returns Overridden provider pair.
 *
 * @internal
 */
export function applySeedRelay(
  relayCtx: WalletContext,
  baseWalletProvider: WalletProvider,
  options?: { txTtlMs?: number },
): FeeRelayProviders {
  const defaultTtlMs = options?.txTtlMs ?? DEFAULT_TX_TTL_MS;
  const walletProvider: WalletProvider = {
    ...baseWalletProvider,
    balanceTx: async (tx, ttl) => {
      const txTtl = ttl ?? new Date(Date.now() + defaultTtlMs);
      const recipe = await relayCtx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: relayCtx.shieldedSecretKeys,
          dustSecretKey: relayCtx.dustSecretKey,
        },
        { ttl: txTtl },
      );
      return await relayCtx.wallet.finalizeRecipe(recipe);
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => await relayCtx.wallet.submitTransaction(tx),
  };

  return { walletProvider, midnightProvider };
}

// =============================================================================
// HTTP-based relay
// =============================================================================

/**
 * Override `balanceTx` and `submitTx` to proxy through a remote HTTP relay.
 *
 * Transactions are serialised to hex, sent to the relay server, and the
 * response is deserialised back. This is the browser path (e.g. Lace wallet).
 *
 * @param relayUrl  Base URL of the fee relay server (trailing slash stripped).
 * @param baseWalletProvider  Original wallet provider (ZK proofs stay here).
 * @returns Overridden provider pair.
 *
 * @internal
 */
export function applyHttpRelay(
  relayUrl: string,
  baseWalletProvider: WalletProvider,
): FeeRelayProviders {
  const url = relayUrl.replace(/\/$/, '');

  const walletProvider: WalletProvider = {
    ...baseWalletProvider,
    balanceTx: async (tx) => {
      let txHex: string;
      try {
        const txBytes = tx.serialize();
        txHex = bytesToHex(txBytes);
      } catch (serializeErr) {
        throw new Error(
          `Failed to serialize transaction for fee relay: ${serializeErr instanceof Error ? serializeErr.message : String(serializeErr)}`,
        );
      }

      const response = await fetch(`${url}/balance-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx: txHex }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Fee relay balance-tx failed: ${err.error}`);
      }

      const data = await response.json();
      if (!data.tx) {
        throw new Error('Fee relay returned empty tx');
      }

      const finalizedBytes = hexToBytes(data.tx);
      return Transaction.deserialize(
        'signature' as import('@midnight-ntwrk/ledger-v7').SignatureEnabled['instance'],
        'proof' as import('@midnight-ntwrk/ledger-v7').Proof['instance'],
        'binding' as import('@midnight-ntwrk/ledger-v7').Binding['instance'],
        finalizedBytes,
      ) as unknown as import('@midnight-ntwrk/ledger-v7').FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => {
      const txBytes = tx.serialize();
      const txHex = bytesToHex(txBytes);

      const response = await fetch(`${url}/submit-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx: txHex }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Fee relay submit-tx failed: ${err.error}`);
      }

      const { txId } = await response.json();
      return txId;
    },
  };

  return { walletProvider, midnightProvider };
}
