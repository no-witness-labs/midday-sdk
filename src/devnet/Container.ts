/**
 * Docker container management for DevNet.
 *
 * @since 0.2.0
 * @module
 */

import Docker from 'dockerode';
import * as Config from './Config.js';
import type { ResolvedDevNetConfig } from './Config.js';
import * as Images from './Images.js';

/**
 * Error thrown when container operations fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class ContainerError extends Error {
  readonly reason: string;
  override readonly cause?: unknown;

  constructor(options: { reason: string; message: string; cause?: unknown }) {
    super(options.message);
    this.name = 'ContainerError';
    this.reason = options.reason;
    this.cause = options.cause;
  }
}

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
 * Start a container.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function start(container: Container): Promise<void> {
  try {
    const docker = new Docker();
    await docker.getContainer(container.id).start();
  } catch (cause) {
    throw new ContainerError({
      reason: 'container_start_failed',
      message: `Failed to start container '${container.name}'. Check if ports are available.`,
      cause,
    });
  }
}

/**
 * Stop a container.
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function stop(container: Container): Promise<void> {
  try {
    const docker = new Docker();
    const dockerContainer = docker.getContainer(container.id);
    const info = await dockerContainer.inspect();

    if (info.State.Running) {
      await dockerContainer.stop();
    }
  } catch (cause) {
    throw new ContainerError({
      reason: 'container_stop_failed',
      message: `Failed to stop container '${container.name}'.`,
      cause,
    });
  }
}

/**
 * Remove a container (stops it first if running).
 *
 * @since 0.2.0
 * @category lifecycle
 */
export async function remove(container: Container): Promise<void> {
  try {
    await stop(container);
    const docker = new Docker();
    await docker.getContainer(container.id).remove();
  } catch (cause) {
    throw new ContainerError({
      reason: 'container_removal_failed',
      message: `Failed to remove container '${container.name}'.`,
      cause,
    });
  }
}

/**
 * Get container status information.
 *
 * @since 0.2.0
 * @category inspection
 */
export async function getStatus(
  container: Container
): Promise<Docker.ContainerInspectInfo | undefined> {
  try {
    const docker = new Docker();
    return await docker.getContainer(container.id).inspect();
  } catch (cause) {
    throw new ContainerError({
      reason: 'container_inspection_failed',
      message: `Failed to inspect container '${container.name}'.`,
      cause,
    });
  }
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

/**
 * Find a container by name.
 *
 * @since 0.2.0
 * @category utilities
 * @internal
 */
export async function findByName(
  containerName: string
): Promise<Docker.Container | undefined> {
  try {
    const docker = new Docker();
    const containers = await docker.listContainers({ all: true });
    const found = containers.find((c) =>
      c.Names.includes(`/${containerName}`)
    );
    return found ? docker.getContainer(found.Id) : undefined;
  } catch (cause) {
    throw new ContainerError({
      reason: 'container_not_found',
      message: 'Ensure Docker is running and accessible.',
      cause,
    });
  }
}

/**
 * Remove a container by name if it exists.
 *
 * @since 0.2.0
 * @category utilities
 * @internal
 */
export async function removeByName(containerName: string): Promise<void> {
  const existing = await findByName(containerName);
  if (existing) {
    const info = await existing.inspect();
    if (info.State.Running) {
      await existing.stop();
    }
    await existing.remove();
  }
}

/**
 * Create a Midnight node container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createNode(
  config: ResolvedDevNetConfig
): Promise<Docker.Container> {
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
}

/**
 * Create an indexer container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createIndexer(
  config: ResolvedDevNetConfig
): Promise<Docker.Container> {
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
}

/**
 * Create a proof server container.
 *
 * @since 0.2.0
 * @category constructors
 * @internal
 */
export async function createProofServer(
  config: ResolvedDevNetConfig
): Promise<Docker.Container> {
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
}
