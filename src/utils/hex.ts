/**
 * Browser-compatible hex encoding utilities.
 *
 * Replaces Node.js Buffer with standard Web APIs that work in both browser and Node.js 18+.
 *
 * @since 0.2.0
 * @module
 */

/**
 * Convert a hex string to Uint8Array.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array of bytes
 * @throws Error if hex string is invalid
 *
 * @example
 * ```typescript
 * const bytes = hexToBytes('deadbeef');
 * // Uint8Array [222, 173, 190, 239]
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  // Remove 0x prefix if present
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
 * @example
 * ```typescript
 * const hex = bytesToHex(new Uint8Array([222, 173, 190, 239]));
 * // 'deadbeef'
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert base64 string to Uint8Array.
 *
 * @param base64 - Base64 encoded string
 * @returns Uint8Array of bytes
 *
 * @example
 * ```typescript
 * const bytes = base64ToBytes('3q2+7w==');
 * // Uint8Array [222, 173, 190, 239]
 * ```
 */
export function base64ToBytes(base64: string): Uint8Array {
  // Use atob which is available in both browser and Node.js 18+
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
 * @param bytes - Uint8Array to convert
 * @returns Base64 encoded string
 *
 * @example
 * ```typescript
 * const base64 = bytesToBase64(new Uint8Array([222, 173, 190, 239]));
 * // '3q2+7w=='
 * ```
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const binaryString = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');
  return btoa(binaryString);
}
