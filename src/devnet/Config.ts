/**
 * Configuration for Midnight DevNet.
 *
 * @since 0.2.0
 * @module
 */

import type { NetworkConfig } from '../Config.js';

/**
 * Configuration for the Midnight node container.
 *
 * @since 0.2.0
 * @category model
 */
export interface NodeConfig {
  readonly image?: string;
  readonly port?: number;
  /** Node configuration preset (default: 'dev') */
  readonly cfgPreset?: string;
}

/**
 * Configuration for the indexer container.
 *
 * @since 0.2.0
 * @category model
 */
export interface IndexerConfig {
  readonly image?: string;
  readonly port?: number;
  readonly logLevel?: string;
}

/**
 * Configuration for the proof server container.
 *
 * @since 0.2.0
 * @category model
 */
export interface ProofServerConfig {
  readonly image?: string;
  readonly port?: number;
  /** Path to ZK params directory on host */
  readonly zkParamsPath?: string;
}

/**
 * Configuration for the fee relay container.
 *
 * @since 0.2.0
 * @category model
 */
export interface FeeRelayConfig {
  readonly image?: string;
  readonly port?: number;
  /** Enable fee relay server (default: true) */
  readonly enabled?: boolean;
}

/**
 * Configuration for the faucet container.
 *
 * @since 0.2.0
 * @category model
 */
export interface FaucetConfig {
  readonly image?: string;
  readonly port?: number;
  /** Enable faucet server (default: true) */
  readonly enabled?: boolean;
}

/**
 * Configuration interface for Midnight DevNet setup.
 * All properties are optional, with sensible defaults provided.
 *
 * @since 0.2.0
 * @category model
 */
export interface DevNetConfig {
  /** Unique name for this cluster (default: 'midday-devnet') */
  readonly clusterName?: string;
  /** Node configuration */
  readonly node?: NodeConfig;
  /** Indexer configuration */
  readonly indexer?: IndexerConfig;
  /** Proof server configuration */
  readonly proofServer?: ProofServerConfig;
  /** Faucet configuration */
  readonly faucet?: FaucetConfig;
  /** Fee relay configuration */
  readonly feeRelay?: FeeRelayConfig;
}

/**
 * Fully resolved DevNet configuration with all defaults applied.
 *
 * @since 0.2.0
 * @category model
 */
export interface ResolvedDevNetConfig {
  readonly clusterName: string;
  readonly node: Required<NodeConfig>;
  readonly indexer: Required<IndexerConfig>;
  readonly proofServer: Required<ProofServerConfig>;
  readonly faucet: Required<FaucetConfig>;
  readonly feeRelay: Required<FeeRelayConfig>;
}

/**
 * Default Midnight node configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_NODE_CONFIG: Required<NodeConfig> = {
  image: 'midnightntwrk/midnight-node:0.20.1',
  port: 9944,
  cfgPreset: 'dev',
} as const;

/**
 * Default indexer configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_INDEXER_CONFIG: Required<IndexerConfig> = {
  image: 'midnightntwrk/indexer-standalone:3.0.0',
  port: 8088,
  logLevel: 'info',
} as const;

/**
 * Default proof server configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_PROOF_SERVER_CONFIG: Required<ProofServerConfig> = {
  image: 'bricktowers/proof-server:7.0.0',
  port: 6300,
  zkParamsPath: '',
} as const;

/**
 * Default faucet configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_FAUCET_CONFIG: Required<FaucetConfig> = {
  image: 'midday-faucet:latest',
  port: 3001,
  enabled: true,
} as const;

/**
 * Default fee relay configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_FEE_RELAY_CONFIG: Required<FeeRelayConfig> = {
  image: 'midday-fee-relay:latest',
  port: 3002,
  enabled: true,
} as const;

/**
 * Default DevNet configuration.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEFAULT_DEVNET_CONFIG: Required<DevNetConfig> = {
  clusterName: 'midday-devnet',
  node: DEFAULT_NODE_CONFIG,
  indexer: DEFAULT_INDEXER_CONFIG,
  proofServer: DEFAULT_PROOF_SERVER_CONFIG,
  faucet: DEFAULT_FAUCET_CONFIG,
  feeRelay: DEFAULT_FEE_RELAY_CONFIG,
} as const;

/**
 * Indexer secret for local development (matches docker-compose).
 * DO NOT use in production.
 *
 * @since 0.2.0
 * @category constants
 */
export const DEV_INDEXER_SECRET =
  '303132333435363738393031323334353637383930313233343536373839303132';

/**
 * Convert cluster ports to a NetworkConfig compatible with midday-sdk.
 *
 * @since 0.2.0
 * @category utilities
 */
export function toNetworkConfig(ports: {
  node: number;
  indexer: number;
  proofServer: number;
}): NetworkConfig {
  return {
    networkId: 'undeployed',
    indexer: `http://localhost:${ports.indexer}/api/v3/graphql`,
    indexerWS: `ws://localhost:${ports.indexer}/api/v3/graphql/ws`,
    node: `ws://localhost:${ports.node}`,
    proofServer: `http://localhost:${ports.proofServer}`,
  };
}
