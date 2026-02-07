/**
 * Faucet for funding wallets on local DevNet.
 *
 * Uses the genesis wallet to transfer tokens to target wallets.
 * The genesis wallet (seed 0x...01) is pre-funded in the local devnet genesis.
 *
 * @since 0.2.0
 * @module
 */

import { Effect } from 'effect';
import { createServer, type Server } from 'http';
import * as Rx from 'rxjs';
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
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

import type { NetworkConfig } from '../Config.js';
import { hexToBytes } from '../utils/hex.js';
import { FaucetError } from './errors.js';

/**
 * Genesis wallet seed that is pre-funded in local devnet.
 * DO NOT use in production.
 */
const GENESIS_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Default amount to fund (in smallest unit).
 * 31,337,000,000 = ~31.337 tokens
 */
const DEFAULT_FUND_AMOUNT = 31_337_000_000n;

/**
 * Options for funding a wallet.
 */
export interface FundOptions {
  /** Amount to fund (default: 31_337_000_000n) */
  amount?: bigint;
}

/**
 * Result of funding operation.
 */
export interface FundResult {
  /** Transaction ID */
  txId: string;
  /** Amount funded */
  amount: bigint;
}

interface DerivedKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}

/**
 * Derive wallet keys from a seed.
 */
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

/**
 * Create and start a wallet facade.
 */
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

/**
 * Fund a shielded address from the genesis wallet.
 *
 * @param networkConfig - Network configuration
 * @param shieldedAddress - Target shielded address (mn_shield-addr_undeployed1...)
 * @param options - Funding options
 * @returns Fund result with transaction ID
 *
 * @example
 * ```typescript
 * import { Faucet } from '@no-witness-labs/midday-sdk/devnet';
 *
 * // Fund a shielded address
 * const result = await Faucet.fundShielded(
 *   cluster.networkConfig,
 *   'mn_shield-addr_undeployed1...'
 * );
 * console.log(`Funded with tx: ${result.txId}`);
 * ```
 */
export async function fundShielded(
  networkConfig: NetworkConfig,
  shieldedAddress: string,
  options: FundOptions = {},
): Promise<FundResult> {
  const { amount = DEFAULT_FUND_AMOUNT } = options;

  // Initialize genesis wallet
  const genesisKeys = deriveKeys(GENESIS_WALLET_SEED, networkConfig.networkId);
  const genesisWallet = await createWallet(genesisKeys, networkConfig);

  try {
    // Create transfer transaction
    const ttl = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL
    const recipe = await genesisWallet.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: ledger.nativeToken().raw,
              receiverAddress: shieldedAddress,
              amount,
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: genesisKeys.shieldedSecretKeys,
        dustSecretKey: genesisKeys.dustSecretKey,
      },
      { ttl, payFees: true },
    );

    // Sign the transaction
    const signedRecipe = await genesisWallet.signRecipe(recipe, (payload: Uint8Array) =>
      genesisKeys.unshieldedKeystore.signData(payload),
    );

    // Finalize and submit
    const finalized = await genesisWallet.finalizeRecipe(signedRecipe);
    const txId = await genesisWallet.submitTransaction(finalized);

    return { txId, amount };
  } finally {
    await genesisWallet.stop();
  }
}

/**
 * Fund an unshielded address from the genesis wallet.
 *
 * @param networkConfig - Network configuration
 * @param unshieldedAddress - Target unshielded address (mn_addr_undeployed1...)
 * @param options - Funding options
 * @returns Fund result with transaction ID
 *
 * @example
 * ```typescript
 * import { Faucet } from '@no-witness-labs/midday-sdk/devnet';
 *
 * // Fund an unshielded address
 * const result = await Faucet.fundUnshielded(
 *   cluster.networkConfig,
 *   'mn_addr_undeployed1...'
 * );
 * console.log(`Funded with tx: ${result.txId}`);
 * ```
 */
