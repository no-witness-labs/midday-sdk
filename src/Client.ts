/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * The Client is the central hub for all SDK operations. It initializes
 * the wallet, creates providers, and manages the contract lifecycle.
 *
 * ## API Design
 *
 * ```typescript
 * // Promise user — simple flow
 * const client = await Midday.Client.create(config);
 * const contract = await client.loadContract({ path: './contracts/counter' });
 * await contract.deploy();
 * await contract.call('increment');
 *
 * // Effect user — compositional
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.effect.create(config);
 *   const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 *   yield* contract.effect.deploy();
 *   yield* contract.effect.call('increment');
 * });
 * ```
 *
 * @since 0.1.0
 * @module
 */

import { Context, Data, Duration, Effect, Layer, Scope } from 'effect';
import { Transaction } from '@midnight-ntwrk/ledger-v7';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {
  WalletProvider,
  MidnightProvider,
  ZKConfigProvider,
  PrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-types';

import * as Config from './Config.js';
import * as Wallet from './Wallet.js';
import type { NetworkConfig } from './Config.js';
import type { WalletContext } from './Wallet.js';
import type { WalletConnection, WalletProviders, ConnectedWallet } from './Wallet.js';
import type {
  LoadedContract,
  ContractModule,
  InferLedger,
  InferCircuits,
  InferActions,
  LoadContractOptions,
  LoadedContractData,
  FinalizedTxData,
  PublicDataProvider,
  LedgerParser,
  ReadonlyContract,
} from './Contract.js';
import { loadContractModuleEffect, createLoadedContractHandle, createReadonlyContractHandle } from './Contract.js';
import { runEffectWithLogging } from './Runtime.js';
import { bytesToHex, hexToBytes } from './Utils.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error during client initialization or operation.
 *
 * @since 0.3.0
 * @category errors
 */
export class ClientError extends Data.TaggedError('ClientError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * Error when a transaction wait exceeds the configured timeout.
 *
 * @since 0.10.0
 * @category errors
 */
export class TxTimeoutError extends Data.TaggedError('TxTimeoutError')<{
  readonly txHash: string;
  readonly timeout: number;
  readonly message: string;
}> {}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Options for waiting on a transaction.
 *
 * @since 0.10.0
 * @category model
 */
export interface WaitForTxOptions {
  /** Timeout in milliseconds. If the transaction isn't finalized within this duration, a `TxTimeoutError` is thrown. */
  readonly timeout?: number;
}

// =============================================================================
// Provider Types (absorbed from Providers module)
// =============================================================================

/**
 * Storage configuration.
 *
 * @since 0.2.0
 * @category model
 */
export interface StorageConfig {
  /** Storage password */
  password?: string;
}

/**
 * Base providers without zkConfig and proofProvider (shared at client level).
 * zkConfig and proofProvider are per-contract, added when loading a contract.
 *
 * @since 0.5.0
 * @category model
 */
export interface BaseProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  privateStateProvider: PrivateStateProvider;
  /** Network configuration for creating per-contract proof providers */
  networkConfig: NetworkConfig;
}

/**
 * Options for creating base providers (without zkConfig).
 *
 * @since 0.5.0
 * @category model
 */
export interface CreateBaseProvidersOptions {
  /** Network configuration */
  networkConfig: NetworkConfig;
  /** Private state provider */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storageConfig?: StorageConfig;
  /** Optional fee relay wallet — uses this wallet for balanceTx/submitTx while keeping the primary wallet for ZK proofs */
  feeRelayWallet?: WalletContext;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for creating a client.
 *
 * @since 0.2.0
 * @category model
 */
export interface ClientConfig {
  /** Network to connect to (default: 'local') */
  network?: string;
  /** Custom network configuration (overrides network preset) */
  networkConfig?: NetworkConfig;
  /** Pre-created wallet (from Wallet.fromSeed or Wallet.fromBrowser) */
  wallet?: ConnectedWallet;
  /** Wallet seed (required for non-local networks). Ignored if `wallet` is provided. */
  seed?: string;
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
  logging?: boolean;
  /** Fee relay — delegate fee payment to a funded wallet so non-funded wallets can transact.
   * - `{ seed }` — Node.js: initialize a local wallet from seed
   * - `{ url }` — Browser: proxy to a fee relay HTTP server
   */
  feeRelay?: { seed: string } | { url: string };
}

/**
 * Configuration for creating a read-only client.
 *
 * Only requires network configuration — no wallet, seed, or private state needed.
 *
 * @since 0.8.0
 * @category model
 */
export interface ReadonlyClientConfig {
  /** Network to connect to (default: 'local') */
  network?: string;
  /** Custom network configuration (overrides network preset) */
  networkConfig?: NetworkConfig;
  /** Enable logging (default: false) */
  logging?: boolean;
}

// =============================================================================
// Internal Data Types
// =============================================================================

/**
 * Internal client data (plain object).
 * @internal
 */
interface ClientData {
  readonly wallet: WalletContext | null;
  readonly connectedWallet: ConnectedWallet | null;
  readonly relayerWallet: WalletContext | null;
  readonly networkConfig: NetworkConfig;
  readonly providers: BaseProviders;
  readonly logging: boolean;
}

// =============================================================================
// Public Handle Interfaces
// =============================================================================

/**
 * A read-only Midnight client for querying contract state.
 *
 * No wallet, proof server, or private state required. Created via
 * `Client.createReadonly()`. Ideal for dashboards, explorers, and
 * monitoring tools.
 *
 * @since 0.8.0
 * @category model
 */
export interface ReadonlyClient {
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Public data provider (for advanced use) */
  readonly provider: PublicDataProvider;

  /**
   * Load a contract module for read-only state queries.
   *
   * Only requires the contract module (for its `ledger` parser). No wallet,
   * proof server, or private state needed.
   *
   * @typeParam M - Contract module type (inferred from options.module)
   * @returns A `ReadonlyContract` handle with `readState()` and related methods.
   *
   * @example
   * ```typescript
   * const reader = Client.createReadonly({ networkConfig });
   * const counter = reader.loadContract({ module: CounterContract });
   * const state = await counter.readState(address);
   * console.log(state.counter); // 42n
   * ```
   */
  loadContract<M extends ContractModule>(
    options: { module: M },
  ): ReadonlyContract<InferLedger<M>>;
}

/**
 * A Midnight client handle with convenience methods.
 *
 * @since 0.5.0
 * @category model
 */
export interface MiddayClient {
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Base providers (for advanced use — no zkConfig) */
  readonly providers: BaseProviders;
  /** Raw wallet context (null if using wallet connector) */
  readonly wallet: WalletContext | null;
  /** Fee relay wallet context (null if fee relay not configured) */
  readonly relayerWallet: WalletContext | null;

  /**
   * Load a contract module. Returns a `LoadedContract` —
   * call `deploy()` or `join()` on it to get a `DeployedContract`.
   *
   * @typeParam M - Contract module type (inferred from options.module)
   */
  loadContract<M extends ContractModule>(
    options: LoadContractOptions<M>,
  ): Promise<LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>>;

  /** Wait for a transaction to be finalized.
   *
   * @param txHash - Transaction hash to watch
   * @param options - Optional settings (e.g., timeout)
   * @throws {TxTimeoutError} When the timeout is exceeded
   */
  waitForTx(txHash: string, options?: WaitForTxOptions): Promise<FinalizedTxData>;

  /**
   * Close the client and release all resources.
   *
   * @since 0.2.9
   */
  close(): Promise<void>;

  /**
   * Supports `await using client = await Midday.Client.create(config);`
   *
   * @since 0.2.9
   */
  [Symbol.asyncDispose](): Promise<void>;

  /** Effect versions of client methods */
  readonly effect: {
    loadContract<M extends ContractModule>(
      options: LoadContractOptions<M>,
    ): Effect.Effect<LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>, ClientError>;
    waitForTx(txHash: string, options?: WaitForTxOptions): Effect.Effect<FinalizedTxData, ClientError | TxTimeoutError>;
    close(): Effect.Effect<void, ClientError>;
  };
}

// =============================================================================
// Provider Factory Functions (absorbed from Providers module)
// =============================================================================

// =============================================================================
// Provider Factory Functions — delegated to module factories
// =============================================================================

function createBaseProvidersEffect(
  walletContext: WalletContext,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ClientError> {
  return Wallet.effect.providers(walletContext).pipe(
    Effect.map(({ walletProvider, midnightProvider }) => {
      const { networkConfig, privateStateProvider, feeRelayWallet } = options;

      setNetworkId(networkConfig.networkId as 'undeployed');

      // Fee relay: use relay wallet for balancing/submitting, user wallet for ZK proofs
      const feeWalletCtx = feeRelayWallet ?? walletContext;

      const publicDataProvider = Config.publicDataProvider(networkConfig);

      const effectiveWalletProvider: WalletProvider = feeRelayWallet
        ? {
            ...walletProvider,
            balanceTx: async (tx, ttl) => {
              const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
              const recipe = await feeWalletCtx.wallet.balanceUnboundTransaction(
                tx,
                {
                  shieldedSecretKeys: feeWalletCtx.shieldedSecretKeys,
                  dustSecretKey: feeWalletCtx.dustSecretKey,
                },
                { ttl: txTtl },
              );
              return await feeWalletCtx.wallet.finalizeRecipe(recipe);
            },
          }
        : walletProvider;

      const effectiveMidnightProvider: MidnightProvider = feeRelayWallet
        ? { submitTx: async (tx) => await feeWalletCtx.wallet.submitTransaction(tx) }
        : midnightProvider;

      return {
        walletProvider: effectiveWalletProvider,
        midnightProvider: effectiveMidnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      } satisfies BaseProviders;
    }),
    Effect.mapError(
      (cause) =>
        new ClientError({
          cause,
          message: `Failed to create base providers: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    ),
  );
}

// =============================================================================
// Client Effect Implementations
// =============================================================================

function createClientDataEffect(config: ClientConfig): Effect.Effect<ClientData, ClientError> {
  return Effect.gen(function* () {
    const {
      network = 'local',
      networkConfig: customNetworkConfig,
      wallet: connectedWallet,
      seed,
      privateStateProvider,
      storage,
      logging = true,
      feeRelay,
    } = config;

    const networkConfig = customNetworkConfig ?? Config.getNetworkConfig(network);

    // Path 1: Pre-created ConnectedWallet
    if (connectedWallet) {
      yield* Effect.logDebug('Using pre-created wallet...');

      const { walletProvider, midnightProvider } = yield* connectedWallet.effect.providers().pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to get wallet providers: ${e.message}`,
            }),
        ),
      );

      setNetworkId(networkConfig.networkId as 'undeployed');
      const publicDataProvider = Config.publicDataProvider(networkConfig);

      const providers: BaseProviders = {
        walletProvider,
        midnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      };

      return {
        wallet: null,
        connectedWallet,
        relayerWallet: null,
        networkConfig,
        providers,
        logging,
      };
    }

    // Path 2: Legacy seed-based initialization
    const walletSeed = seed ?? (network === 'local' ? Config.DEV_WALLET_SEED : undefined);
    if (!walletSeed) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('Missing seed'),
          message: 'Wallet seed is required for non-local networks. Provide via config.seed or config.wallet.',
        }),
      );
    }

    yield* Effect.logDebug('Initializing wallet...');
    const walletContext = yield* Wallet.effect.init(walletSeed, networkConfig).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to initialize wallet: ${e.message}`,
          }),
      ),
    );

    yield* Wallet.effect.waitForSync(walletContext).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to sync wallet: ${e.message}`,
          }),
      ),
    );
    yield* Effect.logDebug('Wallet synced');

    // Initialize fee relay wallet if configured (seed-based only for Client.create)
    let relayerWallet: WalletContext | null = null;
    if (feeRelay && 'seed' in feeRelay) {
      yield* Effect.logDebug('Initializing fee relay wallet...');
      relayerWallet = yield* Wallet.effect.init(feeRelay.seed, networkConfig).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to initialize fee relay wallet: ${e.message}`,
            }),
        ),
      );

      yield* Wallet.effect.waitForSync(relayerWallet).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to sync fee relay wallet: ${e.message}`,
            }),
        ),
      );
      yield* Effect.logDebug('Fee relay wallet synced');
    } else if (feeRelay && 'url' in feeRelay) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('URL-based fee relay not supported with Client.create'),
          message: 'URL-based fee relay ({ url }) is only supported with Client.fromWallet. Use { seed } for Client.create.',
        }),
      );
    }

    const providerOptions: CreateBaseProvidersOptions = {
      networkConfig,
      privateStateProvider,
      storageConfig: storage,
      feeRelayWallet: relayerWallet ?? undefined,
    };

    const providers = yield* createBaseProvidersEffect(walletContext, providerOptions);

    return {
      wallet: walletContext,
      connectedWallet: null,
      relayerWallet,
      networkConfig,
      providers,
      logging,
    };
  });
}

