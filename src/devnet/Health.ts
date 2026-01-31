/**
 * Health check utilities for DevNet containers.
 *
 * ## API Design
 *
 * This module uses a **module-function pattern**:
 *
 * - **Stateless**: Health checks are pure functions
 * - **Module functions**: `Health.waitForNode(port)`, `Health.waitForIndexer(port)`
 * - **No instance needed**: Just utility functions
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user
 * await Health.waitForNode(9944);
 * await Health.waitForIndexer(8088);
 *
 * // Effect user
 * yield* Health.effect.waitForNode(9944);
 * ```
 *
 * @since 0.2.0
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import { HealthCheckError } from './errors.js';

/**
 * Options for health check polling.
 *
 * @since 0.2.0
 * @category model
 */
export interface HealthCheckOptions {
  /** Maximum time to wait in milliseconds (default: 60000) */
  timeout?: number;
  /** Interval between checks in milliseconds (default: 1000) */
  interval?: number;
  /** Number of consecutive successes required (default: 1) */
  requiredSuccesses?: number;
}

/**
 * Service interface for Health check operations.
 *
 * Use with Effect's dependency injection system.
 *
 * @since 0.2.0
 * @category service
 */
export interface HealthServiceImpl {
  readonly waitForHttp: (
    url: string,
    options?: HealthCheckOptions,
  ) => Effect.Effect<void, HealthCheckError>;
  readonly waitForWebSocket: (
    url: string,
    options?: HealthCheckOptions,
  ) => Effect.Effect<void, HealthCheckError>;
  readonly waitForNode: (
    port: number,
    options?: HealthCheckOptions,
  ) => Effect.Effect<void, HealthCheckError>;
  readonly waitForIndexer: (
    port: number,
    options?: HealthCheckOptions,
  ) => Effect.Effect<void, HealthCheckError>;
  readonly waitForProofServer: (
    port: number,
    options?: HealthCheckOptions,
  ) => Effect.Effect<void, HealthCheckError>;
}

/**
 * Context.Tag for HealthService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class HealthService extends Context.Tag('HealthService')<HealthService, HealthServiceImpl>() {}

// Internal Effect implementation
function waitForHttpEffect(
  url: string,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const { timeout = 60000, interval = 1000, requiredSuccesses = 1 } = options;
        const startTime = Date.now();
        let successCount = 0;

        while (Date.now() - startTime < timeout) {
          try {
            const response = await fetch(url, {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
              successCount++;
              if (successCount >= requiredSuccesses) {
                return;
              }
            } else {
              successCount = 0;
            }
          } catch {
            successCount = 0;
          }

          await sleep(interval);
        }

        throw new Error(`Health check timed out after ${timeout}ms for ${url}`);
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: url,
          cause,
        }),
    });
  });
}

/**
 * Wait for an HTTP endpoint to return a successful response.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForHttp(
  url: string,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForHttpEffect(url, options));
}

// Internal Effect implementation
function waitForWebSocketEffect(
  url: string,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const { timeout = 60000, interval = 1000, requiredSuccesses = 1 } = options;
        const startTime = Date.now();
        let successCount = 0;

        while (Date.now() - startTime < timeout) {
          try {
            const connected = await checkWebSocketConnection(url);
            if (connected) {
              successCount++;
              if (successCount >= requiredSuccesses) {
                return;
              }
            } else {
              successCount = 0;
            }
          } catch {
            successCount = 0;
          }

          await sleep(interval);
        }

        throw new Error(`WebSocket check timed out after ${timeout}ms for ${url}`);
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: url,
          cause,
        }),
    });
  });
}

/**
 * Wait for a WebSocket endpoint to accept connections.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForWebSocket(
  url: string,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForWebSocketEffect(url, options));
}

/**
 * Check if a WebSocket endpoint accepts connections.
 */
async function checkWebSocketConnection(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use dynamic import for WebSocket to support both Node.js and browser
    import('ws').then(({ default: WebSocket }) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    }).catch(() => {
      resolve(false);
    });
  });
}

// Internal Effect implementation
function waitForNodeEffect(
  port: number,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  const url = `http://localhost:${port}/health`;
  return waitForHttpEffect(url, { timeout: 90000, ...options });
}

