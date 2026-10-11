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

/**
 * Built-in networks that need no credentials.
 *
 * Preprod and mainnet are served by Blockfrost and need a project token; build
 * their configuration with {@link blockfrost}.
 */
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

/** Networks whose indexer and RPC are provided by Blockfrost. */
export type BlockfrostNetwork = 'preprod' | 'mainnet';

const BLOCKFROST_NETWORKS: readonly BlockfrostNetwork[] = ['preprod', 'mainnet'];

/**
 * Network configuration for a Blockfrost-hosted Midnight network.
 *
 * Midnight retired its hosted mainnet endpoints on 2026-09-30 and its Preprod
 * endpoints on 2026-10-09; both are now served by Blockfrost. Every request
 * carries the project token as a `project_id` query parameter, so the token
 * is visible to anyone who can read these URLs: keep it server-side, and do
 * not ship it in browser bundles. Tokens are network-specific.
 *
 * @param network - `'preprod'` or `'mainnet'`
 * @param projectId - Blockfrost project token for that network
 * @param options.proofServer - Proof server URL (default: local, port 6300)
 *
 * @example
 * ```typescript
 * const client = await Midday.Client.create({
 *   networkConfig: Midday.Config.blockfrost('preprod', process.env.BLOCKFROST_PROJECT_ID!),
 *   seed,
 *   privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
 * });
 * ```
 *
 * @since 0.7.0
 * @category constructors
 */
export function blockfrost(
  network: BlockfrostNetwork,
  projectId: string,
  options: { proofServer?: string } = {},
): NetworkConfig {
  if (!BLOCKFROST_NETWORKS.includes(network)) {
    throw new Error(`Blockfrost does not serve "${network}". Use one of: ${BLOCKFROST_NETWORKS.join(', ')}`);
  }
  if (!projectId) throw new Error(`A Blockfrost project token is required for ${network}`);
  const q = `project_id=${encodeURIComponent(projectId)}`;
  return {
    networkId: network,
    indexer: `https://midnight-${network}.blockfrost.io/api/v0?${q}`,
    indexerWS: `wss://midnight-${network}.blockfrost.io/api/v0/ws?${q}`,
    node: `wss://rpc.midnight-${network}.blockfrost.io?${q}`,
    proofServer: options.proofServer ?? 'http://localhost:6300',
  };
}

/**
 * Masks Blockfrost project tokens in a URL or log line.
 *
 * @since 0.7.0
 * @category utils
 */
export function redactUrl(text: string): string {
  return text.replace(/project_id=[^&\s]+/g, 'project_id=***');
}

/**
 * Get a built-in network configuration by name.
 *
 * Note: Environment variable overrides have been removed for browser compatibility.
 * Use explicit configuration via Client.create() options instead.
 *
 * @param network - Network name ('local' or 'preview')
 * @returns Network configuration
 * @throws For Blockfrost-hosted networks, which need {@link blockfrost}
 */
export function getNetworkConfig(network: string = 'local'): NetworkConfig {
  const config = NETWORKS[network];
  if (!config) {
    if ((BLOCKFROST_NETWORKS as readonly string[]).includes(network)) {
      throw new Error(
        `${network} is served by Blockfrost and needs a project token: use Config.blockfrost('${network}', projectId)`,
      );
    }
    throw new Error(`Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(', ')}`);
  }

  return config;
}

/**
 * Genesis wallet seed for local development (DO NOT use in production)
 */
export const DEV_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Default transaction TTL in milliseconds (30 minutes).
 *
 * Used as the fallback when no per-call `ttl` is provided to `balanceTx`.
 * Configurable via `txTtlMs` on `ClientConfig`.
 *
 * @since 0.12.0
 * @category constants
 */
export const DEFAULT_TX_TTL_MS = 30 * 60 * 1000;

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
  // In browser environments, pass the native WebSocket; in Node.js, let the library default to the `ws` package
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webSocketImpl = typeof globalThis.WebSocket !== 'undefined' ? globalThis.WebSocket as any : undefined;
  return indexerPublicDataProvider(config.indexer, config.indexerWS, webSocketImpl);
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
