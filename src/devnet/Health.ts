/**
 * Health check utilities for DevNet containers.
 *
 * @since 0.2.0
 * @module
 */

/**
 * Error thrown when health checks fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class HealthError extends Error {
  readonly reason: string;
  override readonly cause?: unknown;

  constructor(options: { reason: string; message: string; cause?: unknown }) {
    super(options.message);
    this.name = 'HealthError';
    this.reason = options.reason;
    this.cause = options.cause;
  }
}

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
 * Wait for an HTTP endpoint to return a successful response.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForHttp(
  url: string,
  options: HealthCheckOptions = {}
): Promise<void> {
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

  throw new HealthError({
    reason: 'health_check_timeout',
    message: `Health check timed out after ${timeout}ms for ${url}`,
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
  options: HealthCheckOptions = {}
): Promise<void> {
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

  throw new HealthError({
    reason: 'websocket_check_timeout',
    message: `WebSocket check timed out after ${timeout}ms for ${url}`,
  });
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

/**
 * Wait for the Midnight node to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForNode(
  port: number,
  options: HealthCheckOptions = {}
): Promise<void> {
  const url = `http://localhost:${port}/health`;
  await waitForHttp(url, { timeout: 90000, ...options });
}

/**
 * Wait for the indexer to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForIndexer(
  port: number,
  options: HealthCheckOptions = {}
): Promise<void> {
  // The indexer GraphQL endpoint
  const url = `http://localhost:${port}/api/v3/graphql`;

  // Indexer needs more time to sync with node
  await waitForGraphQL(url, { timeout: 120000, ...options });
}

/**
 * Wait for a GraphQL endpoint to respond to introspection.
 */
async function waitForGraphQL(
  url: string,
  options: HealthCheckOptions = {}
): Promise<void> {
  const { timeout = 60000, interval = 2000 } = options;
  const startTime = Date.now();

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
          return;
        }
      }
    } catch {
      // Continue polling
    }

    await sleep(interval);
  }

  throw new HealthError({
    reason: 'graphql_check_timeout',
    message: `GraphQL check timed out after ${timeout}ms for ${url}`,
  });
}

/**
 * Wait for the proof server to be ready.
 *
 * @since 0.2.0
 * @category health
 */
export async function waitForProofServer(
  port: number,
  options: HealthCheckOptions = {}
): Promise<void> {
  // Proof server exposes gRPC, we'll check if the port is open
  // Just check if we can connect (proof server may not have HTTP health endpoint)
  await waitForPort(port, { timeout: 60000, ...options });
}

/**
 * Wait for a TCP port to accept connections.
 */
async function waitForPort(
  port: number,
  options: HealthCheckOptions = {}
): Promise<void> {
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

  throw new HealthError({
    reason: 'port_check_timeout',
    message: `Port check timed out after ${timeout}ms for port ${port}`,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
