#!/usr/bin/env node
/**
 * Fee relay container entrypoint: runs the SDK's in-process relay server
 * (`FeeRelay.startServer`) so the Docker image and the in-process devnet share
 * one implementation and one dependency cohort.
 *
 * Environment (as passed by `FeeRelay.startDocker`):
 *   NETWORK_ID, INDEXER_URL, INDEXER_WS_URL, NODE_URL, PROOF_SERVER_URL,
 *   FEE_RELAY_PORT (default 3002), FEE_RELAY_SEED (default: genesis wallet).
 */
import { networkConfigFromEnv, runServer } from './common.js';
import { startServer } from '../FeeRelay.js';

const port = Number(process.env.FEE_RELAY_PORT ?? 3002);
runServer('fee-relay', port, () =>
  startServer(networkConfigFromEnv(), { port, ...(process.env.FEE_RELAY_SEED ? { seed: process.env.FEE_RELAY_SEED } : {}) }),
);