function fromWalletDataEffect(
  connection: WalletConnection,
  config: {
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
    feeRelay?: { seed: string } | { url: string };
  },
): Effect.Effect<ClientData, ClientError> {
  return Effect.gen(function* () {
    const { privateStateProvider, logging = true, feeRelay } = config;

    const networkConfig: NetworkConfig = {
      networkId: connection.config.networkId,
      indexer: connection.config.indexerUri,
      indexerWS: connection.config.indexerWsUri,
      node: connection.config.substrateNodeUri,
      proofServer: connection.config.proverServerUri ?? '',
    };

    // Create wallet providers from connection
    let { walletProvider, midnightProvider } = Wallet.createWalletProviders(connection.wallet, connection.addresses);

    // Initialize fee relay if configured
    let relayerWallet: WalletContext | null = null;
    if (feeRelay && 'seed' in feeRelay) {
      // Seed-based: initialize a local wallet (Node.js)
      yield* Effect.logDebug('Initializing fee relay wallet...');
      relayerWallet = yield* Wallet.effect.init(feeRelay.seed, networkConfig).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to initialize fee relay wallet: ${e.message}`,
            }),
        ),
      );

      yield* Wallet.effect.waitForSync(relayerWallet).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to sync fee relay wallet: ${e.message}`,
            }),
        ),
      );
      yield* Effect.logDebug('Fee relay wallet synced');

      // Override balanceTx/submitTx to use relay wallet, keep Lace's ZK keys
      const relayCtx = relayerWallet;
      walletProvider = {
        ...walletProvider,
        balanceTx: async (tx, ttl) => {
          const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
          const recipe = await relayCtx.wallet.balanceUnboundTransaction(
            tx,
            {
              shieldedSecretKeys: relayCtx.shieldedSecretKeys,
              dustSecretKey: relayCtx.dustSecretKey,
            },
            { ttl: txTtl },
          );
          return await relayCtx.wallet.finalizeRecipe(recipe);
        },
      };
      midnightProvider = {
        submitTx: async (tx) => await relayCtx.wallet.submitTransaction(tx),
      };
    } else if (feeRelay && 'url' in feeRelay) {
      // URL-based: proxy to a remote fee relay server (browser)
      const relayUrl = feeRelay.url.replace(/\/$/, '');
      yield* Effect.logDebug(`Using fee relay server at ${relayUrl}`);

      walletProvider = {
        ...walletProvider,
        balanceTx: async (tx) => {
          const txBytes = tx.serialize();
          const txHex = bytesToHex(txBytes);

          const response = await fetch(`${relayUrl}/balance-tx`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: txHex }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(`Fee relay balance-tx failed: ${err.error}`);
          }

          const { tx: finalizedHex } = await response.json();
          const finalizedBytes = hexToBytes(finalizedHex);
          return Transaction.deserialize(
            'signature' as import('@midnight-ntwrk/ledger-v7').SignatureEnabled['instance'],
            'proof' as import('@midnight-ntwrk/ledger-v7').Proof['instance'],
            'binding' as import('@midnight-ntwrk/ledger-v7').Binding['instance'],
            finalizedBytes,
          );
        },
      };
      midnightProvider = {
        submitTx: async (tx) => {
          const txBytes = tx.serialize();
          const txHex = bytesToHex(txBytes);

          const response = await fetch(`${relayUrl}/submit-tx`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: txHex }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(`Fee relay submit-tx failed: ${err.error}`);
          }

          const { txId } = await response.json();
          return txId;
        },
      };
    }

    setNetworkId(networkConfig.networkId as 'undeployed');

    const publicDataProvider = Config.publicDataProvider(networkConfig);

    const providers: BaseProviders = {
      walletProvider,
      midnightProvider,
      publicDataProvider,
      privateStateProvider,
      networkConfig,
    };

    yield* Effect.logDebug('Connected to wallet');

    return {
      wallet: null,
      connectedWallet: null,
      relayerWallet,
      networkConfig,
      providers,
      logging,
    };
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new ClientError({
          cause: defect,
          message: `Failed to create client from wallet: ${defect instanceof Error ? defect.message : String(defect)}`,
        }),
      ),
    ),
  );
}

