/**
 * Network configuration and constants for Midnight Network.
 *
 * @since 0.1.0
 * @module
 */

import { Context, Layer } from 'effect';
import type { ZKConfigProvider, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import type { Logger } from './Client.js';
import { ZkConfigProviderService } from './providers/HttpZkConfigProvider.js';
import { PrivateStateProviderService } from './providers/IndexedDBPrivateStateProvider.js';

// Re-export for convenience
export { ZkConfigProviderService, PrivateStateProviderService };

// =============================================================================
// Types
// =============================================================================

export interface NetworkConfig {
  networkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  local: {
    networkId: 'undeployed',
    indexer: 'http://localhost:8088/api/v3/graphql',
    indexerWS: 'ws://localhost:8088/api/v3/graphql/ws',
    node: 'ws://localhost:9944',
    proofServer: 'http://localhost:6300',
  },
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    node: 'wss://rpc.preview.midnight.network',
    proofServer: 'http://localhost:6300',
  },
} as const;

/**
 * Get network configuration by name.
 *
 * Note: Environment variable overrides have been removed for browser compatibility.
 * Use explicit configuration via Client.create() options instead.
 *
 * @param network - Network name ('local' or 'preview')
 * @returns Network configuration
 */
export function getNetworkConfig(network: string = 'local'): NetworkConfig {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(', ')}`);
  }

  return config;
}

/**
 * Genesis wallet seed for local development (DO NOT use in production)
 */
export const DEV_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

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
 * Combined SDK configuration for convenience.
 *
 * @since 0.3.0
 * @category services
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
 * const servicesLayer = Midday.Config.makeSdkLayer({
 *   logger: console,
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 * });
 *
 * // Use in Effect programs
 * const program = Effect.gen(function* () {
 *   const logger = yield* Midday.Config.LoggerService;
 *   const config = yield* Midday.Config.NetworkConfigService;
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
