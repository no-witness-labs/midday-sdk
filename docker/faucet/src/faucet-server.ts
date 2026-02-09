/**
 * Standalone Faucet Server for Docker.
 *
 * Environment variables:
 *   NETWORK_ID - Network ID (default: undeployed)
 *   INDEXER_URL - Indexer HTTP URL
 *   INDEXER_WS_URL - Indexer WebSocket URL
 *   NODE_URL - Node WebSocket URL
 *   PROOF_SERVER_URL - Proof server URL
 *   FAUCET_PORT - Port to listen on (default: 3001)
 */
import { createServer } from 'http';
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

// Configuration from environment
const config = {
  networkId: process.env.NETWORK_ID || 'undeployed',
  indexer: process.env.INDEXER_URL || 'http://indexer:8088/api/v3/graphql',
  indexerWS: process.env.INDEXER_WS_URL || 'ws://indexer:8088/api/v3/graphql/ws',
  node: process.env.NODE_URL || 'ws://node:9944',
  proofServer: process.env.PROOF_SERVER_URL || 'http://proof-server:6300',
  port: parseInt(process.env.FAUCET_PORT || '3001', 10),
};

// Genesis wallet seed (pre-funded in devnet)
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const DEFAULT_AMOUNT = 31_337_000_000n;

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

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

async function createWallet(keys: DerivedKeys): Promise<WalletFacade> {
  const walletConfig = {
    networkId: config.networkId as 'undeployed',
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    relayURL: new URL(config.node),
    provingServerUrl: new URL(config.proofServer),
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    indexerUrl: config.indexerWS,
  };

  const shieldedWallet = ShieldedWallet(walletConfig).startWithSecretKeys(keys.shieldedSecretKeys);
  const dustWallet = DustWallet(walletConfig).startWithSecretKey(
    keys.dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedWallet = UnshieldedWallet({
    ...walletConfig,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(keys.unshieldedKeystore));

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(keys.shieldedSecretKeys, keys.dustSecretKey);

  // Wait for sync
  await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  return wallet;
}

async function fundShielded(address: string, amount: bigint = DEFAULT_AMOUNT): Promise<string> {
  const genesisKeys = deriveKeys(GENESIS_SEED, config.networkId);
  const wallet = await createWallet(genesisKeys);

  try {
    const ttl = new Date(Date.now() + 5 * 60 * 1000);
    const recipe = await wallet.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: ledger.nativeToken().raw,
              receiverAddress: address,
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

    const signedRecipe = await wallet.signRecipe(recipe, (payload: Uint8Array) =>
      genesisKeys.unshieldedKeystore.signData(payload),
    );

    const finalized = await wallet.finalizeRecipe(signedRecipe);
    const txId = await wallet.submitTransaction(finalized);

    return txId;
  } finally {
    await wallet.stop();
  }
}

// HTTP Server
const server = createServer(async (req, res) => {
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
        const address = MidnightBech32m.encode(config.networkId, shieldedAddr).asString();

        console.log(`[Faucet] Funding ${address.slice(0, 40)}...`);
        const txId = await fundShielded(address);
        console.log(`[Faucet] Funded! TX: ${txId.slice(0, 16)}...`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ txId, amount: DEFAULT_AMOUNT.toString() }));
      } catch (error) {
        console.error('[Faucet] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[Faucet] Server running on port ${config.port}`);
  console.log(`[Faucet] Network: ${config.networkId}`);
  console.log(`[Faucet] POST /faucet - Fund a shielded address`);
  console.log(`[Faucet] GET /health - Health check`);
});
