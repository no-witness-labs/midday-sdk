/**
 * Wallet initialization and management for Midnight Network.
 *
 * Handles the three-layer wallet system: shielded, dust, and unshielded wallets.
 *
 * @since 0.1.0
 * @module
 */

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
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

import type { NetworkConfig } from './Config.js';

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}

export async function init(seed: string, networkConfig: NetworkConfig): Promise<WalletContext> {
  const seedBuffer = Buffer.from(seed, 'hex');

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

  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seedBuffer));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], configuration.networkId);

  const shieldedWallet = ShieldedWallet(configuration).startWithSecretKeys(shieldedSecretKeys);
  const dustWallet = DustWallet(configuration).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedWallet = UnshieldedWallet({
    ...configuration,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore));

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

export async function waitForSync(walletContext: WalletContext): Promise<void> {
  await Rx.firstValueFrom(walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
}

/**
 * Derive wallet address from seed without starting wallet connection.
 * Useful for displaying addresses or checking balances via indexer.
 */
export function deriveAddress(seed: string, networkId: string): string {
  const seedBuffer = Buffer.from(seed, 'hex');

  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seedBuffer));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.NightExternal])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();

  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], networkId as 'undeployed');
  return unshieldedKeystore.getBech32Address().asString();
}
