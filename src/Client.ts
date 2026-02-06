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

import { Context, Data, Effect, Layer, Scope } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {
  WalletProvider,
  MidnightProvider,
  ZKConfigProvider,
  PrivateStateProvider,
  UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';

import * as Config from './Config.js';
import * as Wallet from './Wallet.js';
import type { NetworkConfig } from './Config.js';
import type { WalletContext } from './Wallet.js';
import type { WalletConnection, WalletProviders } from './Wallet.js';
import type {
  Contract,
  ContractModule,
  InferLedger,
  InferCircuits,
  LoadContractOptions,
  ContractData,
  FinalizedTxData,
} from './Contract.js';
import { loadContractModuleEffect, createContractHandle } from './Contract.js';
import { runEffectWithLogging } from './Runtime.js';

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
  /** Wallet seed (required for non-local networks) */
  seed?: string;
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
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
  readonly networkConfig: NetworkConfig;
  readonly providers: BaseProviders;
  readonly logging: boolean;
}

// =============================================================================
// Public Handle Interfaces
// =============================================================================

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

  /**
   * Load a contract module. Returns a Contract in "loaded" state.
   * Call `deploy()` or `join()` on it to connect to the network.
   *
   * @typeParam M - Contract module type (inferred from options.module)
   */
  loadContract<M extends ContractModule>(
    options: LoadContractOptions<M>,
  ): Promise<Contract<InferLedger<M>, InferCircuits<M>>>;

  /** Wait for a transaction to be finalized. */
  waitForTx(txHash: string): Promise<FinalizedTxData>;

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
    ): Effect.Effect<Contract<InferLedger<M>, InferCircuits<M>>, ClientError>;
    waitForTx(txHash: string): Effect.Effect<FinalizedTxData, ClientError>;
    close(): Effect.Effect<void, ClientError>;
  };
}

// =============================================================================
// Provider Factory Functions (absorbed from Providers module)
// =============================================================================

function createBaseProvidersEffect(
  walletContext: WalletContext,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ClientError> {
  return Effect.try({
    try: () => {
      const { networkConfig, privateStateProvider } = options;

      setNetworkId(networkConfig.networkId as 'undeployed');

      const walletProvider: WalletProvider = {
        getCoinPublicKey: () => walletContext.shieldedSecretKeys.coinPublicKey as unknown as ledger.CoinPublicKey,
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

      const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

      return {
        walletProvider,
        midnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      };
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to create base providers: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function createBaseFromWalletProvidersEffect(
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  options: CreateBaseProvidersOptions,
): Effect.Effect<BaseProviders, ClientError> {
  return Effect.try({
    try: () => {
      const { networkConfig, privateStateProvider } = options;

      setNetworkId(networkConfig.networkId as 'undeployed');

      const publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);

      return {
        walletProvider,
        midnightProvider,
        publicDataProvider,
        privateStateProvider,
        networkConfig,
      };
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to create base providers from wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Client Effect Implementations
// =============================================================================

function createClientDataEffect(config: ClientConfig): Effect.Effect<ClientData, ClientError> {
  return Effect.gen(function* () {
    const {
      network = 'local',
      networkConfig: customNetworkConfig,
      seed,
      privateStateProvider,
      storage,
      logging = true,
    } = config;

    const networkConfig = customNetworkConfig ?? Config.getNetworkConfig(network);

    const walletSeed = seed ?? (network === 'local' ? Config.DEV_WALLET_SEED : undefined);
    if (!walletSeed) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('Missing seed'),
          message: 'Wallet seed is required for non-local networks. Provide via config.seed.',
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

    const providerOptions: CreateBaseProvidersOptions = {
      networkConfig,
      privateStateProvider,
      storageConfig: storage,
    };

    const providers = yield* createBaseProvidersEffect(walletContext, providerOptions);

    return {
      wallet: walletContext,
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
  },
): Effect.Effect<ClientData, ClientError> {
  return Effect.gen(function* () {
    const { privateStateProvider, logging = true } = config;

    const networkConfig: NetworkConfig = {
      networkId: connection.config.networkId,
      indexer: connection.config.indexerUri,
      indexerWS: connection.config.indexerWsUri,
      node: connection.config.substrateNodeUri,
      proofServer: connection.config.proverServerUri ?? '',
    };

    const { walletProvider, midnightProvider } = Wallet.createWalletProviders(
      connection.wallet,
      connection.addresses,
    );

    const providerOptions: CreateBaseProvidersOptions = {
      networkConfig,
      privateStateProvider,
    };

    const providers = yield* createBaseFromWalletProvidersEffect(
      walletProvider,
      midnightProvider,
      providerOptions,
    );

    yield* Effect.logDebug('Connected to wallet');

    return {
      wallet: null,
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
): Effect.Effect<ContractData, ClientError> {
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
): Effect.Effect<FinalizedTxData, ClientError> {
  return Effect.tryPromise({
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
}

function closeClientEffect(data: ClientData): Effect.Effect<void, ClientError> {
  return Effect.gen(function* () {
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

    loadContract: async <M extends ContractModule>(options: LoadContractOptions<M>) => {
      const contractData = await runEffectWithLogging(
        loadContractEffect(data, options),
        data.logging,
      );
      return createContractHandle(contractData) as Contract<InferLedger<M>, InferCircuits<M>>;
    },
    waitForTx: (txHash) =>
      runEffectWithLogging(waitForTxEffect(data, txHash), data.logging),
    close: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    [Symbol.asyncDispose]: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    effect: {
      loadContract: <M extends ContractModule>(options: LoadContractOptions<M>) =>
        loadContractEffect(data, options).pipe(
          Effect.map((contractData) => createContractHandle(contractData) as Contract<InferLedger<M>, InferCircuits<M>>),
        ),
      waitForTx: (txHash) => waitForTxEffect(data, txHash),
      close: () => closeClientEffect(data),
    },
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
 * const contract = await client.loadContract({ path: './contracts/counter' });
 * await contract.deploy();
 * await contract.call('increment');
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
    },
  ): Effect.Effect<MiddayClient, ClientError> =>
    fromWalletDataEffect(connection, config).pipe(Effect.map(createClientHandle)),
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
 *
 * @since 0.3.0
 * @category layer
 */
export function layer(config: ClientConfig): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.effect(MiddayClientService, effect.create(config));
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
  },
): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.effect(MiddayClientService, effect.fromWallet(connection, config));
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
