/**
 * DevNet cluster orchestration.
 *
 * Manages the lifecycle of a complete Midnight development environment
 * consisting of a node, indexer, and proof server.
 *
 * ## API Design
 *
 * This module uses an **instance-based pattern**:
 *
 * - **Stateful**: A Cluster holds references to Docker containers
 * - **Instance methods**: `cluster.start()`, `cluster.stop()`, etc.
 * - **Effect-first**: Internal implementation uses Effect
 * - **Promise wrapper**: `.effect` namespace exposes raw Effects
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user (majority)
 * const cluster = await Cluster.make();
 * await cluster.start();           // instance method
 * const config = cluster.networkConfig;  // accessor
 * await cluster.stop();
 *
 * // Effect user (composable)
 * const cluster = yield* Cluster.effect.make();
 * yield* cluster.effect.start();   // raw Effect access
 *
 * // Effect DI user (dependency injection)
 * const cluster = yield* ClusterService;
 * yield* cluster.effect.start();
 * // provide with: Effect.provide(Cluster.Live) or Cluster.layer({ ... })
 * ```
 *
 * @since 0.2.0
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import type { NetworkConfig } from '../Config.js';
import * as Config from './Config.js';
import type { DevNetConfig, ResolvedDevNetConfig } from './Config.js';
import * as Container from './Container.js';
import * as Health from './Health.js';
import { ClusterError } from './errors.js';

/**
 * Raw cluster data (containers and config).
 *
 * @since 0.2.0
 * @category model
 */
export interface ClusterData {
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
 * A DevNet cluster instance with lifecycle methods.
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
  /** Network configuration for use with midday-sdk client */
  readonly networkConfig: NetworkConfig;

  // Promise lifecycle methods
  /** Start the cluster */
  readonly start: () => Promise<void>;
  /** Stop the cluster */
  readonly stop: () => Promise<void>;
  /** Remove the cluster */
  readonly remove: () => Promise<void>;
  /** Check if the cluster is running */
  readonly isRunning: () => Promise<boolean>;

  // Effect namespace for advanced users
  readonly effect: {
    /** Start the cluster (raw Effect) */
    readonly start: () => Effect.Effect<void, ClusterError>;
    /** Stop the cluster (raw Effect) */
    readonly stop: () => Effect.Effect<void, ClusterError>;
    /** Remove the cluster (raw Effect) */
    readonly remove: () => Effect.Effect<void, ClusterError>;
  };
}

/**
 * Context.Tag for ClusterService dependency injection.
 *
 * Yields a Cluster instance directly. Use `Cluster.layer()` to provide
 * with custom configuration.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const program = Effect.gen(function* () {
 *   const cluster = yield* ClusterService;
 *   yield* cluster.effect.start();
 *   return cluster.networkConfig;
 * });
 *
 * // With default config
 * await Effect.runPromise(program.pipe(Effect.provide(Cluster.Live)));
 *
 * // With custom config
 * await Effect.runPromise(program.pipe(
 *   Effect.provide(Cluster.layer({ clusterName: 'my-devnet' }))
 * ));
 * ```
 *
 * @since 0.2.0
 * @category service
 */
export class ClusterService extends Context.Tag('ClusterService')<
  ClusterService,
  Cluster
>() {}

// =============================================================================
// Internal Effect Implementations
// =============================================================================

/**
 * Internal Effect implementation for creating a cluster.
 * @internal
 */
const makeEffect = (config: DevNetConfig = {}) =>
  Effect.gen(function* () {
    // Resolve configuration with defaults
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

    // Clean up existing containers
    const containerNames = [
      `${fullConfig.clusterName}-node`,
      `${fullConfig.clusterName}-indexer`,
      `${fullConfig.clusterName}-proof-server`,
    ];

    yield* Effect.tryPromise({
      try: async () => {
        for (const name of containerNames) {
          try {
            await Container.removeByName(name);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
      catch: (cause: unknown) => new ClusterError({ operation: 'cleanup', cause }),
    });

    // Create node first (indexer depends on it via Docker links)
    const nodeContainer = yield* Effect.tryPromise({
      try: () => Container.createNode(fullConfig),
      catch: (cause: unknown) => new ClusterError({ operation: 'create', cause }),
    });

    // Create indexer and proof server in parallel (both depend on node existing)
    const [indexerContainer, proofServerContainer] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => Container.createIndexer(fullConfig),
          catch: (cause: unknown) => new ClusterError({ operation: 'create', cause }),
        }),
        Effect.tryPromise({
          try: () => Container.createProofServer(fullConfig),
          catch: (cause: unknown) => new ClusterError({ operation: 'create', cause }),
        }),
      ],
      { concurrency: 2 },
    );

    const data: ClusterData = {
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

    // Create instance with bound methods
    const cluster: Cluster = {
      ...data,
      networkConfig: Config.toNetworkConfig({
        node: fullConfig.node.port,
        indexer: fullConfig.indexer.port,
        proofServer: fullConfig.proofServer.port,
      }),
      // Promise lifecycle methods
      start: () => Effect.runPromise(startEffect(data)),
      stop: () => Effect.runPromise(stopEffect(data)),
      remove: () => Effect.runPromise(removeEffect(data)),
      isRunning: () => isRunningImpl(data),
      // Effect namespace
      effect: {
        start: () => startEffect(data),
        stop: () => stopEffect(data),
        remove: () => removeEffect(data),
      },
    };

    return cluster;
  });

