/**
 * Provider-related error types.
 *
 * @since 0.3.0
 * @module
 */

import { Data } from 'effect';

/**
 * Error from provider or network operations.
 *
 * @since 0.3.0
 * @category errors
 */
export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error fetching ZK configuration.
 *
 * @since 0.3.0
 * @category errors
 */
export class ZkConfigError extends Data.TaggedError('ZkConfigError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error from private state operations.
 *
 * @since 0.3.0
 * @category errors
 */
export class PrivateStateError extends Data.TaggedError('PrivateStateError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}
