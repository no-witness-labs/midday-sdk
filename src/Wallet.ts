/**
 * Wallet initialization and management for Midnight Network.
 *
 * Handles the three-layer wallet system: shielded, dust, and unshielded wallets.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.1.0
 * @module
 */

import { Effect } from 'effect';
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
import { WalletError } from './errors/index.js';
import { hexToBytes } from './utils/hex.js';
import { runEffect, runEffectPromise } from './utils/effect-runtime.js';

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}

/**
 * Effect-based interface for wallet operations.
 */
export interface WalletEffect {
  readonly init: (seed: string, networkConfig: NetworkConfig) => Effect.Effect<WalletContext, WalletError>;
  readonly waitForSync: (walletContext: WalletContext) => Effect.Effect<void, WalletError>;
  readonly deriveAddress: (seed: string, networkId: string) => Effect.Effect<string, WalletError>;
}

// =============================================================================
// Effect API
// =============================================================================

function initEffect(seed: string, networkConfig: NetworkConfig): Effect.Effect<WalletContext, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const seedBytes = hexToBytes(seed);

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

      const hdWallet = HDWallet.fromSeed(seedBytes);
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
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to initialize wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function waitForSyncEffect(walletContext: WalletContext): Effect.Effect<void, WalletError> {
  return Effect.tryPromise({
    try: () => Rx.firstValueFrom(walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced))),
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to sync wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  }).pipe(Effect.asVoid);
}

function deriveAddressEffect(seed: string, networkId: string): Effect.Effect<string, WalletError> {
  return Effect.try({
    try: () => {
      const seedBytes = hexToBytes(seed);

      const hdWallet = HDWallet.fromSeed(seedBytes);
      if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet');

      const derivationResult = hdWallet.hdWallet
        .selectAccount(0)
        .selectRoles([Roles.NightExternal])
        .deriveKeysAt(0);

      if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
      hdWallet.hdWallet.clear();

      const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], networkId as 'undeployed');
      return unshieldedKeystore.getBech32Address().asString();
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to derive address: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Effect-based API for wallet operations.
 */
export const WalletEffectAPI: WalletEffect = {
  init: initEffect,
  waitForSync: waitForSyncEffect,
  deriveAddress: deriveAddressEffect,
};

// =============================================================================
// Promise API (backwards compatible)
// =============================================================================

/**
 * Initialize wallet from seed.
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * const walletContext = yield* Midday.Wallet.Effect.init(seed, networkConfig);
 *
 * // Promise-based usage
 * const walletContext = await Midday.Wallet.init(seed, networkConfig);
 * ```
 */
export async function init(seed: string, networkConfig: NetworkConfig): Promise<WalletContext> {
  return runEffectPromise(initEffect(seed, networkConfig));
}

/**
 * Wait for wallet to sync with the network.
 */
export async function waitForSync(walletContext: WalletContext): Promise<void> {
  return runEffectPromise(waitForSyncEffect(walletContext));
}

/**
 * Derive wallet address from seed without starting wallet connection.
 * Useful for displaying addresses or checking balances via indexer.
 */
export function deriveAddress(seed: string, networkId: string): string {
  return runEffect(deriveAddressEffect(seed, networkId));
}

/**
 * Effect-based API export.
 */
export { WalletEffectAPI as Effect };
