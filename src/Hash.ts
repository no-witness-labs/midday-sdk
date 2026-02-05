/**
 * Cryptographic hash utilities for Compact contracts.
 *
 * Provides helper functions for hashing values in a way that matches
 * Compact's `persistentHash` function, enabling client-side hash computation
 * for witness functions and ledger comparisons.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Hash a password string
 * const hash = Midday.Hash.password('my-secret-password');
 *
 * // Hash raw bytes
 * const bytes = Midday.Hash.stringToBytes32('my-secret');
 * const hash2 = Midday.Hash.bytes32(bytes);
 *
 * // Hash a Field (bigint)
 * const hash3 = Midday.Hash.field(12345n);
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { persistentHash, CompactTypeBytes, CompactTypeField } from '@midnight-ntwrk/compact-runtime';

// =============================================================================
// Types
// =============================================================================

/**
 * A 32-byte hash result, matching Compact's `Bytes<32>` type.
 *
 * @since 0.3.0
 * @category model
 */
export type Hash32 = Uint8Array;

// =============================================================================
// String/Bytes Conversion
// =============================================================================

/**
 * Convert a string to a 32-byte array.
 *
 * Encodes the string as UTF-8, pads with zeros if shorter than 32 bytes,
 * and truncates if longer (with a console warning).
 *
 * @param str - The string to convert
 * @returns A 32-byte Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = Midday.Hash.stringToBytes32('my-password');
 * // Use in witness function or pass to bytes32()
 * ```
 *
 * @since 0.3.0
 * @category utilities
 */
export function stringToBytes32(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length > 32) {
    console.warn(`String truncated from ${bytes.length} to 32 bytes`);
  }
  const result = new Uint8Array(32);
  result.set(bytes.slice(0, 32));
  return result;
}

// =============================================================================
// Hash Functions
// =============================================================================

/**
 * Compute the persistent hash of a 32-byte value.
 *
 * Matches Compact's `persistentHash<Bytes<32>>()` function.
 *
 * @param value - A 32-byte Uint8Array
 * @returns The hash as a 32-byte Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = Midday.Hash.stringToBytes32('secret');
 * const hash = Midday.Hash.bytes32(bytes);
 * ```
 *
 * @since 0.3.0
 * @category hashing
 */
export function bytes32(value: Uint8Array): Hash32 {
  if (value.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${value.length}`);
  }
  return persistentHash(new CompactTypeBytes(32), value);
}

/**
 * Compute the persistent hash of a Field value (bigint).
 *
 * Matches Compact's `persistentHash<Field>()` function.
 *
 * @param value - A bigint representing a Field
 * @returns The hash as a 32-byte Uint8Array
 *
 * @example
 * ```typescript
 * const hash = Midday.Hash.field(12345n);
 * ```
 *
 * @since 0.3.0
 * @category hashing
 */
export function field(value: bigint): Hash32 {
  return persistentHash(CompactTypeField, value);
}

/**
 * Compute the persistent hash of a password string.
 *
 * Convenience function that converts the string to bytes32 and hashes it.
 * Equivalent to `bytes32(stringToBytes32(password))`.
 *
 * @param password - The password string to hash
 * @returns The hash as a 32-byte Uint8Array
 *
 * @example
 * ```typescript
 * const passwordHash = Midday.Hash.password('my-secret-password');
 * // Use as initial ledger value in contract init
 * await Midday.Contract.call(contract, 'init', passwordHash);
 * ```
 *
 * @since 0.3.0
 * @category hashing
 */
export function password(pwd: string): Hash32 {
  return bytes32(stringToBytes32(pwd));
}

// =============================================================================
// Low-level Access
// =============================================================================

/**
 * Raw persistent hash function for advanced use cases.
 *
 * This is a direct re-export of the underlying `persistentHash` function
 * from `@midnight-ntwrk/compact-runtime` for users who need to hash
 * custom Compact types not covered by the helper functions.
 *
 * @example
 * ```typescript
 * import { CompactTypeBytes } from '@midnight-ntwrk/compact-runtime';
 *
 * const hash = Midday.Hash.raw(new CompactTypeBytes(64), myBytes64);
 * ```
 *
 * @since 0.3.0
 * @category advanced
 */
export const raw = persistentHash;