export async function fundUnshielded(
  networkConfig: NetworkConfig,
  unshieldedAddress: string,
  options: FundOptions = {},
): Promise<FundResult> {
  const { amount = DEFAULT_FUND_AMOUNT } = options;

  // Initialize genesis wallet
  const genesisKeys = deriveKeys(GENESIS_WALLET_SEED, networkConfig.networkId);
  const genesisWallet = await createWallet(genesisKeys, networkConfig);

  try {
    // Create transfer transaction
    const ttl = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL
    const recipe = await genesisWallet.transferTransaction(
      [
        {
          type: 'unshielded',
          outputs: [
            {
              type: ledger.nativeToken().raw,
              receiverAddress: unshieldedAddress,
              amount,
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: genesisKeys.shieldedSecretKeys,
        dustSecretKey: genesisKeys.dustSecretKey,
      },
      { ttl, payFees: true },
    );

    // Sign the transaction
    const signedRecipe = await genesisWallet.signRecipe(recipe, (payload: Uint8Array) =>
      genesisKeys.unshieldedKeystore.signData(payload),
    );

    // Finalize and submit
    const finalized = await genesisWallet.finalizeRecipe(signedRecipe);
    const txId = await genesisWallet.submitTransaction(finalized);

    return { txId, amount };
  } finally {
    await genesisWallet.stop();
  }
}

// =============================================================================
// Effect API
// =============================================================================

function fundShieldedEffect(
  networkConfig: NetworkConfig,
  shieldedAddress: string,
  options: FundOptions = {},
): Effect.Effect<FundResult, FaucetError> {
  return Effect.tryPromise({
    try: () => fundShielded(networkConfig, shieldedAddress, options),
    catch: (cause) =>
      new FaucetError({
        cause,
        message: `Failed to fund shielded address: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function fundUnshieldedEffect(
  networkConfig: NetworkConfig,
  unshieldedAddress: string,
  options: FundOptions = {},
): Effect.Effect<FundResult, FaucetError> {
  return Effect.tryPromise({
    try: () => fundUnshielded(networkConfig, unshieldedAddress, options),
    catch: (cause) =>
      new FaucetError({
        cause,
        message: `Failed to fund unshielded address: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  fundShielded: fundShieldedEffect,
  fundUnshielded: fundUnshieldedEffect,
};

// =============================================================================
// Docker Container
// =============================================================================

/**
 * Options for the faucet Docker container.
 */
export interface DockerOptions {
  /** Port to expose (default: 3001) */
  port?: number;
  /** Docker image (default: midday-faucet:latest) */
  image?: string;
  /** Cluster name for network (default: midday-devnet) */
  clusterName?: string;
}

/**
 * Start the faucet as a Docker container.
 *
 * Requires the midday-faucet Docker image to be built first:
 * ```bash
 * cd docker/faucet && ./build.sh
 * ```
 *
 * @param networkConfig - Network configuration
 * @param options - Docker options
 * @returns Container ID
 *
 * @example
 * ```typescript
 * import { Cluster, Faucet } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * // Start faucet in Docker
 * const containerId = await Faucet.startDocker(cluster.networkConfig);
 * console.log('Faucet running at http://localhost:3001/faucet');
 *
 * // Cleanup
 * await Faucet.stopDocker(containerId);
 * await cluster.remove();
 * ```
 */
export async function startDocker(
  networkConfig: NetworkConfig,
  options: DockerOptions = {},
): Promise<string> {
  const {
    port = 3001,
    image = 'midday-faucet:latest',
    clusterName = 'midday-devnet',
  } = options;

  const Docker = (await import('dockerode')).default;
  const docker = new Docker();
  const containerName = `${clusterName}-faucet`;
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
    ExposedPorts: { '3001/tcp': {} },
    HostConfig: {
      PortBindings: { '3001/tcp': [{ HostPort: String(port) }] },
      NetworkMode: networkName,
    },
    Env: [
      `NETWORK_ID=${networkConfig.networkId}`,
      `INDEXER_URL=http://${clusterName}-indexer:8088/api/v3/graphql`,
      `INDEXER_WS_URL=ws://${clusterName}-indexer:8088/api/v3/graphql/ws`,
      `NODE_URL=ws://${clusterName}-node:9944`,
      `PROOF_SERVER_URL=http://${clusterName}-proof-server:6300`,
      `FAUCET_PORT=3001`,
    ],
  });

  await container.start();
  return container.id;
}

/**
 * Stop and remove the faucet Docker container.
 */
export async function stopDocker(containerId: string): Promise<void> {
  const Docker = (await import('dockerode')).default;
  const docker = new Docker();
  const container = docker.getContainer(containerId);
  await container.stop().catch(() => {});
  await container.remove().catch(() => {});
}

// =============================================================================
// HTTP Server (Node.js process)
// =============================================================================

/**
 * Options for the faucet HTTP server.
 */
export interface ServerOptions {
  /** Port to listen on (default: 3001) */
  port?: number;
}

/**
 * Start an HTTP faucet server for browser apps.
 *
 * The server accepts POST requests to /faucet with JSON body:
 * { "coinPublicKey": "...", "encryptionPublicKey": "..." }
 *
 * @param networkConfig - Network configuration for the devnet
 * @param options - Server options
 * @returns HTTP server instance (call .close() to stop)
 *
 * @example
 * ```typescript
 * import { Cluster, Faucet } from '@no-witness-labs/midday-sdk/devnet';
 *
 * const cluster = await Cluster.make();
 * await cluster.start();
 *
 * // Start faucet server for browser apps
 * const faucetServer = Faucet.startServer(cluster.networkConfig);
 * console.log('Faucet running at http://localhost:3001/faucet');
 *
 * // Cleanup
 * faucetServer.close();
 * await cluster.remove();
 * ```
 */
export function startServer(networkConfig: NetworkConfig, options: ServerOptions = {}): Server {
  const { port = 3001 } = options;

  const server = createServer(async (req, res) => {
    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/faucet') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { coinPublicKey, encryptionPublicKey } = JSON.parse(body);
          if (!coinPublicKey || !encryptionPublicKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing coinPublicKey or encryptionPublicKey' }));
            return;
          }

          // Convert hex keys to bech32m address
          const coinKey = ShieldedCoinPublicKey.fromHexString(coinPublicKey);
          const encKey = ShieldedEncryptionPublicKey.fromHexString(encryptionPublicKey);
          const shieldedAddr = new ShieldedAddress(coinKey, encKey);
          const address = MidnightBech32m.encode(networkConfig.networkId, shieldedAddr).asString();

          const result = await fundShielded(networkConfig, address);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ txId: result.txId, amount: result.amount.toString() }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port);
  return server;
}