/**
 * Internal Effect implementation for starting a cluster.
 * @internal
 */
const startEffect = (data: ClusterData) =>
  Effect.gen(function* () {
    // Start node first
    yield* Effect.tryPromise({
      try: () => Container.start(data.node),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.node.name,
          cause,
        }),
    });

    // Wait for node to be ready
    yield* Effect.tryPromise({
      try: () => Health.waitForNode(data.config.node.port),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.node.name,
          cause,
        }),
    });

    // Start indexer (depends on node)
    yield* Effect.tryPromise({
      try: () => Container.start(data.indexer),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.indexer.name,
          cause,
        }),
    });

    // Wait for indexer to be healthy (uses Docker healthcheck which checks /var/run/indexer-standalone/running)
    yield* Effect.tryPromise({
      try: () => Health.waitForContainerHealthy(data.indexer.name, { timeout: 120000 }),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.indexer.name,
          cause,
        }),
    });

    // Start proof server (independent)
    yield* Effect.tryPromise({
      try: () => Container.start(data.proofServer),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.proofServer.name,
          cause,
        }),
    });

    // Wait for proof server to be ready
    yield* Effect.tryPromise({
      try: () => Health.waitForProofServer(data.config.proofServer.port),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.proofServer.name,
          cause,
        }),
    });

    // Wait for indexer to fully sync genesis blocks (including dust allocation)
    // The indexer healthcheck passes when running, but we need blocks to be indexed
    yield* Effect.tryPromise({
      try: () => Health.waitForIndexerSynced(data.config.indexer.port),
      catch: (cause: unknown) =>
        new ClusterError({
          operation: 'start',
          cluster: data.indexer.name,
          cause,
        }),
    });
  });

/**
 * Internal Effect implementation for stopping a cluster.
 * @internal
 */
const stopEffect = (data: ClusterData) =>
  Effect.gen(function* () {
    // Stop in reverse order, collecting errors but continuing
    yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => Container.stop(data.proofServer),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'stop',
              cluster: data.proofServer.name,
              cause,
            }),
        }).pipe(Effect.either),
        Effect.tryPromise({
          try: () => Container.stop(data.indexer),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'stop',
              cluster: data.indexer.name,
              cause,
            }),
        }).pipe(Effect.either),
        Effect.tryPromise({
          try: () => Container.stop(data.node),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'stop',
              cluster: data.node.name,
              cause,
            }),
        }).pipe(Effect.either),
      ],
      { concurrency: 3 },
    );
  });

/**
 * Internal Effect implementation for removing a cluster.
 * @internal
 */
const removeEffect = (data: ClusterData) =>
  Effect.gen(function* () {
    // Remove in reverse order, collecting errors but continuing
    yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => Container.remove(data.proofServer),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'remove',
              cluster: data.proofServer.name,
              cause,
            }),
        }).pipe(Effect.either),
        Effect.tryPromise({
          try: () => Container.remove(data.indexer),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'remove',
              cluster: data.indexer.name,
              cause,
            }),
        }).pipe(Effect.either),
        Effect.tryPromise({
          try: () => Container.remove(data.node),
          catch: (cause: unknown) =>
            new ClusterError({
              operation: 'remove',
              cluster: data.node.name,
              cause,
            }),
        }).pipe(Effect.either),
      ],
      { concurrency: 3 },
    );

    // Remove the Docker network
    yield* Effect.tryPromise({
      try: () => Container.removeClusterNetwork(data.config.clusterName),
      catch: () =>
        new ClusterError({
          operation: 'remove',
          cluster: `${data.config.clusterName}-network`,
          cause: 'Failed to remove network',
        }),
    }).pipe(Effect.either);
  });

