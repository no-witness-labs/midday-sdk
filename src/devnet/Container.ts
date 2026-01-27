/**
 * Docker container management for DevNet.
 *
 * ## API Design
 *
 * This module uses a **module-function pattern**:
 *
 * - **Stateless**: Functions operate on Container data
 * - **Module functions**: `Container.start(container)`, `Container.stop(container)`
 * - **Data-oriented**: Container is plain data, not an instance with methods
 *
 * This is appropriate because:
 * - Container operations are stateless transformations
 * - No need to encapsulate state in the Container itself
 * - Simpler API for lower-level operations
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user
 * await Container.start(container);
 * await Container.stop(container);
 *
 * // Effect user
 * yield* Container.effect.start(container);
 * ```
 *
 * @since 0.2.0
 * @module
 */

import Docker from 'dockerode';
import { Context, Effect, Layer } from 'effect';
import * as Config from './Config.js';
import type { ResolvedDevNetConfig } from './Config.js';
import * as Images from './Images.js';
import { ContainerError } from './errors.js';

/**
 * Represents a Docker container.
 *
 * @since 0.2.0
 * @category model
 */
export interface Container {
  readonly id: string;
  readonly name: string;
}

/**
 * Service interface for Container operations.
 *
 * Use with Effect's dependency injection system.
 *
 * @since 0.2.0
 * @category service
 */
export interface ContainerServiceImpl {
  readonly start: (container: Container) => Effect.Effect<void, ContainerError>;
  readonly stop: (container: Container) => Effect.Effect<void, ContainerError>;
  readonly remove: (container: Container) => Effect.Effect<void, ContainerError>;
  readonly getStatus: (
    container: Container,
  ) => Effect.Effect<Docker.ContainerInspectInfo | undefined, ContainerError>;
  readonly isRunning: (container: Container) => Effect.Effect<boolean, never>;
}

/**
 * Context.Tag for ContainerService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class ContainerService extends Context.Tag('ContainerService')<
  ContainerService,
  ContainerServiceImpl
>() {}

// Internal Effect implementation
function startEffect(container: Container): Effect.Effect<void, ContainerError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        await docker.getContainer(container.id).start();
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'start',
          container: container.name,
          cause,
        }),
    });
  });
}

/**
 * Start a container.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function start(container: Container): Promise<void> {
  return Effect.runPromise(startEffect(container));
}

// Internal Effect implementation
function stopEffect(container: Container): Effect.Effect<void, ContainerError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        const dockerContainer = docker.getContainer(container.id);
        const info = await dockerContainer.inspect();

        if (info.State.Running) {
          await dockerContainer.stop();
        }
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'stop',
          container: container.name,
          cause,
        }),
    });
  });
}

/**
 * Stop a container.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function stop(container: Container): Promise<void> {
  return Effect.runPromise(stopEffect(container));
}

// Internal Effect implementation
function removeEffect(container: Container): Effect.Effect<void, ContainerError> {
  return Effect.gen(function* () {
    yield* stopEffect(container);
    yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        await docker.getContainer(container.id).remove();
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'remove',
          container: container.name,
          cause,
        }),
    });
  });
}

/**
 * Remove a container (stops it first if running).
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function remove(container: Container): Promise<void> {
  return Effect.runPromise(removeEffect(container));
}

// Internal Effect implementation
function getStatusEffect(
  container: Container,
): Effect.Effect<Docker.ContainerInspectInfo | undefined, ContainerError> {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        return await docker.getContainer(container.id).inspect();
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'inspect',
          container: container.name,
          cause,
        }),
    });
  });
}

/**
 * Get container status information.
 *
 * @since 0.2.0
 * @category inspection
 */
export async function getStatus(
  container: Container,
): Promise<Docker.ContainerInspectInfo | undefined> {
  return Effect.runPromise(getStatusEffect(container));
}

/**
 * Check if a container is running.
 *
 * @since 0.2.0
 * @category inspection
 */
export async function isRunning(container: Container): Promise<boolean> {
  try {
    const status = await getStatus(container);
    return status?.State.Running ?? false;
  } catch {
    return false;
  }
}

// Internal Effect implementation
function findByNameEffect(
  containerName: string,
): Effect.Effect<Docker.Container | undefined, ContainerError> {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        const containers = await docker.listContainers({ all: true });
        const found = containers.find((c) => c.Names.includes(`/${containerName}`));
        return found ? docker.getContainer(found.Id) : undefined;
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'lookup',
          container: containerName,
          cause,
        }),
    });
  });
}

/**
 * Find a container by name.
 *
 * @since 0.2.0
 * @category utilities
 * @internal
 */
export async function findByName(
  containerName: string,
): Promise<Docker.Container | undefined> {
  return Effect.runPromise(findByNameEffect(containerName));
}

// Internal Effect implementation
function removeByNameEffect(containerName: string): Effect.Effect<void, ContainerError> {
  return Effect.gen(function* () {
    const existing = yield* findByNameEffect(containerName);
    if (existing) {
      yield* Effect.tryPromise({
        try: async () => {
          const info = await existing.inspect();
          if (info.State.Running) {
            await existing.stop();
          }
          await existing.remove();
        },
        catch: (cause: unknown) =>
          new ContainerError({
            operation: 'remove',
            container: containerName,
            cause,
          }),
      });
    }
  });
}

