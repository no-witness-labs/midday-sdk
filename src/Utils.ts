/**
 * Utility functions for hex encoding, address parsing, and coin creation.
 *
 * @since 0.3.0
 * @module
 */

// =============================================================================
// Hex Encoding
// =============================================================================

/**
 * Convert a hex string to Uint8Array.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array of bytes
 * @throws Error if hex string is invalid
 *
 * @example
 * ```typescript
 * const bytes = Midday.Utils.hexToBytes('deadbeef');
 * ```
 *
 * @since 0.2.0
 * @category hex
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: length must be even');
  }

  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hex characters');
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }

  return bytes;
}

/**
 * Convert Uint8Array to hex string.
 *
 * @param bytes - Uint8Array to convert
 * @returns Lowercase hex string (without 0x prefix)
 *
 * @since 0.2.0
 * @category hex
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert base64 string to Uint8Array.
 *
 * @since 0.2.0
 * @category hex
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string.
 *
 * @since 0.2.0
 * @category hex
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const binaryString = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');
  return btoa(binaryString);
}

// =============================================================================
// Address Parsing
// =============================================================================

/**
 * Convert a hex public key to Uint8Array for contract calls.
 *
 * @param hex - 64-character hex string (32 bytes)
 * @returns Uint8Array of 32 bytes
 *
 * @since 0.2.0
 * @category address
 */
export function hexToPublicKey(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}


// =============================================================================
// Coin Creation
// =============================================================================

import { encodeRawTokenType, nativeToken } from '@midnight-ntwrk/ledger-v8';

/**
 * Coin information containing nonce, color, and value.
 *
 * @since 0.2.0
 * @category coin
 */
export interface CoinInfo {
  /** Random nonce (32 bytes) */
  nonce: Uint8Array;
  /** Token color/type (32 bytes) */
  color: Uint8Array;
  /** Token value */
  value: bigint;
}

function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Get the native token color.
 *
 * @returns 32-byte Uint8Array representing the native token color
 *
 * @since 0.2.0
 * @category coin
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
 * @since 0.2.0
 * @category coin
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
 * @since 0.2.0
 * @category coin
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