function loadContractEffect(
  clientData: ClientData,
  options: LoadContractOptions,
): Effect.Effect<LoadedContractData, ClientError> {
  return loadContractModuleEffect(
    options,
    clientData.providers.networkConfig,
    clientData.providers,
    clientData.logging,
  ).pipe(
    Effect.mapError(
      (e) =>
        new ClientError({
          cause: e,
          message: e.message,
        }),
    ),
  );
}

function waitForTxEffect(
  clientData: ClientData,
  txHash: string,
  options?: WaitForTxOptions,
): Effect.Effect<FinalizedTxData, ClientError | TxTimeoutError> {
  const base = Effect.tryPromise({
    try: async () => {
      const data = await clientData.providers.publicDataProvider.watchForTxData(txHash);
      return {
        txHash: data.txHash,
        blockHeight: data.blockHeight,
        blockHash: data.blockHash,
      };
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to wait for transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  if (options?.timeout != null) {
    return Effect.timeoutFail(base, {
      duration: Duration.millis(options.timeout),
      onTimeout: () =>
        new TxTimeoutError({
          txHash,
          timeout: options.timeout!,
          message: `Transaction ${txHash} was not finalized within ${options.timeout}ms`,
        }),
    });
  }

  return base;
}

function closeClientEffect(data: ClientData): Effect.Effect<void, ClientError> {
  return Effect.gen(function* () {
    if (data.relayerWallet) {
      yield* Wallet.effect.close(data.relayerWallet).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to close fee relay wallet: ${e.message}`,
            }),
        ),
      );
    }
    if (data.wallet) {
      yield* Wallet.effect.close(data.wallet).pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to close wallet: ${e.message}`,
            }),
        ),
      );
    }
    if (data.connectedWallet) {
      yield* data.connectedWallet.effect.close().pipe(
        Effect.mapError(
          (e) =>
            new ClientError({
              cause: e,
              message: `Failed to close wallet: ${e.message}`,
            }),
        ),
      );
    }
  });
}

