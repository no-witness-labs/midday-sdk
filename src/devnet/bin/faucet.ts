#!/usr/bin/env node
/**
 * Faucet container entrypoint: runs the SDK's in-process faucet server
 * (`Faucet.startServer`) so the Docker image and the in-process devnet share
 * one implementation and one dependency cohort.
 *
 * Environment (as passed by `Faucet.startDocker`):
 *   NETWORK_ID, INDEXER_URL, INDEXER_WS_URL, NODE_URL, PROOF_SERVER_URL,
 *   FAUCET_PORT (default 3001).
 */
import { networkConfigFromEnv, runServer } from './common.js';
import { startServer } from '../Faucet.js';

const port = Number(process.env.FAUCET_PORT ?? 3001);
runServer('faucet', port, () => startServer(networkConfigFromEnv(), { port }));
