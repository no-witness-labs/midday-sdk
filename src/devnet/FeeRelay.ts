/**
 * Fee Relay server for browser clients on local DevNet.
 *
 * Runs an HTTP server backed by the genesis wallet that balances and submits
 * transactions on behalf of browser wallets that have no dust/tDUST.
 *
 * @since 0.2.0
 * @module
 */

import { createServer, type Server } from 'http';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { HDWallet, Roles, type WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import {
  createKeystore,
  PublicKey as UnshieldedPublicKey,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';

import { DEFAULT_TX_TTL_MS, type NetworkConfig } from '../Config.js';
import { hexToBytes, bytesToHex } from '../Utils.js';
import * as Images from './Images.js';

/**
 * Genesis wallet seed that is pre-funded in local devnet.
 * DO NOT use in production.
 */
const GENESIS_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// =============================================================================
// Wallet Setup (reused from Faucet pattern)
// =============================================================================

interface DerivedKeys {
  seeds: WalletSeeds;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}

function deriveKeys(seed: string, networkId: string): DerivedKeys {
  const seedBytes = hexToBytes(seed);
  const hdWallet = HDWallet.fromSeed(seedBytes);
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }
  hdWallet.hdWallet.clear();

  const seeds: WalletSeeds = {
    shielded: derivationResult.keys[Roles.Zswap],
    unshielded: derivationResult.keys[Roles.NightExternal],
    dust: derivationResult.keys[Roles.Dust],
  };
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, networkId as 'undeployed');

  return { seeds, unshieldedKeystore };
}

async function createWallet(keys: DerivedKeys, networkConfig: NetworkConfig): Promise<WalletFacade> {
  const configuration = {
    networkId: networkConfig.networkId as 'undeployed',
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    relayURL: new URL(networkConfig.node),
    provingServerUrl: new URL(networkConfig.proofServer),
    indexerClientConnection: {
      indexerHttpUrl: networkConfig.indexer,
      indexerWsUrl: networkConfig.indexerWS,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  };

  const wallet = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSeed(keys.seeds.shielded),
    unshielded: (config) =>
      UnshieldedWallet(config).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(keys.unshieldedKeystore)),
    dust: (config) => DustWallet(config).startWithSeed(keys.seeds.dust),
  });
  await wallet.start(keys.seeds);

  // Wait for sync
  await wallet.waitForSyncedState();

  return wallet;
}

// =============================================================================
// HTTP Server
// =============================================================================

/**
 * Options for the fee relay HTTP server.
 */
export interface ServerOptions {
  /** Port to listen on (default: 3002) */
  port?: number;
  /** Hex seed for the relay wallet (default: genesis wallet seed) */
  seed?: string;
  /** Transaction TTL in milliseconds (default: 30 minutes) */
  txTtlMs?: number;
}

/**
 * Start an HTTP fee relay server for browser clients.
 *
 * The server initializes the genesis wallet once on startup and keeps it alive
 * to balance and submit transactions on behalf of browser wallets.
 *
 * Endpoints:
 * - `POST /balance-tx` — accepts `{ tx: "<hex>" }` (UnboundTransaction), returns `{ tx: "<hex>" }` (FinalizedTransaction)
 * - `POST /balance-finalized-tx` — accepts `{ tx: "<hex>" }` (FinalizedTransaction), adds dust only, returns `{ tx: "<hex>" }`
 * - `POST /submit-tx` — accepts `{ tx: "<hex>" }`, returns `{ txId: "<hex>" }`
 * - `GET /health` — returns `{ status: "ok" }`
 *
 * @param networkConfig - Network configuration for the devnet
 * @param options - Server options
 * @returns HTTP server instance (call .close() to stop)
 *
 * @example
 * ```typescript
 * import { Cluster, FeeRelay } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * const relayServer = FeeRelay.startServer(cluster.networkConfig, { port: 3002 });
 * console.log('Fee relay running at http://localhost:3002');
 *
 * // Cleanup
 * relayServer.close();
 * await cluster.remove();
 * ```
 */
