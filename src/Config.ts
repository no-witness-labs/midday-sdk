/**
 * Network configuration and constants for Midnight Network.
 *
 * @since 0.1.0
 * @module
 */

import { Context } from 'effect';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

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
// Provider Factories
// =============================================================================

/**
 * Create a PublicDataProvider from network configuration.
 *
 * Enables standalone usage without Client — just provide a `NetworkConfig`
 * and get a provider for querying contract state, watching transactions, etc.
 *
 * @example
 * ```typescript
 * const config = Midday.Config.getNetworkConfig('local');
 * const pdp = Midday.Config.publicDataProvider(config);
 * const state = await pdp.queryContractState(address);
 * ```
 *
 * @since 0.6.0
 * @category constructors
 */
export function publicDataProvider(config: NetworkConfig): ReturnType<typeof indexerPublicDataProvider> {
  return indexerPublicDataProvider(config.indexer, config.indexerWS);
}

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

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