// =============================================================================
// Promise API (Default)
// =============================================================================

/**
 * Create a new DevNet cluster instance.
 *
 * Returns a cluster with bound lifecycle methods.
 * This creates the containers but does not start them.
 *
 * @example
 * ```typescript
 * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * // Access network config directly
 * const client = await Midday.Client.create({
 *   networkConfig: cluster.networkConfig,
 *   seed: 'your-wallet-seed',
 * });
 *
 * // ... run tests ...
 *
 * await cluster.remove();
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (config?: DevNetConfig): Promise<Cluster> =>
  Effect.runPromise(makeEffect(config));

/**
 * Internal implementation for checking if a cluster is running.
 * @internal
 */
const isRunningImpl = async (data: ClusterData): Promise<boolean> => {
  const [nodeRunning, indexerRunning, proofServerRunning] = await Promise.all([
    Container.isRunning(data.node),
    Container.isRunning(data.indexer),
    Container.isRunning(data.proofServer),
  ]);

  return nodeRunning && indexerRunning && proofServerRunning;
};

/**
 * Helper function to run code with an automatically managed cluster.
 * The cluster is created, started, and cleaned up automatically.
 *
 * @example
 * ```typescript
 * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
 *
 * await Cluster.withCluster(async (cluster) => {
 *   // Use cluster.networkConfig directly
 *   const config = cluster.networkConfig;
 *   // Your code here - cluster will be cleaned up automatically
 *   return config;
 * });
 * ```
 *
 * @since 0.2.0
 * @category utilities
 */
export const withCluster = async <T>(
  fn: (cluster: Cluster) => Promise<T>,
  config?: DevNetConfig,
): Promise<T> => {
  const cluster = await make(config);
  try {
    await cluster.start();
    return await fn(cluster);
  } finally {
    await cluster.remove();
  }
};

// =============================================================================
// Effect Namespace (Advanced)
// =============================================================================

/**
 * Effect API for advanced users who want full composability,
 * type-safe errors, retries, and other Effect benefits.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const program = Effect.gen(function* () {
 *   const cluster = yield* Cluster.effect.make();
 *   yield* cluster.effect.start();  // Use instance method
 *   return cluster;
 * }).pipe(
 *   Effect.retry({ times: 3 }),
 *   Effect.timeout('5 minutes')
 * );
 *
 * await Effect.runPromise(program);
 * ```
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  /**
   * Create a cluster instance (returns raw Effect).
   *
   * The returned cluster has an `.effect` namespace for lifecycle methods.
   *
   * @since 0.2.0
   */
  make: makeEffect,

  /**
   * Run code with an automatically managed cluster (returns raw Effect).
   *
   * @example
   * ```typescript
   * import { Effect } from 'effect';
   * import { Cluster } from '@no-witness-labs/midday-sdk/devnet';
   *
   * const program = Cluster.effect.withCluster((cluster) =>
   *   Effect.gen(function* () {
   *     const config = cluster.networkConfig;
   *     return config;
   *   })
   * );
   *
   * await Effect.runPromise(program);
   * ```
   *
   * @since 0.2.0
   */
  withCluster: <A, E, R>(
    fn: (cluster: Cluster) => Effect.Effect<A, E, R>,
    config?: DevNetConfig,
  ): Effect.Effect<A, E | ClusterError, R> =>
    Effect.gen(function* () {
      const cluster = yield* makeEffect(config);
      yield* cluster.effect.start();
      return yield* fn(cluster).pipe(
        Effect.ensuring(cluster.effect.remove().pipe(Effect.ignore)),
      );
    }),
} as const;

/**
 * Create a Layer that provides ClusterService with custom configuration.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const program = Effect.gen(function* () {
 *   const cluster = yield* ClusterService;
 *   yield* cluster.effect.start();
 *   return cluster;
 * });
 *
 * await Effect.runPromise(program.pipe(
 *   Effect.provide(Cluster.layer({ clusterName: 'my-devnet' }))
 * ));
 * ```
 *
 * @since 0.2.0
 * @category layer
 */
export const layer = (
  config?: DevNetConfig,
): Layer.Layer<ClusterService, ClusterError> =>
  Layer.effect(ClusterService, makeEffect(config));

/**
 * Live Layer for ClusterService with default configuration.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const program = Effect.gen(function* () {
 *   const cluster = yield* ClusterService;
 *   yield* cluster.effect.start();
 *   return cluster;
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Cluster.Live)));
 * ```
 *
 * @since 0.2.0
 * @category layer
 */
export const Live: Layer.Layer<ClusterService, ClusterError> = layer();
