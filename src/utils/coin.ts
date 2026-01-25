/**
 * Coin creation utilities for Midnight Network.
 *
 * Creates coin structures for contract calls with nonce, color, and value.
 *
 * @since 0.2.0
 * @module
 */

import { encodeRawTokenType, nativeToken } from '@midnight-ntwrk/ledger-v6';

/**
 * Coin information containing nonce, color, and value.
 */
export interface CoinInfo {
  /** Random nonce (32 bytes) */
  nonce: Uint8Array;
  /** Token color/type (32 bytes) */
  color: Uint8Array;
  /** Token value */
  value: bigint;
}

/**
 * Generate a cryptographically secure random nonce.
 *
 * Uses crypto.getRandomValues which is available in both browser and Node.js 18+.
 *
 * @returns Random 32-byte Uint8Array
 */
function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Get the native token color.
 *
 * @returns 32-byte Uint8Array representing the native token color
 */
export function getNativeTokenColor(): Uint8Array {
  const rawType = nativeToken().raw;
  const encoded = encodeRawTokenType(rawType);
  return new Uint8Array(encoded);
}

/**
 * Create a new coin with random nonce and native token color.
 *
 * @param amount - Token amount (as bigint or number)
 * @returns CoinInfo with nonce, color, and value
 *
 * @example
 * ```typescript
 * // Create a coin with 1 TNIGHT (10^6 units)
 * const coin = createCoin(1_000_000n);
 *
 * // Use in contract deployment
 * await contract.deploy({ coin });
 * ```
 */
export function createCoin(amount: bigint | number): CoinInfo {
  const value = typeof amount === 'number' ? BigInt(amount) : amount;

  if (value < 0n) {
    throw new Error('Coin value cannot be negative');
  }

  return {
    nonce: generateNonce(),
    color: getNativeTokenColor(),
    value,
  };
}

/**
 * Create a coin with a custom token color.
 *
 * @param amount - Token amount
 * @param color - Token color as Uint8Array (32 bytes)
 * @returns CoinInfo with nonce, color, and value
 *
 * @example
 * ```typescript
 * const customCoin = createCustomCoin(100n, myTokenColor);
 * ```
 */
export function createCustomCoin(amount: bigint | number, color: Uint8Array): CoinInfo {
  if (color.length !== 32) {
    throw new Error(`Invalid color length: expected 32 bytes, got ${color.length}`);
  }

  const value = typeof amount === 'number' ? BigInt(amount) : amount;

  if (value < 0n) {
    throw new Error('Coin value cannot be negative');
  }

  return {
    nonce: generateNonce(),
    color,
    value,
  };
}