// =============================================================================
// Handle Factory
// =============================================================================

function createClientHandle(data: ClientData): MiddayClient {
  return {
    networkConfig: data.networkConfig,
    providers: data.providers,
    wallet: data.wallet,
    relayerWallet: data.relayerWallet,

    loadContract: async <M extends ContractModule>(options: LoadContractOptions<M>) => {
      const contractData = await runEffectWithLogging(
        loadContractEffect(data, options),
        data.logging,
      );
      return createLoadedContractHandle(contractData) as LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>;
    },
    waitForTx: (txHash, options?) =>
      runEffectWithLogging(waitForTxEffect(data, txHash, options), data.logging),
    close: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    [Symbol.asyncDispose]: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    effect: {
      loadContract: <M extends ContractModule>(options: LoadContractOptions<M>) =>
        loadContractEffect(data, options).pipe(
          Effect.map((contractData) => createLoadedContractHandle(contractData) as LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>),
        ),
      waitForTx: (txHash, options?) => waitForTxEffect(data, txHash, options),
      close: () => closeClientEffect(data),
    },
  };
}

function createReadonlyClientHandle(
  networkConfig: NetworkConfig,
  provider: PublicDataProvider,
): ReadonlyClient {
  return {
    networkConfig,
    provider,

    loadContract: <M extends ContractModule>(options: { module: M }) =>
      createReadonlyContractHandle(options.module.ledger, provider) as ReadonlyContract<InferLedger<M>>,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a Midnight client for interacting with contracts.
 *
 * @example
 * ```typescript
 * const client = await Midday.Client.create({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   privateStateProvider,
 * });
 *
 * const loaded = await client.loadContract({
 *   module: CounterContract,
 *   zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
 *   privateStateId: 'my-counter',
 * });
 * const deployed = await loaded.deploy();
 * await deployed.actions.increment();
 * const state = await deployed.ledgerState();
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export async function create(config: ClientConfig): Promise<MiddayClient> {
  const logging = config.logging ?? true;
  const data = await runEffectWithLogging(createClientDataEffect(config), logging);
  return createClientHandle(data);
}

/**
 * Create a read-only client for querying contract state.
 *
 * No wallet, seed, proof server, or private state required — only needs
 * network configuration (indexer URL). Ideal for dashboards, explorers,
 * and monitoring tools.
 *
 * @example
 * ```typescript
 * const reader = await Midday.Client.createReadonly({
 *   networkConfig: Midday.Config.NETWORKS.local,
 * });
 *
 * const counter = reader.loadContract({ module: CounterContract });
 * const state = await counter.readState(address);
 * console.log(state.counter); // 42n
 * ```
 *
 * @since 0.8.0
 * @category constructors
 */
export function createReadonly(config: ReadonlyClientConfig = {}): ReadonlyClient {
  const networkConfig = config.networkConfig ?? Config.getNetworkConfig(config.network ?? 'local');
  const provider = Config.publicDataProvider(networkConfig);
  return createReadonlyClientHandle(networkConfig, provider);
}

/**
 * Run a function with a client that is automatically closed when done.
 *
 * @since 0.2.9
 * @category constructors
 */
export async function withClient<A>(
  config: ClientConfig,
  body: (client: MiddayClient) => Promise<A>,
): Promise<A> {
  const client = await create(config);
  try {
    return await body(client);
  } finally {
    await client.close();
  }
}

/**
 * Create a Midnight client from a connected wallet (browser).
 *
 * @since 0.2.0
 * @category constructors
 */
export async function fromWallet(
  connection: WalletConnection,
  config: {
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
    feeRelay?: { seed: string } | { url: string };
  },
): Promise<MiddayClient> {
  const logging = config.logging ?? true;
  const data = await runEffectWithLogging(fromWalletDataEffect(connection, config), logging);
  return createClientHandle(data);
}

/**
 * Raw Effect APIs for advanced users who want to compose Effects.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  create: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError> =>
    createClientDataEffect(config).pipe(Effect.map(createClientHandle)),

  createScoped: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError, Scope.Scope> =>
    Effect.acquireRelease(
      createClientDataEffect(config).pipe(Effect.map(createClientHandle)),
      (client) => client.effect.close().pipe(Effect.catchAll(() => Effect.void)),
    ),

  withClient: <A, E>(
    config: ClientConfig,
    body: (client: MiddayClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ClientError> =>
    Effect.scoped(
      Effect.acquireRelease(
        createClientDataEffect(config).pipe(Effect.map(createClientHandle)),
        (client) => client.effect.close().pipe(Effect.catchAll(() => Effect.void)),
      ).pipe(Effect.flatMap(body)),
    ),

  fromWallet: (
    connection: WalletConnection,
    config: {
      privateStateProvider: PrivateStateProvider;
      logging?: boolean;
      feeRelay?: { seed: string } | { url: string };
    },
  ): Effect.Effect<MiddayClient, ClientError> =>
    fromWalletDataEffect(connection, config).pipe(Effect.map(createClientHandle)),

  createReadonly: (config: ReadonlyClientConfig = {}): ReadonlyClient =>
    createReadonly(config),
};

// =============================================================================
// Effect DI
// =============================================================================

/**
 * Service interface for Client operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface ClientServiceImpl {
  readonly create: (config: ClientConfig) => Effect.Effect<MiddayClient, ClientError>;
  readonly fromWallet: (
    connection: WalletConnection,
    config: {
      privateStateProvider: PrivateStateProvider;
      logging?: boolean;
      feeRelay?: { seed: string } | { url: string };
    },
  ) => Effect.Effect<MiddayClient, ClientError>;
}

/**
 * Context.Tag for ClientService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class ClientService extends Context.Tag('ClientService')<ClientService, ClientServiceImpl>() {}

/**
 * Live Layer for ClientService.
 *
 * @since 0.2.0
 * @category layer
 */
export const ClientLive: Layer.Layer<ClientService> = Layer.succeed(ClientService, {
  create: effect.create,
  fromWallet: effect.fromWallet,
});

/**
 * Context.Tag for a pre-initialized MiddayClient.
 *
 * @since 0.3.0
 * @category service
 */
export class MiddayClientService extends Context.Tag('MiddayClientService')<
  MiddayClientService,
  MiddayClient
>() {}

/**
 * Create a Layer that provides a pre-initialized MiddayClient.
 * The client is automatically closed when the layer's scope ends.
 *
 * @since 0.3.0
 * @category layer
 */
export function layer(config: ClientConfig): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.scoped(MiddayClientService, effect.createScoped(config));
}

/**
 * Create a Layer from a wallet connection.
 *
 * @since 0.3.0
 * @category layer
 */
export function layerFromWallet(
  connection: WalletConnection,
  config: {
    zkConfigProvider: ZKConfigProvider<string>;
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
    feeRelay?: { seed: string } | { url: string };
  },
): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.scoped(
    MiddayClientService,
    Effect.acquireRelease(
      effect.fromWallet(connection, config),
      (client) => client.effect.close().pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}

/**
 * Create a Layer providing all Client-related services.
 *
 * @since 0.3.0
 * @category layer
 */
export function services(): Layer.Layer<ClientService> {
  return ClientLive;
}
