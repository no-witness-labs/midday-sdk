/**
 * Tagged error types for Effect-based error handling.
 *
 * Each error type uses Effect's Data.TaggedError pattern for type-safe error handling.
 *
 * @since 0.3.0
 * @module
 */

import { Data } from 'effect';

/**
 * Error during client initialization or operation.
 *
 * @example
 * ```typescript
 * import { ClientError } from '@no-witness-labs/midday-sdk';
 *
 * // Catching client errors in Effect
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.Effect.create(config);
 *   // ...
 * }).pipe(
 *   Effect.catchTag('ClientError', (error) => {
 *     console.error('Client error:', error.message);
 *     return Effect.fail(error);
 *   })
 * );
 * ```
 */
export class ClientError extends Data.TaggedError('ClientError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error during wallet initialization or synchronization.
 */
export class WalletError extends Data.TaggedError('WalletError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error from provider or network operations.
 */
export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error during contract deployment or calls.
 */
export class ContractError extends Data.TaggedError('ContractError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error fetching ZK configuration.
 */
export class ZkConfigError extends Data.TaggedError('ZkConfigError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error from private state operations.
 */
export class PrivateStateError extends Data.TaggedError('PrivateStateError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}
