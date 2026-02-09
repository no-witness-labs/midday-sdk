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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  createKeystore,
  PublicKey as UnshieldedPublicKey,
  UnshieldedWallet,
  InMemoryTransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import { Transaction, type FinalizedTransaction } from '@midnight-ntwrk/ledger-v7';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';

import type { NetworkConfig } from '../Config.js';
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
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
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

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    networkId as 'undeployed',
  );

  return { shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
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
    indexerUrl: networkConfig.indexerWS,
  };

  const shieldedWallet = ShieldedWallet(configuration).startWithSecretKeys(keys.shieldedSecretKeys);
  const dustWallet = DustWallet(configuration).startWithSecretKey(
    keys.dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedWallet = UnshieldedWallet({
    ...configuration,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(keys.unshieldedKeystore));

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(keys.shieldedSecretKeys, keys.dustSecretKey);

  // Wait for sync
  await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

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
}

/**
 * Start an HTTP fee relay server for browser clients.
 *
 * The server initializes the genesis wallet once on startup and keeps it alive
 * to balance and submit transactions on behalf of browser wallets.
 *
 * Endpoints:
 * - `POST /balance-tx` — accepts `{ tx: "<hex>" }`, returns `{ tx: "<hex>" }`
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
  const { port = 3002 } = options;

  // Genesis wallet — initialized lazily on first request, then kept alive
  let walletPromise: Promise<{ wallet: WalletFacade; keys: DerivedKeys }> | null = null;

  function getWallet(): Promise<{ wallet: WalletFacade; keys: DerivedKeys }> {
    if (!walletPromise) {
      walletPromise = (async () => {
        const keys = deriveKeys(GENESIS_WALLET_SEED, networkConfig.networkId);
        const wallet = await createWallet(keys, networkConfig);
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

          // Deserialize UnboundTransaction from hex
          // UnboundTransaction = Transaction<SignatureEnabled, Proof, PreBinding>
          const txBytes = hexToBytes(txHex);
          const unboundTx = Transaction.deserialize(
            'signature' as ledger.SignatureEnabled['instance'],
            'proof' as ledger.Proof['instance'],
            'pre-binding' as ledger.PreBinding['instance'],
            txBytes,
          ) as unknown as UnboundTransaction;

          // Balance and finalize using genesis wallet
          const ttl = new Date(Date.now() + 30 * 60 * 1000);
          const recipe = await wallet.balanceUnboundTransaction(
            unboundTx,
            {
              shieldedSecretKeys: keys.shieldedSecretKeys,
              dustSecretKey: keys.dustSecretKey,
            },
            { ttl },
          );
          const finalized = await wallet.finalizeRecipe(recipe);

          // Serialize back to hex
          const finalizedBytes = finalized.serialize();
          const finalizedHex = bytesToHex(finalizedBytes);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tx: finalizedHex }));
        } catch (error) {
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

          // Deserialize FinalizedTransaction from hex
          // FinalizedTransaction = Transaction<SignatureEnabled, Proof, Binding>
          const txBytes = hexToBytes(txHex);
          const finalizedTx = Transaction.deserialize(
            'signature' as ledger.SignatureEnabled['instance'],
            'proof' as ledger.Proof['instance'],
            'binding' as ledger.Binding['instance'],
            txBytes,
          ) as unknown as FinalizedTransaction;

          // Submit via genesis wallet
          const txId = await wallet.submitTransaction(finalizedTx);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ txId }));
        } catch (error) {
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
  /** Docker image (default: midday-fee-relay:latest) */
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
    image = 'midday-fee-relay:latest',
    clusterName = 'midday-devnet',
  } = options;

  // Auto-build image if not available
  const available = await Images.isAvailable(image);
  if (!available) {
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    Images.build(image, resolve(sdkRoot, 'docker/fee-relay'));
  }

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
