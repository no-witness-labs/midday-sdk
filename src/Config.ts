/**
 * Network configuration and constants for Midnight Network.
 *
 * @since 0.1.0
 * @module
 */

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
  // Add testnet/mainnet configs when available
} as const;

/**
 * Get network configuration from environment or defaults
 */
export function getNetworkConfig(network: string = 'local'): NetworkConfig {
  // Check for environment variable overrides first
  if (
    process.env.MIDNIGHT_INDEXER ||
    process.env.MIDNIGHT_INDEXER_WS ||
    process.env.MIDNIGHT_NODE ||
    process.env.MIDNIGHT_PROOF_SERVER
  ) {
    return {
      networkId: process.env.MIDNIGHT_NETWORK_ID || 'undeployed',
      indexer: process.env.MIDNIGHT_INDEXER || NETWORKS.local.indexer,
      indexerWS: process.env.MIDNIGHT_INDEXER_WS || NETWORKS.local.indexerWS,
      node: process.env.MIDNIGHT_NODE || NETWORKS.local.node,
      proofServer: process.env.MIDNIGHT_PROOF_SERVER || NETWORKS.local.proofServer,
    };
  }

  // Use predefined network config
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
