/**
 * Error types for DevNet operations.
 *
 * @since 0.2.0
 * @module
 */

import { Data } from 'effect';

/**
 * Error thrown when cluster operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class ClusterError extends Data.TaggedError('ClusterError')<{
  readonly operation: string;
  readonly cluster?: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when container operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class ContainerError extends Data.TaggedError('ContainerError')<{
  readonly operation: string;
  readonly container: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when health check fails.
 *
 * @since 0.2.0
 * @category errors
 */
export class HealthCheckError extends Data.TaggedError('HealthCheckError')<{
  readonly service: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when Docker is not running.
 *
 * @since 0.2.0
 * @category errors
 */
export class DockerNotRunningError extends Data.TaggedError('DockerNotRunningError')<{
  readonly cause: unknown;
}> {}

/**
 * Error thrown when faucet operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class FaucetError extends Data.TaggedError('FaucetError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when fee relay operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class FeeRelayError extends Data.TaggedError('FeeRelayError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}
