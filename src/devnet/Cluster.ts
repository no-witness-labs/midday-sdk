/**
 * DevNet cluster orchestration.
 *
 * Manages the lifecycle of a complete Midnight development environment
 * consisting of a node, indexer, and proof server.
 *
 * @since 0.2.0
 * @module
 */

import type { NetworkConfig } from '../Config.js';
import * as Config from './Config.js';
import type { ResolvedDevNetConfig } from './Config.js';
import * as Container from './Container.js';
import * as Health from './Health.js';

/**
 * Error thrown when cluster operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class ClusterError extends Error {
  readonly reason: string;
  override readonly cause?: unknown;

  constructor(options: { reason: string; message: string; cause?: unknown }) {
    super(options.message);
    this.name = 'ClusterError';
    this.reason = options.reason;
    this.cause = options.cause;
  }
}

/**
 * Represents a running DevNet cluster.
 *
 * @since 0.2.0
 * @category model
 */
export interface Cluster {
  /** The Midnight node container */
  readonly node: Container.Container;
  /** The indexer container */
  readonly indexer: Container.Container;
  /** The proof server container */
  readonly proofServer: Container.Container;
  /** The resolved configuration */
  readonly config: ResolvedDevNetConfig;
}

/**
 * Create a new DevNet cluster.
 *
 * This creates the containers but does not start them.
 * Use `start()` to start the cluster after creation.
 *
 * @example
 * ```typescript
 * import * as Devnet from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Devnet.Cluster.make();
 * await Devnet.Cluster.start(cluster);
 *
 * // Get network config for midday-sdk client
 * const networkConfig = Devnet.Cluster.toNetworkConfig(cluster);
 *
 * // ... run tests ...
 *
 * await Devnet.Cluster.remove(cluster);
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export async function make(config: Config.DevNetConfig = {}): Promise<Cluster> {
  const fullConfig: ResolvedDevNetConfig = {
    clusterName: config.clusterName ?? Config.DEFAULT_DEVNET_CONFIG.clusterName,
    node: {
      ...Config.DEFAULT_NODE_CONFIG,
      ...config.node,
    },
    indexer: {
      ...Config.DEFAULT_INDEXER_CONFIG,
      ...config.indexer,
    },
    proofServer: {
      ...Config.DEFAULT_PROOF_SERVER_CONFIG,
      ...config.proofServer,
    },
  };

  // Remove existing containers if they exist
  const containerNames = [
    `${fullConfig.clusterName}-node`,
    `${fullConfig.clusterName}-indexer`,
    `${fullConfig.clusterName}-proof-server`,
  ];

  for (const name of containerNames) {
    try {
      await Container.removeByName(name);
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Create containers
  let nodeContainer: Awaited<ReturnType<typeof Container.createNode>>;
  let indexerContainer: Awaited<ReturnType<typeof Container.createIndexer>>;
  let proofServerContainer: Awaited<ReturnType<typeof Container.createProofServer>>;

  try {
    nodeContainer = await Container.createNode(fullConfig);
  } catch (cause) {
    throw new ClusterError({
      reason: 'node_creation_failed',
      message: 'Failed to create Midnight node container.',
      cause,
    });
  }

  try {
    indexerContainer = await Container.createIndexer(fullConfig);
  } catch (cause) {
    throw new ClusterError({
      reason: 'indexer_creation_failed',
      message: 'Failed to create indexer container.',
      cause,
    });
  }

  try {
    proofServerContainer = await Container.createProofServer(fullConfig);
  } catch (cause) {
    throw new ClusterError({
      reason: 'proof_server_creation_failed',
      message: 'Failed to create proof server container.',
      cause,
    });
  }

  return {
    node: {
      id: nodeContainer.id,
      name: `${fullConfig.clusterName}-node`,
    },
    indexer: {
      id: indexerContainer.id,
      name: `${fullConfig.clusterName}-indexer`,
    },
    proofServer: {
      id: proofServerContainer.id,
      name: `${fullConfig.clusterName}-proof-server`,
    },
    config: fullConfig,
  };
}

/**
 * Start a DevNet cluster.
 *
 * Starts all containers and waits for health checks to pass.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function start(cluster: Cluster): Promise<void> {

  // Start node first
  try {
    await Container.start(cluster.node);
  } catch (cause) {
    throw new ClusterError({
      reason: 'node_start_failed',
      message: 'Failed to start Midnight node.',
      cause,
    });
  }

  // Wait for node to be ready
  await Health.waitForNode(cluster.config.node.port);

  // Start indexer (depends on node)
  try {
    await Container.start(cluster.indexer);
  } catch (cause) {
    throw new ClusterError({
      reason: 'indexer_start_failed',
      message: 'Failed to start indexer.',
      cause,
    });
  }

  // Wait for indexer to be ready
  await Health.waitForIndexer(cluster.config.indexer.port);

  // Start proof server (independent)
  try {
    await Container.start(cluster.proofServer);
  } catch (cause) {
    throw new ClusterError({
      reason: 'proof_server_start_failed',
      message: 'Failed to start proof server.',
      cause,
    });
  }

  // Wait for proof server to be ready
  await Health.waitForProofServer(cluster.config.proofServer.port);
}

/**
 * Stop a DevNet cluster.
 *
 * Stops all containers in reverse order.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function stop(cluster: Cluster): Promise<void> {

  // Stop in reverse order
  const errors: Error[] = [];

  try {
    await Container.stop(cluster.proofServer);
  } catch (e) {
    errors.push(e as Error);
  }

  try {
    await Container.stop(cluster.indexer);
  } catch (e) {
    errors.push(e as Error);
  }

  try {
    await Container.stop(cluster.node);
  } catch (e) {
    errors.push(e as Error);
  }

}

/**
 * Remove a DevNet cluster.
 *
 * Stops and removes all containers.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function remove(cluster: Cluster): Promise<void> {

  const errors: Error[] = [];

  try {
    await Container.remove(cluster.proofServer);
  } catch (e) {
    errors.push(e as Error);
  }

  try {
    await Container.remove(cluster.indexer);
  } catch (e) {
    errors.push(e as Error);
  }

  try {
    await Container.remove(cluster.node);
  } catch (e) {
    errors.push(e as Error);
  }

}

/**
 * Get the network configuration for use with midday-sdk client.
 *
 * @example
 * ```typescript
 * import { createClient } from '@no-witness-labs/midday-sdk';
 * import * as Devnet from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Devnet.Cluster.make();
 * await Devnet.Cluster.start(cluster);
 *
 * const client = await createClient({
 *   networkConfig: Devnet.Cluster.toNetworkConfig(cluster),
 *   seed: 'your-wallet-seed',
 * });
 * ```
 *
 * @since 0.2.0
 * @category utilities
 */
export function toNetworkConfig(cluster: Cluster): NetworkConfig {
  return Config.toNetworkConfig({
    node: cluster.config.node.port,
    indexer: cluster.config.indexer.port,
    proofServer: cluster.config.proofServer.port,
  });
}

/**
 * Check if a cluster is running.
 *
 * @since 0.2.0
 * @category inspection
 */
export async function isRunning(cluster: Cluster): Promise<boolean> {
  const [nodeRunning, indexerRunning, proofServerRunning] = await Promise.all([
    Container.isRunning(cluster.node),
    Container.isRunning(cluster.indexer),
    Container.isRunning(cluster.proofServer),
  ]);

  return nodeRunning && indexerRunning && proofServerRunning;
}
