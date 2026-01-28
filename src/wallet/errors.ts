/**
 * Wallet-related error types.
 *
 * @since 0.3.0
 * @module
 */

import { Data } from 'effect';

/**
 * Error during wallet initialization or synchronization.
 *
 * @since 0.3.0
 * @category errors
 */
export class WalletError extends Data.TaggedError('WalletError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}