/**
 * Remove a container by name if it exists.
 *
 * @since 0.2.0
 * @category utilities
 * @internal
 */
export async function removeByName(containerName: string): Promise<void> {
  return Effect.runPromise(removeByNameEffect(containerName));
}

// Internal Effect implementation
function createNodeEffect(
  config: ResolvedDevNetConfig,
): Effect.Effect<Docker.Container, ContainerError> {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        const containerName = `${config.clusterName}-node`;

        await Images.ensureAvailable(config.node.image);

        return docker.createContainer({
          Image: config.node.image,
          name: containerName,
          ExposedPorts: {
            [`${config.node.port}/tcp`]: {},
          },
          HostConfig: {
            PortBindings: {
              // Node exposes 9944 internally, we map to configured port
              ['9944/tcp']: [{ HostPort: String(config.node.port) }],
            },
          },
          Env: [`CFG_PRESET=${config.node.cfgPreset}`],
        });
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'create',
          container: `${config.clusterName}-node`,
          cause,
        }),
    });
  });
}

/**
 * Create a Midnight node container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createNode(
  config: ResolvedDevNetConfig,
): Promise<Docker.Container> {
  return Effect.runPromise(createNodeEffect(config));
}

// Internal Effect implementation
function createIndexerEffect(
  config: ResolvedDevNetConfig,
): Effect.Effect<Docker.Container, ContainerError> {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        const containerName = `${config.clusterName}-indexer`;
        const nodeUrl = `ws://${config.clusterName}-node:9944`;

        await Images.ensureAvailable(config.indexer.image);

        return docker.createContainer({
          Image: config.indexer.image,
          name: containerName,
          ExposedPorts: {
            [`${config.indexer.port}/tcp`]: {},
          },
          HostConfig: {
            PortBindings: {
              // Indexer exposes 8088 internally
              ['8088/tcp']: [{ HostPort: String(config.indexer.port) }],
            },
            Links: [`${config.clusterName}-node:${config.clusterName}-node`],
          },
          Env: [
            `RUST_LOG=indexer=${config.indexer.logLevel},chain_indexer=${config.indexer.logLevel},indexer_api=${config.indexer.logLevel},wallet_indexer=${config.indexer.logLevel},indexer_common=${config.indexer.logLevel},fastrace_opentelemetry=${config.indexer.logLevel},${config.indexer.logLevel}`,
            `APP__INFRA__SECRET=${Config.DEV_INDEXER_SECRET}`,
            `APP__INFRA__NODE__URL=${nodeUrl}`,
          ],
        });
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'create',
          container: `${config.clusterName}-indexer`,
          cause,
        }),
    });
  });
}

/**
 * Create an indexer container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createIndexer(
  config: ResolvedDevNetConfig,
): Promise<Docker.Container> {
  return Effect.runPromise(createIndexerEffect(config));
}

// Internal Effect implementation
function createProofServerEffect(
  config: ResolvedDevNetConfig,
): Effect.Effect<Docker.Container, ContainerError> {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const docker = new Docker();
        const containerName = `${config.clusterName}-proof-server`;

        await Images.ensureAvailable(config.proofServer.image);

        const binds: string[] = [];
        if (config.proofServer.zkParamsPath) {
          binds.push(`${config.proofServer.zkParamsPath}:/root/.cache/midnight/zk-params`);
        }

        return docker.createContainer({
          Image: config.proofServer.image,
          name: containerName,
          ExposedPorts: {
            [`${config.proofServer.port}/tcp`]: {},
          },
          HostConfig: {
            PortBindings: {
              // Proof server exposes 6300 internally
              ['6300/tcp']: [{ HostPort: String(config.proofServer.port) }],
            },
            Binds: binds.length > 0 ? binds : undefined,
          },
          Env: ['HOME=/root'],
        });
      },
      catch: (cause: unknown) =>
        new ContainerError({
          operation: 'create',
          container: `${config.clusterName}-proof-server`,
          cause,
        }),
    });
  });
}

/**
 * Create a proof server container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createProofServer(
  config: ResolvedDevNetConfig,
): Promise<Docker.Container> {
  return Effect.runPromise(createProofServerEffect(config));
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  start: startEffect,
  stop: stopEffect,
  remove: removeEffect,
  getStatus: getStatusEffect,
  findByName: findByNameEffect,
  removeByName: removeByNameEffect,
  createNode: createNodeEffect,
  createIndexer: createIndexerEffect,
  createProofServer: createProofServerEffect,
};

/**
 * Live Layer for ContainerService.
 *
 * Provides the default implementation of ContainerService for Effect DI.
 *
 * @since 0.2.0
 * @category layer
 */
export const Live: Layer.Layer<ContainerService> = Layer.succeed(ContainerService, {
  start: startEffect,
  stop: stopEffect,
  remove: removeEffect,
  getStatus: getStatusEffect,
  isRunning: (container) =>
    getStatusEffect(container).pipe(
      Effect.map((status) => status?.State.Running ?? false),
      Effect.catchAll(() => Effect.succeed(false)),
    ),
});