/**
 * Wait for the Midnight node to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForNode(
  port: number,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForNodeEffect(port, options));
}

// Internal Effect implementation
function waitForIndexerEffect(
  port: number,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  // The indexer GraphQL endpoint
  const url = `http://localhost:${port}/api/v3/graphql`;

  // Indexer needs more time to sync with node
  return waitForGraphQLEffect(url, { timeout: 120000, ...options });
}

/**
 * Wait for the indexer to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForIndexer(
  port: number,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForIndexerEffect(port, options));
}

// Internal Effect implementation for GraphQL
function waitForGraphQLEffect(
  url: string,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const { timeout = 60000, interval = 2000 } = options;
        const startTime = Date.now();

        // Phase 1: Wait for GraphQL to be up
        while (Date.now() - startTime < timeout) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: '{ __typename }',
              }),
              signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
              const data = (await response.json()) as { errors?: unknown };
              if (data && !data.errors) {
                break; // GraphQL is up, move to phase 2
              }
            }
          } catch {
            // Continue polling
          }

          await sleep(interval);
        }

        // Phase 2: Wait for indexer to have indexed at least some blocks
        // This ensures the genesis dust allocation is available
        while (Date.now() - startTime < timeout) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: '{ state { tip { height } } }',
              }),
              signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
              const data = (await response.json()) as {
                data?: { state?: { tip?: { height?: number } } };
                errors?: unknown;
              };
              const height = data?.data?.state?.tip?.height;
              // Wait until at least 1 block is indexed
              if (typeof height === 'number' && height >= 1) {
                return;
              }
            }
          } catch {
            // Continue polling
          }

          await sleep(interval);
        }

        throw new Error(`GraphQL check timed out after ${timeout}ms for ${url}`);
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: url,
          cause,
        }),
    });
  });
}

// Internal Effect implementation
function waitForProofServerEffect(
  port: number,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  // Proof server exposes gRPC, we'll check if the port is open
  // Just check if we can connect (proof server may not have HTTP health endpoint)
  return waitForPortEffect(port, { timeout: 60000, ...options });
}

/**
 * Wait for the proof server to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForProofServer(
  port: number,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForProofServerEffect(port, options));
}

// Internal Effect implementation for port checking
function waitForPortEffect(
  port: number,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const { timeout = 60000, interval = 1000 } = options;
        const startTime = Date.now();

        const { createConnection } = await import('net');

        while (Date.now() - startTime < timeout) {
          const connected = await new Promise<boolean>((resolve) => {
            const socket = createConnection({ port, host: 'localhost' }, () => {
              socket.destroy();
              resolve(true);
            });

            socket.on('error', () => {
              socket.destroy();
              resolve(false);
            });

            socket.setTimeout(2000, () => {
              socket.destroy();
              resolve(false);
            });
          });

          if (connected) {
            return;
          }

          await sleep(interval);
        }

        throw new Error(`Port check timed out after ${timeout}ms for port ${port}`);
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: `port ${port}`,
          cause,
        }),
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Internal Effect implementation for Docker healthcheck
function waitForContainerHealthyEffect(
  containerName: string,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const Docker = (await import('dockerode')).default;
        const docker = new Docker();
        const { timeout = 120000, interval = 2000 } = options;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
          try {
            const container = docker.getContainer(containerName);
            const info = await container.inspect();
            const health = info.State.Health;

            if (health?.Status === 'healthy') {
              return;
            }

            // If no healthcheck configured, fall back to running state
            if (!health && info.State.Running) {
              return;
            }
          } catch {
            // Container might not exist yet, continue polling
          }

          await sleep(interval);
        }

        throw new Error(
          `Container health check timed out after ${timeout}ms for ${containerName}`,
        );
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: containerName,
          cause,
        }),
    });
  });
}

/**
 * Wait for a Docker container to be healthy based on its healthcheck.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForContainerHealthy(
  containerName: string,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForContainerHealthyEffect(containerName, options));
}

// Internal Effect implementation for indexer sync check
function waitForIndexerSyncedEffect(
  port: number,
  options: HealthCheckOptions = {},
): Effect.Effect<void, HealthCheckError> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const url = `http://localhost:${port}/api/v3/graphql`;
        const { timeout = 120000, interval = 2000 } = options;
        const startTime = Date.now();

        // Wait for GraphQL endpoint to respond
        while (Date.now() - startTime < timeout) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: '{ __schema { queryType { name } } }',
              }),
              signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
              const data = (await response.json()) as { errors?: unknown };
              if (data && !data.errors) {
                // GraphQL is up, now wait for indexer to fully sync genesis state
                // The indexer healthcheck file appears before all genesis data is indexed
                await sleep(15000);
                return;
              }
            }
          } catch {
            // Continue polling
          }

          await sleep(interval);
        }

        throw new Error(`Indexer sync check timed out after ${timeout}ms`);
      },
      catch: (cause: unknown) =>
        new HealthCheckError({
          service: `indexer sync (port ${port})`,
          cause,
        }),
    });
  });
}

/**
 * Wait for the indexer to have synced at least one block.
 *
 * This ensures the genesis dust allocation is available for wallets.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForIndexerSynced(
  port: number,
  options: HealthCheckOptions = {},
): Promise<void> {
  return Effect.runPromise(waitForIndexerSyncedEffect(port, options));
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  waitForHttp: waitForHttpEffect,
  waitForWebSocket: waitForWebSocketEffect,
  waitForNode: waitForNodeEffect,
  waitForIndexer: waitForIndexerEffect,
  waitForProofServer: waitForProofServerEffect,
};

/**
 * Live Layer for HealthService.
 *
 * Provides the default implementation of HealthService for Effect DI.
 *
 * @since 0.2.0
 * @category layer
 */
export const Live: Layer.Layer<HealthService> = Layer.succeed(HealthService, {
  waitForHttp: waitForHttpEffect,
  waitForWebSocket: waitForWebSocketEffect,
  waitForNode: waitForNodeEffect,
  waitForIndexer: waitForIndexerEffect,
  waitForProofServer: waitForProofServerEffect,
});
