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
 * await contract.actions.increment();
 *
 * // Effect user — compositional
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.effect.create(config);
 *   const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 *   yield* contract.effect.deploy();
 *   yield* contract.effect.actions.increment();
 * });
 * ```
 *
 * @since 0.1.0
 * @module
 */

import { Context, Data, Duration, Effect, Layer, Scope } from 'effect';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type {
  WalletProvider,
  MidnightProvider,
  PrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-types';

import * as Config from './Config.js';
import * as Contract from './Contract.js';
import * as FeeRelay from './FeeRelay.js';
import * as Runtime from './Runtime.js';
import * as Wallet from './Wallet.js';

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
  publicDataProvider: Contract.PublicDataProvider;
  privateStateProvider: PrivateStateProvider;
  /** Network configuration for creating per-contract proof providers */
  networkConfig: Config.NetworkConfig;
}

/**
 * Options for creating base providers (without zkConfig).
 *
 * @since 0.5.0
 * @category model
 */
export interface CreateBaseProvidersOptions {
  /** Network configuration */
  networkConfig: Config.NetworkConfig;
  /** Private state provider */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storageConfig?: StorageConfig;
  /** Optional fee relay wallet — uses this wallet for balanceTx/submitTx while keeping the primary wallet for ZK proofs */
  feeRelayWallet?: Wallet.WalletContext;
  /** Transaction TTL in milliseconds (default: 30 minutes) */
  txTtlMs?: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for creating a client.
 *
 * **Constraint:** Only one network ID is supported per process. The Midnight SDK
 * uses a global `setNetworkId` call internally, so creating two clients targeting
 * different networks in the same process will cause undefined behaviour.
 *
 * @since 0.2.0
 * @category model
 */
export interface ClientConfig {
  /** Network to connect to (default: 'local') */
  network?: string;
  /** Custom network configuration (overrides network preset) */
  networkConfig?: Config.NetworkConfig;
  /** Pre-created wallet (from Wallet.fromSeed or Wallet.fromBrowser) */
  wallet?: Wallet.ConnectedWallet;
  /** Wallet seed (required for non-local networks). Ignored if `wallet` is provided. */
  seed?: string;
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
  logging?: boolean;
  /** Fee relay — delegate fee payment to a funded wallet so non-funded wallets can transact.
   *
   * Which variant is valid depends on the wallet mode:
   * - **`{ seed }`** — Node.js only. Initialises a local relay wallet from seed.
   *   Valid with seed-based init (`Client.create({ seed })`).
   *   **Not valid** with a pre-created `wallet` (ConnectedWallet).
   * - **`{ url }`** — Browser or Node.js. Proxies `balanceTx`/`submitTx` to a remote HTTP fee relay server.
   *   Valid with a pre-created `wallet` (ConnectedWallet).
   *   **Not valid** with seed-based init (`Client.create({ seed })`).
   *
   * Both variants are accepted by `Client.fromWallet()`.
   */
  feeRelay?: { seed: string } | { url: string };
  /** Transaction TTL in milliseconds (default: 30 minutes). Used as the fallback when no per-call TTL is provided to `balanceTx`. */
  txTtlMs?: number;
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
  networkConfig?: Config.NetworkConfig;
  /** Enable logging (default: false) */
  logging?: boolean;
}

// =============================================================================
// Internal Data Types
// =============================================================================

/**
 * Configuration for creating a client from a wallet connection.
 *
 * @since 0.11.0
 * @category model
 */
export interface FromWalletConfig {
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Enable logging (default: true) */
  logging?: boolean;
  /** Fee relay config. Both `{ seed }` and `{ url }` are valid for `fromWallet`. */
  feeRelay?: { seed: string } | { url: string };
  /** Transaction TTL in milliseconds (default: 30 minutes). */
  txTtlMs?: number;
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
  readonly networkConfig: Config.NetworkConfig;
  /** Public data provider (for advanced use) */
  readonly provider: Contract.PublicDataProvider;

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
  loadContract<M extends Contract.ContractModule>(
    options: { module: M },
  ): Contract.ReadonlyContract<Contract.InferLedger<M>>;
}

/**
 * A Midnight client handle with convenience methods.
 *
 * @since 0.5.0
 * @category model
 */
export interface MiddayClient {
  /** Network configuration */
  readonly networkConfig: Config.NetworkConfig;
  /** Base providers (for advanced use — no zkConfig) */
  readonly providers: BaseProviders;

  /**
   * Load a contract module. Returns a `LoadedContract` —
   * call `deploy()` or `join()` on it to get a `DeployedContract`.
   *
   * @typeParam M - Contract module type (inferred from options.module)
   */
  loadContract<M extends Contract.ContractModule>(
    options: Contract.LoadContractOptions<M>,
  ): Promise<Contract.LoadedContract<Contract.InferLedger<M>, Contract.InferCircuits<M>, Contract.InferActions<M>>>;

  /** Wait for a transaction to be finalized.
   *
   * @param txHash - Transaction hash to watch
   * @param options - Optional settings (e.g., timeout)
   * @throws {TxTimeoutError} When the timeout is exceeded
   */
  waitForTx(txHash: string, options?: WaitForTxOptions): Promise<Contract.FinalizedTxData>;

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
    loadContract<M extends Contract.ContractModule>(
      options: Contract.LoadContractOptions<M>,
    ): Effect.Effect<Contract.LoadedContract<Contract.InferLedger<M>, Contract.InferCircuits<M>, Contract.InferActions<M>>, ClientError>;
    waitForTx(txHash: string, options?: WaitForTxOptions): Effect.Effect<Contract.FinalizedTxData, ClientError | TxTimeoutError>;
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
  walletContext: Wallet.WalletContext,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ClientError> {
  return Wallet.effect.providers(walletContext, { txTtlMs: options.txTtlMs }).pipe(
    Effect.map(({ walletProvider, midnightProvider }) => {
      const { networkConfig, privateStateProvider, feeRelayWallet, txTtlMs } = options;

      setNetworkId(networkConfig.networkId as 'undeployed');

      // Fee relay: use relay wallet for balancing/submitting, user wallet for ZK proofs
      const feeWalletCtx = feeRelayWallet ?? walletContext;

      const publicDataProvider = Config.publicDataProvider(networkConfig);

      const { walletProvider: effectiveWalletProvider, midnightProvider: effectiveMidnightProvider } = feeRelayWallet
        ? FeeRelay.applySeedRelay(feeWalletCtx, walletProvider, { txTtlMs })
        : { walletProvider, midnightProvider };

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
// Wallet Acquisition Helpers
// =============================================================================

/**
 * Init + sync a wallet.
 * On success, caller owns the WalletContext and is responsible for closing it.
 * On failure, no cleanup is performed — use the Scoped variant if you want
 * automatic resource management.
 */
function initWalletEffect(
  seed: string,
  networkConfig: Config.NetworkConfig,
  label: string,
): Effect.Effect<Wallet.WalletContext, ClientError> {
  return Effect.gen(function* () {
    yield* Effect.logDebug(`Initializing ${label}...`);
    const ctx = yield* Wallet.effect.init(seed, networkConfig).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to initialize ${label}: ${e.message}`,
          }),
      ),
    );

    yield* Wallet.effect.waitForSync(ctx).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to sync ${label}: ${e.message}`,
          }),
      ),
    );
    yield* Effect.logDebug(`${label} synced`);
    return ctx;
  });
}

// =============================================================================
// Shared Helpers
// =============================================================================

/**
 * ConnectedWallet path — builds providers from a pre-created wallet.
 * No owned resources.
 */
function createConnectedWalletProviders(
  connectedWallet: Wallet.ConnectedWallet,
  networkConfig: Config.NetworkConfig,
  privateStateProvider: PrivateStateProvider,
  feeRelay?: { seed: string } | { url: string },
): Effect.Effect<BaseProviders, ClientError> {
  return Effect.gen(function* () {
    yield* Effect.logDebug('Using pre-created wallet...');

    let { walletProvider, midnightProvider } = yield* connectedWallet.effect.providers().pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to get wallet providers: ${e.message}`,
          }),
      ),
    );

    if (feeRelay && 'url' in feeRelay) {
      yield* Effect.logDebug(`Using fee relay server at ${feeRelay.url}`);
      ({ walletProvider, midnightProvider } = FeeRelay.applyHttpRelay(feeRelay.url, walletProvider));
    } else if (feeRelay && 'seed' in feeRelay) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('Seed-based fee relay not supported with ConnectedWallet'),
          message: 'Seed-based fee relay ({ seed }) is not supported with a pre-created wallet. Use { url } for browser wallets.',
        }),
      );
    }

    setNetworkId(networkConfig.networkId as 'undeployed');
    const publicDataProvider = Config.publicDataProvider(networkConfig);

    return {
      walletProvider,
      midnightProvider,
      publicDataProvider,
      privateStateProvider,
      networkConfig,
    };
  });
}

