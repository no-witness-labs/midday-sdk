/**
 * Fee relay provider overrides.
 *
 * Overrides `submitTx` to proxy through a remote HTTP relay server that
 * adds dust (tx fees) before submission. The user's wallet handles value
 * inputs via `balanceTx` with `{ payFees: false }`.
 * Used internally by {@link Client} — not part of the public API.
 *
 * @internal
 * @since 0.11.0
 * @module
 */

import type { MidnightProvider } from '@midnight-ntwrk/midnight-js-types';

import { bytesToHex } from './Utils.js';

// =============================================================================
// HTTP-based relay
// =============================================================================

/**
 * Create a MidnightProvider that proxies through a remote fee relay.
 *
 * `submitTx` first sends the user-balanced transaction (without dust) to
 * `/balance-finalized-tx` so the relay adds dust, then submits via `/submit-tx`.
 *
 * @param relayUrl  Base URL of the fee relay server (trailing slash stripped).
 * @returns MidnightProvider that adds dust fees via relay before submission.
 *
 * @internal
 */
export function createRelayProvider(relayUrl: string): MidnightProvider {
  const url = relayUrl.replace(/\/$/, '');

  return {
    submitTx: async (tx) => {
      // Add dust (fees) via relay
      const txHex = bytesToHex(tx.serialize());
      const balanceResponse = await fetch(`${url}/balance-finalized-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx: txHex }),
      });
      if (!balanceResponse.ok) {
        const err = await balanceResponse.json().catch(() => ({ error: balanceResponse.statusText }));
        throw new Error(`Fee relay balance-finalized-tx failed: ${err.error}`);
      }

      const balanceData = await balanceResponse.json();
      if (!balanceData.tx) {
        throw new Error('Fee relay returned empty tx');
      }

      // Submit the fully balanced transaction
      const submitResponse = await fetch(`${url}/submit-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx: balanceData.tx }),
      });
      if (!submitResponse.ok) {
        const err = await submitResponse.json().catch(() => ({ error: submitResponse.statusText }));
        throw new Error(`Fee relay submit-tx failed: ${err.error}`);
      }

      const { txId } = await submitResponse.json();
      return txId;
    },
  };
}
