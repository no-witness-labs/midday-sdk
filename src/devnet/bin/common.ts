import type { Server } from 'http';
import type { NetworkConfig } from '../../Config.js';

/** Network endpoints from the container environment; every variable is required. */
export function networkConfigFromEnv(): NetworkConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  return {
    networkId: required('NETWORK_ID'),
    indexer: required('INDEXER_URL'),
    indexerWS: required('INDEXER_WS_URL'),
    node: required('NODE_URL'),
    proofServer: required('PROOF_SERVER_URL'),
  };
}

/** Starts the server, logs, and closes it on SIGTERM/SIGINT so `docker stop` is clean. */
export function runServer(name: string, port: number, start: () => Server): void {
  let server: Server;
  try {
    server = start();
  } catch (error) {
    console.error(`[${name}] failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`[${name}] listening on :${port}`);
  const shutdown = (signal: string): void => {
    console.log(`[${name}] ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