/** Extract NetworkConfig from a WalletConnection. */
function connectionNetworkConfig(connection: Wallet.WalletConnection): Config.NetworkConfig {
  return {
    networkId: connection.config.networkId,
    indexer: connection.config.indexerUri,
    indexerWS: connection.config.indexerWsUri,
    node: connection.config.substrateNodeUri,
    proofServer: connection.config.proverServerUri ?? '',
  };
}

// =============================================================================
// Client Effect Implementations
// =============================================================================

function createEffect(config: ClientConfig): Effect.Effect<MiddayClient, ClientError> {
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
      txTtlMs,
    } = config;

    const networkConfig = customNetworkConfig ?? Config.getNetworkConfig(network);

    // Path 1: Pre-created ConnectedWallet
    if (connectedWallet) {
      const providers = yield* createConnectedWalletProviders(
        connectedWallet, networkConfig, privateStateProvider, feeRelay,
      );
      return buildClient({
        networkConfig,
        providers,
        logging,
      });
    }

    // Path 2: Seed-based initialization
    const walletSeed = seed ?? (network === 'local' ? Config.DEV_WALLET_SEED : undefined);
    if (!walletSeed) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('Missing seed'),
          message: 'Wallet seed is required for non-local networks. Provide via config.seed or config.wallet.',
        }),
      );
    }

    if (feeRelay && 'url' in feeRelay) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('URL-based fee relay not supported with Client.create'),
          message: 'URL-based fee relay ({ url }) is only supported with Client.fromWallet. Use { seed } for Client.create.',
        }),
      );
    }

    const walletContext = yield* initWalletEffect(walletSeed, networkConfig, 'wallet');

    let relayerWallet: Wallet.WalletContext | null = null;
    if (feeRelay && 'seed' in feeRelay) {
      relayerWallet = yield* initWalletEffect(feeRelay.seed, networkConfig, 'fee relay wallet');
    }

    const providers = yield* createBaseProvidersEffect(walletContext, {
      networkConfig,
      privateStateProvider,
      storageConfig: storage,
      feeRelayWallet: relayerWallet ?? undefined,
      txTtlMs,
    });

    return buildClient({
      networkConfig,
      providers,
      logging,
      close: Effect.gen(function* () {
        if (relayerWallet) yield* Wallet.effect.close(relayerWallet);
        yield* Wallet.effect.close(walletContext);
      }).pipe(
        Effect.mapError(
          (e) => new ClientError({ cause: e, message: `Failed to close client: ${e.message}` }),
        ),
      ),
    });
  });
}

