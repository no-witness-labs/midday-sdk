/**
 * Wallet initialization and management for Midnight Network.
 *
 * Combines seed-based wallet (server/CLI) and browser wallet (Lace extension)
 * into a single module. Both share WalletError and the same domain.
 *
 * **Seed Wallet** (server-side):
 * - `Wallet.init(seed, config)` — initialize from HD seed
 * - `Wallet.waitForSync(ctx)` — wait for wallet to sync
 * - `Wallet.deriveAddress(seed, networkId)` — derive address without connecting
 * - `Wallet.close(ctx)` — release resources
 *
 * **Browser Wallet** (Lace extension):
 * - `Wallet.connectWallet(networkId)` — connect to Lace browser extension
 * - `Wallet.isWalletAvailable()` — check if extension is installed
 * - `Wallet.disconnectWallet()` — disconnect from wallet
 * - `Wallet.createWalletProviders(wallet, addresses)` — create tx providers
 *
 * @since 0.3.0
 * @module
 */

import { Context, Data, Effect, Layer } from 'effect';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Transaction, type FinalizedTransaction, type TransactionId } from '@midnight-ntwrk/ledger-v7';
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
import type { WalletProvider, MidnightProvider, UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import type { NetworkConfig } from './Config.js';
import { hexToBytes, bytesToHex } from './Utils.js';
import { runEffect, runEffectPromise } from './Runtime.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error during wallet operations (initialization, sync, connection, transactions).
 *
 * @since 0.3.0
 * @category errors
 */
export class WalletError extends Data.TaggedError('WalletError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

// =============================================================================
// Types — Seed Wallet
// =============================================================================

/**
 * Wallet context containing all wallet components.
 *
 * @since 0.2.0
 * @category model
 */
export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
}

// =============================================================================
// Types — Browser Wallet (Lace Connector)
// =============================================================================

/**
 * Key material provider for proving.
 *
 * @since 0.2.0
 * @category model
 */
export interface KeyMaterialProvider {
  getZKIR(circuitKeyLocation: string): Promise<Uint8Array>;
  getProverKey(circuitKeyLocation: string): Promise<Uint8Array>;
  getVerifierKey(circuitKeyLocation: string): Promise<Uint8Array>;
}

/**
 * Proving provider from wallet.
 *
 * @since 0.2.0
 * @category model
 */
export interface ProvingProvider {
  check(serializedPreimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(serializedPreimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>;
}

/**
 * Network configuration from wallet.
 *
 * @since 0.2.0
 * @category model
 */
export interface Configuration {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  substrateNodeUri: string;
  networkId: string;
}

/**
 * Initial API for wallet connection.
 *
 * @since 0.2.0
 * @category model
 */
export interface InitialAPI {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  connect: (networkId: string) => Promise<ConnectedAPI>;
}

/**
 * Connected wallet API.
 *
 * @since 0.2.0
 * @category model
 */
export interface ConnectedAPI {
  getShieldedBalances(): Promise<Record<string, bigint>>;
  getUnshieldedBalances(): Promise<Record<string, bigint>>;
  getDustBalance(): Promise<{ cap: bigint; balance: bigint }>;
  getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getDustAddress(): Promise<{ dustAddress: string }>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  balanceSealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<string>;
  getProvingProvider(keyMaterialProvider: KeyMaterialProvider): Promise<ProvingProvider>;
  getConfiguration(): Promise<Configuration>;
  hintUsage(methodNames: string[]): Promise<void>;
}

declare global {
  interface Window {
    midnight?: {
      mnLace?: InitialAPI;
      [key: string]: InitialAPI | undefined;
    };
  }
}

/**
 * Shielded addresses returned by wallet.
 *
 * @since 0.2.0
 * @category model
 */
export interface ShieldedAddresses {
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

/**
 * Result of connecting to a browser wallet.
 *
 * @since 0.2.0
 * @category model
 */
export interface WalletConnection {
  wallet: ConnectedAPI;
  config: Configuration;
  addresses: ShieldedAddresses;
  coinPublicKey: string;
  encryptionPublicKey: string;
}

/**
 * Wallet keys needed for provider creation.
 *
 * @since 0.2.0
 * @category model
 */
export interface WalletKeys {
  coinPublicKey: string;
  encryptionPublicKey: string;
}

/**
 * Providers created from wallet connection.
 *
 * @since 0.2.0
 * @category model
 */
export interface WalletProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
}

// =============================================================================
// Types — Unified Wallet
// =============================================================================

/**
 * Dust token balance with cap information.
 *
 * @since 0.11.0
 * @category model
 */
export interface DustBalance {
  /** Current dust balance */
  readonly balance: bigint;
  /** Maximum dust cap */
  readonly cap: bigint;
}

/**
 * Wallet balance across all account types.
 *
 * @since 0.7.0
 * @category model
 */
export interface WalletBalance {
  /** Shielded (private) balances by token type */
  readonly shielded: Record<string, bigint>;
  /** Unshielded (public) balances by token type */
  readonly unshielded: Record<string, bigint>;
  /** Dust balance and cap */
  readonly dust: DustBalance;
}

/**
 * A connected wallet that can sign, balance, and submit transactions.
 *
 * Created via `Wallet.fromSeed()` (server/CLI) or `Wallet.fromBrowser()` (Lace extension).
 * Both sources produce the same interface — the source is just how you got the wallet.
 *
 * @example
 * ```typescript
 * // From seed (server/CLI)
 * const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);
 *
 * // From browser extension
 * const wallet = await Midday.Wallet.fromBrowser('testnet');
 *
 * // Same interface regardless of source
 * console.log(wallet.address);            // shielded address
 * console.log(wallet.coinPublicKey);      // ZK coin public key
 * console.log(wallet.encryptionPublicKey); // encryption public key
 * const balance = await wallet.getBalance();
 * const { walletProvider, midnightProvider } = wallet.providers();
 * await wallet.close();
 * ```
 *
 * @since 0.7.0
 * @category model
 */
export interface ConnectedWallet {
  /** Discriminator for `MidnightWallet` union */
  readonly type: 'connected';
  /** How this wallet was created */
  readonly source: 'seed' | 'browser';
  /** Primary wallet address */
  readonly address: string;
  /** ZK coin public key (for receiving shielded transfers) */
  readonly coinPublicKey: string;
  /** Encryption public key (for encrypted communication) */
  readonly encryptionPublicKey: string;

  /** Get current wallet balance across all account types. */
  getBalance(): Promise<WalletBalance>;
  /** Get WalletProvider and MidnightProvider for contract operations. */
  providers(): WalletProviders;
  /** Close wallet and release resources. */
  close(): Promise<void>;
  /** Support `await using wallet = await Wallet.fromSeed(...)` */
  [Symbol.asyncDispose](): Promise<void>;

  /** Effect versions of wallet operations. */
  readonly effect: {
    getBalance(): Effect.Effect<WalletBalance, WalletError>;
    providers(): Effect.Effect<WalletProviders, WalletError>;
    close(): Effect.Effect<void, WalletError>;
  };
}

/**
 * A read-only wallet — address only, no signing capability.
 *
 * Created via `Wallet.fromAddress()`. Useful for querying contract state
 * or deriving addresses without needing private keys.
 *
 * @since 0.7.0
 * @category model
 */
export interface ReadonlyWallet {
  /** Discriminator for `MidnightWallet` union */
  readonly type: 'readonly';
  /** How this wallet was created */
  readonly source: 'address';
  /** Wallet address */
  readonly address: string;
}

/**
 * Union type for any wallet (connected or read-only).
 *
 * Use `wallet.type` to discriminate:
 * ```typescript
 * if (wallet.type === 'connected') {
 *   const balance = await wallet.getBalance();
 * }
 * ```
 *
 * @since 0.7.0
 * @category model
 */
export type MidnightWallet = ConnectedWallet | ReadonlyWallet;

/**
 * Options for creating a wallet from seed.
 *
 * @since 0.7.0
 * @category model
 */
export interface FromSeedOptions {
  /** Whether to wait for wallet sync before returning (default: true) */
  sync?: boolean;
}

// =============================================================================
// Internal Effects — Seed Wallet
// =============================================================================

/**
 * Create WalletProvider and MidnightProvider from a seed wallet context.
 *
 * This is the seed-wallet counterpart to `createWalletProviders` (browser wallet).
 * Enables standalone usage without Client.
 *
 * @internal Effect source of truth
 */
function providersEffect(walletContext: WalletContext): Effect.Effect<WalletProviders, WalletError> {
  return Effect.try({
    try: () => {
      const walletProvider: WalletProvider = {
        getCoinPublicKey: () =>
          walletContext.shieldedSecretKeys.coinPublicKey as unknown as ledger.CoinPublicKey,
        getEncryptionPublicKey: () =>
          walletContext.shieldedSecretKeys.encryptionPublicKey as unknown as ledger.EncPublicKey,
        balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<ledger.FinalizedTransaction> => {
          const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
          const recipe = await walletContext.wallet.balanceUnboundTransaction(
            tx,
            {
              shieldedSecretKeys: walletContext.shieldedSecretKeys,
              dustSecretKey: walletContext.dustSecretKey,
            },
            { ttl: txTtl },
          );
          return walletContext.wallet.finalizeRecipe(recipe);
        },
      };

      const midnightProvider: MidnightProvider = {
        submitTx: async (tx: ledger.FinalizedTransaction) => walletContext.wallet.submitTransaction(tx),
      };

      return { walletProvider, midnightProvider };
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to create wallet providers: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function closeEffect(walletContext: WalletContext): Effect.Effect<void, WalletError> {
  return Effect.tryPromise({
    try: () => walletContext.wallet.stop(),
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to stop wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

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

// =============================================================================
// Internal Effects — Browser Wallet Connector
// =============================================================================

function isAvailableEffect(): Effect.Effect<boolean, never> {
  return Effect.sync(() => typeof window !== 'undefined' && !!window.midnight?.mnLace);
}

function waitForWalletEffect(timeout: number = 5000): Effect.Effect<InitialAPI, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const start = Date.now();

      while (Date.now() - start < timeout) {
        if (window.midnight?.mnLace) {
          return window.midnight.mnLace;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error('Lace wallet not found. Please install the Lace browser extension.');
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Wallet not available: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function isVersionCompatible(version: string, required: string): boolean {
  const [major] = version.split('.').map(Number);
  const [requiredMajor] = required.split('.').map(Number);
  return major >= requiredMajor;
}

function connectEffect(networkId: string = 'testnet'): Effect.Effect<WalletConnection, WalletError> {
  return Effect.gen(function* () {
    if (typeof window === 'undefined') {
      return yield* Effect.fail(
        new WalletError({
          cause: new Error('Browser environment required'),
          message: 'connectWallet() can only be used in browser environment',
        }),
      );
    }

    const connector = yield* waitForWalletEffect();

    if (!isVersionCompatible(connector.apiVersion, '4.0')) {
      return yield* Effect.fail(
        new WalletError({
          cause: new Error('Incompatible API version'),
          message: `Incompatible wallet API version: ${connector.apiVersion}. Requires 4.x or higher. Please update Lace.`,
        }),
      );
    }

    const wallet = yield* Effect.tryPromise({
      try: () => connector.connect(networkId),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to connect to wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    const config = yield* Effect.tryPromise({
      try: () => wallet.getConfiguration(),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to get wallet configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    const addresses = yield* Effect.tryPromise({
      try: () => wallet.getShieldedAddresses(),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to get wallet addresses: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    return {
      wallet,
      config,
      addresses,
      coinPublicKey: addresses.shieldedCoinPublicKey,
      encryptionPublicKey: addresses.shieldedEncryptionPublicKey,
    };
  });
}

function disconnectEffect(): Effect.Effect<void, never> {
  return Effect.void;
}

function getProvingProviderEffect(
  wallet: ConnectedAPI,
  zkConfigProvider: KeyMaterialProvider,
): Effect.Effect<ProvingProvider, WalletError> {
  return Effect.tryPromise({
    try: () => wallet.getProvingProvider(zkConfigProvider),
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to get proving provider: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Internal Effects — Browser Wallet Transaction Providers
// =============================================================================

function balanceTxEffect(
  wallet: ConnectedAPI,
  tx: UnboundTransaction,
): Effect.Effect<FinalizedTransaction, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const txBytes = tx.serialize();
      const serializedTx = bytesToHex(txBytes);

      const result = await wallet.balanceUnsealedTransaction(serializedTx);

      const resultBytes = hexToBytes(result.tx);
      const networkId = getNetworkId();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transaction = (Transaction as any).deserialize(
        { SignatureEnabled: true },
        { Proof: true },
        { Binding: true },
        resultBytes,
        networkId,
      ) as FinalizedTransaction;

      return transaction;
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to balance transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function submitTxEffect(
  wallet: ConnectedAPI,
  tx: FinalizedTransaction,
): Effect.Effect<TransactionId, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const txBytes = tx.serialize();
      const serializedTx = bytesToHex(txBytes);
      await wallet.submitTransaction(serializedTx);
      return serializedTx as TransactionId;
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to submit transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Internal — Unified Wallet
// =============================================================================

/** @internal */
type WalletBackend =
  | { readonly type: 'seed'; readonly context: WalletContext }
  | { readonly type: 'browser'; readonly connection: WalletConnection };

function getBalanceFromSeedEffect(walletContext: WalletContext): Effect.Effect<WalletBalance, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const state = await Rx.firstValueFrom(walletContext.wallet.state());
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shielded: ((state as any).shielded?.balances as Record<string, bigint>) ?? {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unshielded: ((state as any).unshielded?.balances as Record<string, bigint>) ?? {},
        dust: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          balance: ((state as any).dust?.walletBalance?.(new Date()) as bigint) ?? 0n,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cap: ((state as any).dust?.walletCap?.(new Date()) as bigint) ?? 0n,
        },
      };
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to get balance: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function getBalanceFromBrowserEffect(connection: WalletConnection): Effect.Effect<WalletBalance, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const [shielded, unshielded, dustInfo] = await Promise.all([
        connection.wallet.getShieldedBalances(),
        connection.wallet.getUnshieldedBalances(),
        connection.wallet.getDustBalance(),
      ]);
      return {
        shielded,
        unshielded,
        dust: {
          balance: dustInfo.balance,
          cap: dustInfo.cap,
        },
      };
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to get balance: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function fromSeedEffect(
  seed: string,
  networkConfig: NetworkConfig,
  options?: FromSeedOptions,
): Effect.Effect<ConnectedWallet, WalletError> {
  return Effect.gen(function* () {
    const walletContext = yield* initEffect(seed, networkConfig);

    if (options?.sync !== false) {
      yield* waitForSyncEffect(walletContext);
    }

    const address = walletContext.unshieldedKeystore.getBech32Address().asString();
    const coinPublicKey = String(walletContext.shieldedSecretKeys.coinPublicKey);
    const encryptionPublicKey = String(walletContext.shieldedSecretKeys.encryptionPublicKey);
    const backend: WalletBackend = { type: 'seed', context: walletContext };

    return createConnectedWalletHandle(backend, address, { coinPublicKey, encryptionPublicKey });
  });
}

function fromBrowserEffect(networkId: string = 'testnet'): Effect.Effect<ConnectedWallet, WalletError> {
  return Effect.gen(function* () {
    const connection = yield* connectEffect(networkId);
    const address = connection.addresses.shieldedAddress;
    const coinPublicKey = connection.coinPublicKey;
    const encryptionPublicKey = connection.encryptionPublicKey;
    const backend: WalletBackend = { type: 'browser', connection };

    return createConnectedWalletHandle(backend, address, { coinPublicKey, encryptionPublicKey });
  });
}

function createConnectedWalletHandle(
  backend: WalletBackend,
  address: string,
  keys: { coinPublicKey: string; encryptionPublicKey: string },
): ConnectedWallet {
  const getBalanceEff = (): Effect.Effect<WalletBalance, WalletError> =>
    backend.type === 'seed'
      ? getBalanceFromSeedEffect(backend.context)
      : getBalanceFromBrowserEffect(backend.connection);

  const providersEff = (): Effect.Effect<WalletProviders, WalletError> =>
    backend.type === 'seed'
      ? providersEffect(backend.context)
      : Effect.try({
          try: () => createWalletProviders(backend.connection.wallet, backend.connection.addresses),
          catch: (cause) =>
            new WalletError({
              cause,
              message: `Failed to create wallet providers: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });

  const closeEff = (): Effect.Effect<void, WalletError> =>
    backend.type === 'seed' ? closeEffect(backend.context) : Effect.void;

  return {
    type: 'connected',
    source: backend.type === 'seed' ? 'seed' : 'browser',
    address,
    coinPublicKey: keys.coinPublicKey,
    encryptionPublicKey: keys.encryptionPublicKey,

    getBalance: () => runEffectPromise(getBalanceEff()),
    providers: () => runEffect(providersEff()),
    close: () => runEffectPromise(closeEff()),
    [Symbol.asyncDispose]: () => runEffectPromise(closeEff()),

    effect: {
      getBalance: getBalanceEff,
      providers: providersEff,
      close: closeEff,
    },
  };
}

// =============================================================================
// Promise API — Unified Wallet
// =============================================================================

/**
 * Create a connected wallet from an HD seed.
 *
 * Initializes the wallet, optionally syncs with the network (default: true),
 * and returns a `ConnectedWallet` handle.
 *
 * @param seed - 64-character hex seed
 * @param networkConfig - Network configuration
 * @param options - Options (sync: whether to wait for sync, default true)
 * @returns Connected wallet handle
 * @throws {WalletError} When initialization or sync fails
 *
 * @example
 * ```typescript
 * const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);
 * const balance = await wallet.getBalance();
 * const { walletProvider, midnightProvider } = wallet.providers();
 * await wallet.close();
 * ```
 *
 * @since 0.7.0
 * @category constructors
 */
export async function fromSeed(
  seed: string,
  networkConfig: NetworkConfig,
  options?: FromSeedOptions,
): Promise<ConnectedWallet> {
  return runEffectPromise(fromSeedEffect(seed, networkConfig, options));
}

/**
 * Create a connected wallet from the Lace browser extension.
 *
 * Connects to the Lace wallet and returns a `ConnectedWallet` handle
 * with the same interface as `fromSeed`.
 *
 * @param networkId - Network to connect to (default: 'testnet')
 * @returns Connected wallet handle
 * @throws {WalletError} When connection fails or wallet not found
 *
 * @example
 * ```typescript
 * const wallet = await Midday.Wallet.fromBrowser('testnet');
 * const balance = await wallet.getBalance();
 * const { walletProvider, midnightProvider } = wallet.providers();
 * ```
 *
 * @since 0.7.0
 * @category constructors
 */
export async function fromBrowser(networkId: string = 'testnet'): Promise<ConnectedWallet> {
  return runEffectPromise(fromBrowserEffect(networkId));
}

/**
 * Create a read-only wallet from an address string.
 *
 * Useful for querying contract state or passing an address without needing keys.
 *
 * @param address - Wallet address
 * @returns Read-only wallet handle
 *
 * @example
 * ```typescript
 * const wallet = Midday.Wallet.fromAddress('midnight1...');
 * console.log(wallet.address);
 * ```
 *
 * @since 0.7.0
 * @category constructors
 */
export function fromAddress(address: string): ReadonlyWallet {
  return {
    type: 'readonly',
    source: 'address',
    address,
  };
}

// =============================================================================
// Promise API — Seed Wallet
// =============================================================================

/**
 * Initialize wallet from HD seed.
 *
 * @deprecated Use `Wallet.fromSeed(seed, networkConfig)` instead.
 * @throws {WalletError} When initialization fails
 *
 * @since 0.2.0
 * @category constructors
 */
export async function init(seed: string, networkConfig: NetworkConfig): Promise<WalletContext> {
  return runEffectPromise(initEffect(seed, networkConfig));
}

/**
 * Wait for wallet to sync with the network.
 *
 * @deprecated Use `Wallet.fromSeed(seed, networkConfig)` which syncs automatically.
 * @throws {WalletError} When sync fails
 *
 * @since 0.2.0
 * @category operations
 */
export async function waitForSync(walletContext: WalletContext): Promise<void> {
  return runEffectPromise(waitForSyncEffect(walletContext));
}

/**
 * Derive wallet address from seed without starting wallet connection.
 *
 * @throws {WalletError} When derivation fails
 *
 * @since 0.2.0
 * @category utilities
 */
export function deriveAddress(seed: string, networkId: string): string {
  return runEffect(deriveAddressEffect(seed, networkId));
}

/**
 * Stop wallet sync and release WebSocket connections.
 *
 * @deprecated Use `wallet.close()` on the `ConnectedWallet` handle instead.
 * @throws {WalletError} When close fails
 *
 * @since 0.2.9
 * @category operations
 */
export async function close(walletContext: WalletContext): Promise<void> {
  return runEffectPromise(closeEffect(walletContext));
}

/**
 * Create WalletProvider and MidnightProvider from a seed wallet context.
 *
 * @deprecated Use `wallet.providers()` on the `ConnectedWallet` handle instead.
 *
 * @since 0.6.0
 * @category constructors
 */
export function providers(walletContext: WalletContext): WalletProviders {
  return runEffect(providersEffect(walletContext));
}

// =============================================================================
// Promise API — Browser Wallet
// =============================================================================

/**
 * Check if running in browser with Lace wallet available.
 *
 * @since 0.2.0
 * @category browser
 */
export function isWalletAvailable(): boolean {
  return runEffect(isAvailableEffect());
}

/**
 * Connect to the Lace wallet in browser.
 *
 * @deprecated Use `Wallet.fromBrowser(networkId)` instead.
 * @throws {WalletError} When connection fails
 *
 * @since 0.2.0
 * @category browser
 */
export async function connectWallet(networkId: string = 'testnet'): Promise<WalletConnection> {
  return runEffectPromise(connectEffect(networkId));
}

/**
 * Get a proving provider from the connected wallet.
 *
 * @throws {WalletError} When getting proving provider fails
 *
 * @since 0.2.0
 * @category browser
 */
export async function getWalletProvingProvider(
  wallet: ConnectedAPI,
  zkConfigProvider: KeyMaterialProvider,
): Promise<ProvingProvider> {
  return runEffectPromise(getProvingProviderEffect(wallet, zkConfigProvider));
}

/**
 * Disconnect from the wallet (if supported).
 *
 * @deprecated Use `wallet.close()` on the `ConnectedWallet` handle instead.
 *
 * @since 0.2.0
 * @category browser
 */
export async function disconnectWallet(): Promise<void> {
  return runEffectPromise(disconnectEffect());
}

/**
 * Create providers from a connected wallet (v4 API).
 *
 * @deprecated Use `wallet.providers()` on the `ConnectedWallet` handle instead.
 *
 * @since 0.2.0
 * @category browser
 */
export function createWalletProviders(wallet: ConnectedAPI, addresses: ShieldedAddresses): WalletProviders {
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => addresses.shieldedCoinPublicKey as unknown as ReturnType<WalletProvider['getCoinPublicKey']>,
    getEncryptionPublicKey: () =>
      addresses.shieldedEncryptionPublicKey as unknown as ReturnType<WalletProvider['getEncryptionPublicKey']>,

    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      return runEffectPromise(balanceTxEffect(wallet, tx));
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      return runEffectPromise(submitTxEffect(wallet, tx));
    },
  };

  return { walletProvider, midnightProvider };
}

// =============================================================================
// Effect Namespace
// =============================================================================

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  // Unified wallet factories
  fromSeed: fromSeedEffect,
  fromBrowser: fromBrowserEffect,
  // Seed wallet (legacy — prefer fromSeed)
  init: initEffect,
  waitForSync: waitForSyncEffect,
  deriveAddress: deriveAddressEffect,
  close: closeEffect,
  providers: providersEffect,
  // Browser wallet connector (legacy — prefer fromBrowser)
  connect: connectEffect,
  isAvailable: isAvailableEffect,
  disconnect: disconnectEffect,
  getProvingProvider: getProvingProviderEffect,
  // Browser wallet transactions
  balanceTx: balanceTxEffect,
  submitTx: submitTxEffect,
};

// =============================================================================
// Effect DI — Seed Wallet Service
// =============================================================================

/**
 * Service interface for seed-based Wallet operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface WalletServiceImpl {
  readonly init: (seed: string, networkConfig: NetworkConfig) => Effect.Effect<WalletContext, WalletError>;
  readonly waitForSync: (walletContext: WalletContext) => Effect.Effect<void, WalletError>;
  readonly close: (walletContext: WalletContext) => Effect.Effect<void, WalletError>;
  readonly deriveAddress: (seed: string, networkId: string) => Effect.Effect<string, WalletError>;
  readonly providers: (walletContext: WalletContext) => Effect.Effect<WalletProviders, WalletError>;
}

/**
 * Context.Tag for WalletService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class WalletService extends Context.Tag('WalletService')<WalletService, WalletServiceImpl>() {}

/**
 * Live Layer for WalletService.
 *
 * @since 0.2.0
 * @category layer
 */
export const WalletLive: Layer.Layer<WalletService> = Layer.succeed(WalletService, {
  init: initEffect,
  waitForSync: waitForSyncEffect,
  close: closeEffect,
  deriveAddress: deriveAddressEffect,
  providers: providersEffect,
});

// =============================================================================
// Effect DI — Browser Wallet Connector Service
// =============================================================================

/**
 * Service interface for WalletConnector operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface WalletConnectorServiceImpl {
  readonly connect: (networkId?: string) => Effect.Effect<WalletConnection, WalletError>;
  readonly isAvailable: () => Effect.Effect<boolean, never>;
  readonly disconnect: () => Effect.Effect<void, never>;
  readonly getProvingProvider: (
    wallet: ConnectedAPI,
    zkConfigProvider: KeyMaterialProvider,
  ) => Effect.Effect<ProvingProvider, WalletError>;
}

/**
 * Context.Tag for WalletConnectorService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class WalletConnectorService extends Context.Tag('WalletConnectorService')<
  WalletConnectorService,
  WalletConnectorServiceImpl
>() {}

/**
 * Live Layer for WalletConnectorService.
 *
 * @since 0.2.0
 * @category layer
 */
export const WalletConnectorLive: Layer.Layer<WalletConnectorService> = Layer.succeed(WalletConnectorService, {
  connect: connectEffect,
  isAvailable: isAvailableEffect,
  disconnect: disconnectEffect,
  getProvingProvider: getProvingProviderEffect,
});

// =============================================================================
// Effect DI — Browser Wallet Provider Service
// =============================================================================

/**
 * Service interface for WalletProvider operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface WalletProviderServiceImpl {
  readonly balanceTx: (
    wallet: ConnectedAPI,
    tx: UnboundTransaction,
  ) => Effect.Effect<FinalizedTransaction, WalletError>;
  readonly submitTx: (wallet: ConnectedAPI, tx: FinalizedTransaction) => Effect.Effect<TransactionId, WalletError>;
}

/**
 * Context.Tag for WalletProviderService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class WalletProviderService extends Context.Tag('WalletProviderService')<
  WalletProviderService,
  WalletProviderServiceImpl
>() {}

/**
 * Live Layer for WalletProviderService.
 *
 * @since 0.2.0
 * @category layer
 */
export const WalletProviderLive: Layer.Layer<WalletProviderService> = Layer.succeed(WalletProviderService, {
  balanceTx: balanceTxEffect,
  submitTx: submitTxEffect,
});