export function startServer(networkConfig: NetworkConfig, options: ServerOptions = {}): Server {
  const { port = 3002, seed = GENESIS_WALLET_SEED, txTtlMs = DEFAULT_TX_TTL_MS } = options;

  // Relay wallet — initialized lazily on first request, then kept alive
  let walletPromise: Promise<{ wallet: WalletFacade; keys: DerivedKeys }> | null = null;

  function getWallet(): Promise<{ wallet: WalletFacade; keys: DerivedKeys }> {
    if (!walletPromise) {
      walletPromise = (async () => {
        console.log('[fee-relay] Initializing relay wallet...');
        const keys = deriveKeys(seed, networkConfig.networkId);
        const wallet = await createWallet(keys, networkConfig);
        console.log('[fee-relay] Relay wallet synced and ready');
        return { wallet, keys };
      })();
    }
    return walletPromise;
  }

  const server = createServer(async (req, res) => {
    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Balance transaction
    if (req.method === 'POST' && req.url === '/balance-tx') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { tx: txHex } = JSON.parse(body);
          if (!txHex) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tx field (hex-encoded UnboundTransaction)' }));
            return;
          }

          const { wallet, keys } = await getWallet();

          // The facade runs its own ledger copy, so the transaction crosses as bytes.
          const unboundTx = wallet.adoptTransaction(hexToBytes(txHex), 'Unbound');

          // Balance and finalize using genesis wallet
          const ttl = new Date(Date.now() + txTtlMs);
          const recipe = await wallet.balanceUnboundTransaction(
            unboundTx,
            { ttl },
          );

          const signedRecipe = await wallet.signRecipe(recipe, keys.unshieldedKeystore.signDataAsync);

          const finalized = await wallet.finalizeRecipe(signedRecipe);

          // Serialize back to hex
          const finalizedBytes = finalized.serialize();
          const finalizedHex = bytesToHex(finalizedBytes);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tx: finalizedHex }));
        } catch (error) {
          console.error('[fee-relay] /balance-tx error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        }
      });
      return;
    }

    // Balance finalized transaction (split flow: add dust only)
    if (req.method === 'POST' && req.url === '/balance-finalized-tx') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { tx: txHex } = JSON.parse(body);
          if (!txHex) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tx field (hex-encoded FinalizedTransaction)' }));
            return;
          }

          const { wallet, keys } = await getWallet();

          // The facade runs its own ledger copy, so the transaction crosses as bytes.
          const finalizedTx = wallet.adoptTransaction(hexToBytes(txHex), 'Finalized');

          // Balance with dust only — relay covers fees, user already added value inputs
          const ttl = new Date(Date.now() + txTtlMs);
          const recipe = await wallet.balanceFinalizedTransaction(
            finalizedTx,
            { ttl, tokenKindsToBalance: ['dust'] },
          );

          const signedRecipe = await wallet.signRecipe(recipe, keys.unshieldedKeystore.signDataAsync);

          const finalized = await wallet.finalizeRecipe(signedRecipe);

          // Serialize back to hex
          const finalizedBytes = finalized.serialize();
          const finalizedHex = bytesToHex(finalizedBytes);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tx: finalizedHex }));
        } catch (error) {
          console.error('[fee-relay] /balance-finalized-tx error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        }
      });
      return;
    }

    // Submit transaction
    if (req.method === 'POST' && req.url === '/submit-tx') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { tx: txHex } = JSON.parse(body);
          if (!txHex) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tx field (hex-encoded FinalizedTransaction)' }));
            return;
          }

          const { wallet } = await getWallet();

          // The facade runs its own ledger copy, so the transaction crosses as bytes.
          const finalizedTx = wallet.adoptTransaction(hexToBytes(txHex), 'Finalized');

          // Submit via genesis wallet
          const txId = await wallet.submitTransaction(finalizedTx);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ txId }));
        } catch (error) {
          console.error('[fee-relay] /submit-tx error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port);
  return server;
}

// =============================================================================
// Docker
// =============================================================================

/**
 * Options for the fee relay Docker container.
 *
 * @since 0.2.0
 * @category model
 */
export interface DockerOptions {
  /** Port to expose (default: 3002) */
  port?: number;
  /** Docker image (default: `midday-fee-relay:<sdk version>`, built from this SDK on first use) */
  image?: string;
  /** Cluster name for network (default: midday-devnet) */
  clusterName?: string;
}

/**
 * Start a fee relay Docker container on the devnet network.
 *
 * Follows the same pattern as `Faucet.startDocker()` — creates a container
 * attached to the devnet Docker network so it can reach the node, indexer,
 * and proof server by container name.
 *
 * @param networkConfig - Network configuration for the devnet
 * @param options - Docker container options
 * @returns Container ID
 *
 * @example
 * ```typescript
 * import { Cluster, FeeRelay } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * const containerId = await FeeRelay.startDocker(cluster.networkConfig);
 * console.log('Fee relay running at http://localhost:3002');
 *
 * // Cleanup
 * await FeeRelay.stopDocker(containerId);
 * await cluster.remove();
 * ```
 */
export async function startDocker(
  networkConfig: NetworkConfig,
  options: DockerOptions = {},
): Promise<string> {
  const {
    port = 3002,
    image = Images.serverImage('fee-relay'),
    clusterName = 'midday-devnet',
  } = options;

  if (!(await Images.isAvailable(image))) Images.buildServerImage('fee-relay', image);

  const Docker = (await import('dockerode')).default;
  const docker = new Docker();
  const containerName = `${clusterName}-fee-relay`;
  const networkName = `${clusterName}-network`;

  // Remove existing container if any
  try {
    const existing = docker.getContainer(containerName);
    await existing.stop().catch(() => {});
    await existing.remove().catch(() => {});
  } catch {
    // Container doesn't exist
  }

  // Create and start container
  const container = await docker.createContainer({
    Image: image,
    name: containerName,
    ExposedPorts: { '3002/tcp': {} },
    HostConfig: {
      PortBindings: { '3002/tcp': [{ HostPort: String(port) }] },
      NetworkMode: networkName,
    },
    Env: [
      `NETWORK_ID=${networkConfig.networkId}`,
      `INDEXER_URL=http://${clusterName}-indexer:8088/api/v3/graphql`,
      `INDEXER_WS_URL=ws://${clusterName}-indexer:8088/api/v3/graphql/ws`,
      `NODE_URL=ws://${clusterName}-node:9944`,
      `PROOF_SERVER_URL=http://${clusterName}-proof-server:6300`,
      `FEE_RELAY_PORT=3002`,
    ],
  });

  await container.start();
  return container.id;
}

/**
 * Stop and remove a fee relay Docker container.
 *
 * @param containerId - Container ID returned by `startDocker()`
 */
export async function stopDocker(containerId: string): Promise<void> {
  const Docker = (await import('dockerode')).default;
  const docker = new Docker();
  const container = docker.getContainer(containerId);
  await container.stop().catch(() => {});
  await container.remove().catch(() => {});
}
