/**
 * DevNet module for local Midnight development and testing.
 *
 * Provides a complete local development environment with Docker containers
 * for Midnight node, indexer, and proof server.
 *
 * @example
 * ```typescript
 * import * as Devnet from '@no-witness-labs/midday-sdk/devnet';
 * import { createClient } from '@no-witness-labs/midday-sdk';
 *
 * // Create and start a local devnet
 * const cluster = await Devnet.Cluster.make();
 * await Devnet.Cluster.start(cluster);
 *
 * // Use with midday-sdk
 * const client = await createClient({
 *   networkConfig: Devnet.Cluster.toNetworkConfig(cluster),
 *   seed: 'your-wallet-seed',
 * });
 *
 * // ... run your tests or development ...
 *
 * // Cleanup
 * await Devnet.Cluster.remove(cluster);
 * ```
 *
 * @since 0.2.0
 * @module
 */

export * as Cluster from './Cluster.js';
export * as Config from './Config.js';
export * as Container from './Container.js';
export * as Health from './Health.js';
export * as Images from './Images.js';