function fromWalletEffect(
  connection: Wallet.WalletConnection,
  config: FromWalletConfig,
): Effect.Effect<MiddayClient, ClientError> {
  return Effect.gen(function* () {
    const { privateStateProvider, logging = true, feeRelay, txTtlMs } = config;
    const networkConfig = connectionNetworkConfig(connection);

    let relayerWallet: Wallet.WalletContext | null = null;
    if (feeRelay && 'seed' in feeRelay) {
      relayerWallet = yield* initWalletEffect(feeRelay.seed, networkConfig, 'fee relay wallet');
    }

    let { walletProvider, midnightProvider } = Wallet.createWalletProviders(connection.wallet, connection.addresses);

    if (relayerWallet && feeRelay && 'seed' in feeRelay) {
      ({ walletProvider, midnightProvider } = FeeRelay.applySeedRelay(relayerWallet, walletProvider, { txTtlMs }));
    } else if (feeRelay && 'url' in feeRelay) {
      yield* Effect.logDebug(`Using fee relay server at ${feeRelay.url}`);
      ({ walletProvider, midnightProvider } = FeeRelay.applyHttpRelay(feeRelay.url, walletProvider));
    }

    setNetworkId(networkConfig.networkId as 'undeployed');
    const publicDataProvider = Config.publicDataProvider(networkConfig);

    yield* Effect.logDebug('Connected to wallet');

    const providers: BaseProviders = {
      walletProvider,
      midnightProvider,
      publicDataProvider,
      privateStateProvider,
      networkConfig,
    };

    return buildClient({
      networkConfig,
      providers,
      logging,
      close: relayerWallet
        ? Wallet.effect.close(relayerWallet).pipe(
            Effect.mapError(
              (e) => new ClientError({ cause: e, message: `Failed to close client: ${e.message}` }),
            ),
          )
        : undefined,
    });
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

// =============================================================================
// Handle Factory
// =============================================================================

function buildClient(args: {
  networkConfig: Config.NetworkConfig;
  providers: BaseProviders;
  logging: boolean;
  close?: Effect.Effect<void, ClientError>;
}): MiddayClient {
  const { networkConfig, providers, logging, close: closeEff = Effect.void } = args;

  const loadContractEff = (options: Contract.LoadContractOptions) =>
    Contract.loadContractModuleEffect(options, networkConfig, providers, logging).pipe(
      Effect.mapError((e) => new ClientError({ cause: e, message: e.message })),
    );

  const waitForTxEff = (txHash: string, options?: WaitForTxOptions) => {
    const base = Effect.tryPromise({
      try: async () => {
        const data = await providers.publicDataProvider.watchForTxData(txHash);
        return { txHash: data.txHash, blockHeight: data.blockHeight, blockHash: data.blockHash };
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
  };

  return {
    networkConfig,
    providers,

    loadContract: async <M extends Contract.ContractModule>(options: Contract.LoadContractOptions<M>) => {
      const contractData = await Runtime.runEffectWithLogging(loadContractEff(options), logging);
      return Contract.createLoadedContractHandle(contractData) as Contract.LoadedContract<Contract.InferLedger<M>, Contract.InferCircuits<M>, Contract.InferActions<M>>;
    },
    waitForTx: (txHash, options?) =>
      Runtime.runEffectWithLogging(waitForTxEff(txHash, options), logging),
    close: () => Runtime.runEffectWithLogging(closeEff, logging),
    [Symbol.asyncDispose]: () => Runtime.runEffectWithLogging(closeEff, logging),

    effect: {
      loadContract: <M extends Contract.ContractModule>(options: Contract.LoadContractOptions<M>) =>
        loadContractEff(options).pipe(
          Effect.map((contractData) => Contract.createLoadedContractHandle(contractData) as Contract.LoadedContract<Contract.InferLedger<M>, Contract.InferCircuits<M>, Contract.InferActions<M>>),
        ),
      waitForTx: (txHash, options?) => waitForTxEff(txHash, options),
      close: () => closeEff,
    },
  };
}

function createReadonlyHandle(
  networkConfig: Config.NetworkConfig,
  provider: Contract.PublicDataProvider,
): ReadonlyClient {
  return {
    networkConfig,
    provider,

    loadContract: <M extends Contract.ContractModule>(options: { module: M }) =>
      Contract.createReadonlyContractHandle(options.module.ledger, provider) as Contract.ReadonlyContract<Contract.InferLedger<M>>,
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
 * **Constraint:** Only one network ID is supported per process — see {@link ClientConfig}.
 *
 * @since 0.2.0
 * @category constructors
 */
export async function create(config: ClientConfig): Promise<MiddayClient> {
  const logging = config.logging ?? true;
  return Runtime.runEffectWithLogging(createEffect(config), logging);
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
  return createReadonlyHandle(networkConfig, provider);
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
 * Both fee relay variants are supported here:
 * - `{ seed }` — initialises a local relay wallet (Node.js integration tests)
 * - `{ url }` — proxies to a remote HTTP fee relay server (browser)
 *
 * @since 0.2.0
 * @category constructors
 */
export async function fromWallet(
  connection: Wallet.WalletConnection,
  config: FromWalletConfig,
): Promise<MiddayClient> {
  const logging = config.logging ?? true;
  return Runtime.runEffectWithLogging(fromWalletEffect(connection, config), logging);
}

/**
 * Raw Effect APIs for advanced users who want to compose Effects.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  create: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError> =>
    createEffect(config),

  createScoped: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError, Scope.Scope> =>
    Effect.acquireRelease(
      createEffect(config),
      (client) => client.effect.close().pipe(Effect.orDie),
    ),

  withClient: <A, E>(
    config: ClientConfig,
    body: (client: MiddayClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ClientError> =>
    Effect.scoped(
      Effect.acquireRelease(
        createEffect(config),
        (client) => client.effect.close().pipe(Effect.orDie),
      ).pipe(Effect.flatMap(body)),
    ),

  fromWallet: (
    connection: Wallet.WalletConnection,
    config: FromWalletConfig,
  ): Effect.Effect<MiddayClient, ClientError> =>
    fromWalletEffect(connection, config),

  fromWalletScoped: (
    connection: Wallet.WalletConnection,
    config: FromWalletConfig,
  ): Effect.Effect<MiddayClient, ClientError, Scope.Scope> =>
    Effect.acquireRelease(
      fromWalletEffect(connection, config),
      (client) => client.effect.close().pipe(Effect.orDie),
    ),

  createReadonly: (config: ReadonlyClientConfig = {}): ReadonlyClient =>
    createReadonly(config),
};

// =============================================================================
// Effect DI
// =============================================================================

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
  connection: Wallet.WalletConnection,
  config: FromWalletConfig,
): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.scoped(MiddayClientService, effect.fromWalletScoped(connection, config));
}
