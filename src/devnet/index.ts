/**
 * DevNet module for local Midnight development and testing.
 *
 * Provides a complete local development environment with Docker containers
 * for Midnight node, indexer, and proof server.
 *
 * @example Promise API (default)
 * ```typescript
 * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Create and start a local devnet
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * // Use with midday-sdk
 * const client = await Midday.Client.create({
 *   networkConfig: cluster.networkConfig,
 *   privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
 * });
 *
 * // Load contract (zkConfig loaded per-contract)
 * const contract = await client.loadContract({ path: './contracts/counter' });
 *
 * // Cleanup
 * await cluster.remove();
 * ```
 *
 * @example Effect API (composable)
 * ```typescript
 * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
 * import { Effect } from 'effect';
 *
 * // Compose with Effect
 * const program = Effect.gen(function* () {
 *   const cluster = yield* Cluster.effect.make();
 *   yield* Cluster.effect.start(cluster);
 *   // ... your Effect-based code ...
 *   yield* Cluster.effect.remove(cluster);
 * });
 *
 * await Effect.runPromise(program);
 * ```
 *
 * @example Effect DI (dependency injection)
 * ```typescript
 * import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
 * import { Effect } from 'effect';
 *
 * // Use with Effect's dependency injection
 * const program = Effect.gen(function* () {
 *   const svc = yield* ClusterService;
 *   const cluster = yield* svc.make();
 *   yield* svc.start(cluster);
 *   return cluster.networkConfig;
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Cluster.Live)));
 * ```
 *
 * @since 0.2.0
 * @module
 */

export * as Cluster from './Cluster.js';
export * as Config from './Config.js';
export * as Container from './Container.js';
export * as Faucet from './Faucet.js';
export * as FeeRelay from './FeeRelay.js';
export * as Health from './Health.js';
export * as Images from './Images.js';
export * from './errors.js';

// Re-export service tags for DI users
export { ClusterService } from './Cluster.js';
export { ContainerService } from './Container.js';
export { HealthService } from './Health.js';
