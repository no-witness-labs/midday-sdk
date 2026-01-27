/**
 * Service definitions for Effect-based dependency injection.
 *
 * These Context.Tags allow you to inject dependencies into Effect computations
 * without passing them through every function call.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Define a program that uses injected services
 * const program = Effect.gen(function* () {
 *   const logger = yield* Midday.LoggerService;
 *   const networkConfig = yield* Midday.NetworkConfigService;
 *
 *   logger.info(`Connected to ${networkConfig.networkId}`);
 * });
 *
 * // Provide the services
 * const runnable = program.pipe(
 *   Effect.provideService(Midday.LoggerService, myLogger),
 *   Effect.provideService(Midday.NetworkConfigService, config),
 * );
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Context, Layer } from 'effect';
import type { ZKConfigProvider, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import type { Logger } from '../Client.js';
import type { NetworkConfig } from '../Config.js';

/**
 * Logger service for SDK operations.
 *
 * @since 0.3.0
 * @category services
 */
export class LoggerService extends Context.Tag('LoggerService')<LoggerService, Logger>() {}

/**
 * Network configuration service.
 *
 * @since 0.3.0
 * @category services
 */
export class NetworkConfigService extends Context.Tag('NetworkConfigService')<
  NetworkConfigService,
  NetworkConfig
>() {}

/**
 * ZK configuration provider service.
 *
 * @since 0.3.0
 * @category services
 */
export class ZkConfigProviderService extends Context.Tag('ZkConfigProviderService')<
  ZkConfigProviderService,
  ZKConfigProvider<string>
>() {}

/**
 * Private state provider service.
 *
 * @since 0.3.0
 * @category services
 */
export class PrivateStateProviderService extends Context.Tag('PrivateStateProviderService')<
  PrivateStateProviderService,
  PrivateStateProvider
>() {}

/**
 * Combined SDK configuration for convenience.
 */
export interface SdkConfig {
  readonly logger: Logger;
  readonly networkConfig: NetworkConfig;
  readonly zkConfigProvider: ZKConfigProvider<string>;
  readonly privateStateProvider: PrivateStateProvider;
}

/**
 * Combined SDK configuration service.
 * Provides all SDK services in one tag for convenience.
 *
 * @since 0.3.0
 * @category services
 */
export class SdkConfigService extends Context.Tag('SdkConfigService')<SdkConfigService, SdkConfig>() {}

/**
 * Create a Layer providing all SDK services from a config object.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const servicesLayer = Midday.makeSdkLayer({
 *   logger: console,
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 * });
 *
 * // Use in Effect programs
 * const program = Effect.gen(function* () {
 *   const logger = yield* Midday.LoggerService;
 *   const config = yield* Midday.NetworkConfigService;
 *   logger.info(`Using network: ${config.networkId}`);
 * });
 *
 * // Provide all services at once
 * await Effect.runPromise(program.pipe(Effect.provide(servicesLayer)));
 * ```
 *
 * @since 0.3.0
 * @category services
 */
export function makeSdkLayer(config: SdkConfig): Layer.Layer<
  LoggerService | NetworkConfigService | ZkConfigProviderService | PrivateStateProviderService | SdkConfigService
> {
  return Layer.mergeAll(
    Layer.succeed(LoggerService, config.logger),
    Layer.succeed(NetworkConfigService, config.networkConfig),
    Layer.succeed(ZkConfigProviderService, config.zkConfigProvider),
    Layer.succeed(PrivateStateProviderService, config.privateStateProvider),
    Layer.succeed(SdkConfigService, config),
  );
}
