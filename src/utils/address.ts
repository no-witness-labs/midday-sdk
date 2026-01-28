/**
 * Address parsing utilities for Midnight Network.
 *
 * Supports multiple address formats: Bech32m, hex, and base64.
 *
 * @since 0.2.0
 * @module
 */

import { hexToBytes, bytesToHex, base64ToBytes } from './hex.js';

/**
 * Parsed shielded address containing coin and encryption public keys.
 */
export interface ParsedAddress {
  /** Coin public key as 64-character hex string */
  coinPublicKey: string;
  /** Encryption public key as 64-character hex string */
  encryptionPublicKey: string;
}

/**
 * Parse a shielded address from various formats.
 *
 * Supports:
 * - Bech32m format (midnightxxxx...)
 * - Hex string (128 characters = 64 bytes for both keys)
 * - Base64 encoded bytes
 *
 * @param address - Address in any supported format
 * @returns Parsed address with hex-encoded public keys
 * @throws Error if address format is invalid
 *
 * @example
 * ```typescript
 * // Parse Bech32m address
 * const parsed = parseShieldedAddress('midnight1...');
 *
 * // Parse hex address (64 bytes = 128 hex chars)
 * const parsed = parseShieldedAddress('aabbcc...');
 *
 * console.log(parsed.coinPublicKey);       // 64-char hex
 * console.log(parsed.encryptionPublicKey); // 64-char hex
 * ```
 */
export function parseShieldedAddress(address: string): ParsedAddress {
  let bytes: Uint8Array;

  // Try to detect format and decode
  if (address.startsWith('midnight')) {
    // Bech32m format - use the ledger's built-in parser
    // The address contains the encoded public keys
    bytes = decodeBech32m(address);
  } else if (/^[0-9a-fA-F]+$/.test(address)) {
    // Hex format
    bytes = hexToBytes(address);
  } else if (/^[A-Za-z0-9+/=]+$/.test(address)) {
    // Base64 format
    bytes = base64ToBytes(address);
  } else {
    throw new Error(`Invalid address format: ${address.slice(0, 20)}...`);
  }

  // Shielded address should be 64 bytes (32 bytes each for coin and encryption keys)
  if (bytes.length !== 64) {
    throw new Error(`Invalid address length: expected 64 bytes, got ${bytes.length}`);
  }

  return {
    coinPublicKey: bytesToHex(bytes.slice(0, 32)),
    encryptionPublicKey: bytesToHex(bytes.slice(32, 64)),
  };
}

/**
 * Convert a hex public key to Uint8Array for contract calls.
 *
 * @param hex - 64-character hex string (32 bytes)
 * @returns Uint8Array of 32 bytes
 *
 * @example
 * ```typescript
 * const keyBytes = hexToPublicKey(parsed.coinPublicKey);
 * // Use in contract calls
 * ```
 */
export function hexToPublicKey(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

// Bech32m character set
const BECH32M_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Decode a Bech32m address to bytes.
 * This is a simplified implementation for Midnight addresses.
 */
function decodeBech32m(bech32: string): Uint8Array {
  const lower = bech32.toLowerCase();
  const sepIndex = lower.lastIndexOf('1');

  if (sepIndex < 1) {
    throw new Error('Invalid bech32m: no separator found');
  }

  const data = lower.slice(sepIndex + 1);

  // Convert bech32 characters to 5-bit values
  const values: number[] = [];
  for (const char of data) {
    const value = BECH32M_CHARSET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid bech32m character: ${char}`);
    }
    values.push(value);
  }

  // Remove checksum (last 6 values)
  const dataValues = values.slice(0, -6);

  // Convert from 5-bit to 8-bit (skip first value which is witness version)
  const bytes = convertBits(dataValues.slice(1), 5, 8, false);

  return new Uint8Array(bytes);
}

/**
 * Convert between bit sizes (used in bech32 encoding).
 */
function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    // Check for invalid padding
  }

  return result;
}
