/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * Provides a simple API for deploying, joining, and calling contracts.
 * Supports both seed-based (Node.js/browser) and wallet-based (browser) initialization.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.1.0
 * @module
 */

import { Effect } from 'effect';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ZKConfigProvider, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import * as Config from './Config.js';
import * as Wallet from './Wallet.js';
import * as Providers from './Providers.js';
import type { NetworkConfig } from './Config.js';
import type { ContractProviders, StorageConfig, CreateProvidersOptions } from './Providers.js';
import type { WalletContext } from './Wallet.js';
import type { WalletConnection } from './wallet/connector.js';
import { createWalletProviders } from './wallet/provider.js';
import { ClientError, ContractError } from './errors/index.js';
import { runEffectPromise } from './utils/effect-runtime.js';
import type { EffectToPromiseAPI } from './sdk/Type.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for client operations.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface ClientConfig {
  /** Network to connect to (default: 'local') */
  network?: string;
  /** Custom network configuration (overrides network preset) */
  networkConfig?: NetworkConfig;
  /** Wallet seed (required for non-local networks) */
  seed?: string;
  /** ZK configuration provider (required) */
  zkConfigProvider: ZKConfigProvider<string>;
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
  logging?: boolean;
}

export interface ContractFromOptions {
  /** Contract module (required in browser) */
  module?: ContractModule;
  /** URL to fetch ZK config from (for HttpZkConfigProvider) */
  zkConfigUrl?: string;
  /** Witnesses for the contract */
  witnesses?: Record<string, unknown>;
  /** Override privateStateId (defaults to contract name) */
  privateStateId?: string;
}

export interface DeployOptions {
  /** Initial private state (defaults to {}) */
  initialPrivateState?: unknown;
}

export interface JoinOptions {
  /** Initial private state (defaults to {}) */
  initialPrivateState?: unknown;
}

export interface FinalizedTxData {
  txHash: string;
  blockHeight: number;
  blockHash: string;
}

export interface ContractModule {
  Contract: new (witnesses: unknown) => unknown;
  ledger: (state: unknown) => unknown;
}

export interface LoadedContractModule {
  Contract: new (witnesses: unknown) => unknown;
  ledger: (state: unknown) => unknown;
  privateStateId: string;
  witnesses: Record<string, unknown>;
}

export interface CallResult {
  txHash: string;
  blockHeight: number;
  status: string;
}

// =============================================================================
// Effect-based Interfaces
// =============================================================================

/**
 * Effect-based interface for MidnightClient.
 */
export interface MidnightClientEffect {
  readonly contractFrom: (options: ContractFromOptions) => Effect.Effect<ContractBuilder, ClientError>;
  readonly waitForTx: (txHash: string) => Effect.Effect<FinalizedTxData, ClientError>;
}

/**
 * Effect-based interface for ContractBuilder.
 */
export interface ContractBuilderEffect {
  readonly deploy: (options?: DeployOptions) => Effect.Effect<ConnectedContract, ContractError>;
  readonly join: (address: string, options?: JoinOptions) => Effect.Effect<ConnectedContract, ContractError>;
}

/**
 * Effect-based interface for ConnectedContract.
 */
export interface ConnectedContractEffect {
  readonly call: (action: string, ...args: unknown[]) => Effect.Effect<CallResult, ContractError>;
  readonly state: () => Effect.Effect<unknown, ContractError>;
  readonly stateAt: (blockHeight: number) => Effect.Effect<unknown, ContractError>;
  readonly ledgerState: () => Effect.Effect<unknown, ContractError>;
  readonly ledgerStateAt: (blockHeight: number) => Effect.Effect<unknown, ContractError>;
}

// =============================================================================
// Promise-based Interfaces (backwards compatible)
// =============================================================================

export interface MidnightClient extends EffectToPromiseAPI<MidnightClientEffect> {
  /** Raw wallet context for advanced use (null if using wallet connector) */
  readonly wallet: WalletContext | null;
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Logger instance */
  readonly logger: Logger;
  /** Effect-based API */
  readonly Effect: MidnightClientEffect;
}

export interface ContractBuilder extends EffectToPromiseAPI<ContractBuilderEffect> {
  /** The loaded contract module */
  readonly module: LoadedContractModule;
  /** Effect-based API */
  readonly Effect: ContractBuilderEffect;
}

export interface ConnectedContract extends EffectToPromiseAPI<ConnectedContractEffect> {
  /** The deployed contract address */
  readonly address: string;
  /** The underlying contract instance */
  readonly instance: unknown;
  /** The loaded module (for ledger access) */
  readonly module: LoadedContractModule;
  /** Raw providers */
  readonly providers: ContractProviders;
  /** Logger */
  readonly logger: Logger;
  /** Effect-based API */
  readonly Effect: ConnectedContractEffect;
}

// =============================================================================
// Logger
// =============================================================================

function createLogger(enabled: boolean): Logger {
  if (!enabled) {
    return {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
  }

  return {
    info: (message: string) => console.log(`[INFO] ${message}`),
    warn: (message: string) => console.warn(`[WARN] ${message}`),
    error: (message: string) => console.error(`[ERROR] ${message}`),
    debug: (message: string) => console.debug(`[DEBUG] ${message}`),
  };
}

// =============================================================================
// Effect API - Client Factory
// =============================================================================

/**
 * Effect-based client creation from config.
 */
function createEffect(config: ClientConfig): Effect.Effect<MidnightClient, ClientError> {
  return Effect.gen(function* () {
    const {
      network = 'local',
      networkConfig: customNetworkConfig,
      seed,
      zkConfigProvider,
      privateStateProvider,
      storage,
      logging = true,
    } = config;

    const logger = createLogger(logging);

    // Resolve network configuration
    const networkConfig = customNetworkConfig ?? Config.getNetworkConfig(network);

    // Resolve seed (use dev wallet only for local network)
    const walletSeed = seed ?? (network === 'local' ? Config.DEV_WALLET_SEED : undefined);
    if (!walletSeed) {
      return yield* Effect.fail(
        new ClientError({
          cause: new Error('Missing seed'),
          message: 'Wallet seed is required for non-local networks. Provide via config.seed.',
        }),
      );
    }

    // Initialize wallet
    logger.info('Initializing wallet...');
    const walletContext = yield* Wallet.Effect.init(walletSeed, networkConfig).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to initialize wallet: ${e.message}`,
          }),
      ),
    );

    yield* Wallet.Effect.waitForSync(walletContext).pipe(
      Effect.mapError(
        (e) =>
          new ClientError({
            cause: e,
            message: `Failed to sync wallet: ${e.message}`,
          }),
      ),
    );
    logger.info('Wallet synced');

    const providerOptions: CreateProvidersOptions = {
      networkConfig,
      zkConfigProvider,
      privateStateProvider,
      storageConfig: storage,
    };

    return createClientInternal(walletContext, null, providerOptions, logger);
  });
}

/**
 * Effect-based client creation from wallet connection.
 */
function fromWalletEffect(
  connection: WalletConnection,
  config: {
    zkConfigProvider: ZKConfigProvider<string>;
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
  },
): Effect.Effect<MidnightClient, ClientError> {
  return Effect.try({
    try: () => {
      const { zkConfigProvider, privateStateProvider, logging = true } = config;
      const logger = createLogger(logging);

      // Create network config from wallet configuration
      const networkConfig: NetworkConfig = {
        networkId: connection.config.networkId,
        indexer: connection.config.indexerUri,
        indexerWS: connection.config.indexerWsUri,
        node: connection.config.substrateNodeUri,
        proofServer: connection.config.proverServerUri ?? '',
      };

      // Create wallet providers from connection
      const { walletProvider, midnightProvider } = createWalletProviders(connection.wallet, connection.addresses);

      const providerOptions: CreateProvidersOptions = {
        networkConfig,
        zkConfigProvider,
        privateStateProvider,
      };

      // Create providers using the wallet providers
      const providers = Providers.createFromWalletProviders(walletProvider, midnightProvider, providerOptions);

      logger.info('Connected to wallet');

      return createClientFromProviders(null, providers, networkConfig, logger);
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to create client from wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Effect-based API for client creation.
 */
export interface ClientEffect {
  readonly create: (config: ClientConfig) => Effect.Effect<MidnightClient, ClientError>;
  readonly fromWallet: (
    connection: WalletConnection,
    config: {
      zkConfigProvider: ZKConfigProvider<string>;
      privateStateProvider: PrivateStateProvider;
      logging?: boolean;
    },
  ) => Effect.Effect<MidnightClient, ClientError>;
}

export const ClientEffectAPI: ClientEffect = {
  create: createEffect,
  fromWallet: fromWalletEffect,
};

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Create client from providers (used by both wallet and seed paths).
 */
function createClientFromProviders(
  walletContext: WalletContext | null,
  providers: ContractProviders,
  networkConfig: NetworkConfig,
  logger: Logger,
): MidnightClient {
  // Effect implementations
  function contractFromEffect(options: ContractFromOptions): Effect.Effect<ContractBuilder, ClientError> {
    return Effect.try({
      try: () => {
        if (!options.module) {
          throw new Error('Contract module is required. Import and pass the contract module.');
        }

        const module: LoadedContractModule = {
          Contract: options.module.Contract,
          ledger: options.module.ledger,
          privateStateId: options.privateStateId ?? 'contract',
          witnesses: options.witnesses ?? {},
        };

        return createContractBuilder(module, providers, logger);
      },
      catch: (cause) =>
        new ClientError({
          cause,
          message: `Failed to load contract: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function waitForTxEffect(txHash: string): Effect.Effect<FinalizedTxData, ClientError> {
    return Effect.tryPromise({
      try: async () => {
        const data = await providers.publicDataProvider.watchForTxData(txHash);
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

  const effectAPI: MidnightClientEffect = {
    contractFrom: contractFromEffect,
    waitForTx: waitForTxEffect,
  };

  return {
    wallet: walletContext,
    networkConfig,
    logger,
    Effect: effectAPI,

    async contractFrom(options: ContractFromOptions): Promise<ContractBuilder> {
      return runEffectPromise(contractFromEffect(options));
    },

    async waitForTx(txHash: string): Promise<FinalizedTxData> {
      return runEffectPromise(waitForTxEffect(txHash));
    },
  };
}

/**
 * Internal client factory.
 */
function createClientInternal(
  walletContext: WalletContext | null,
  walletProviders: { walletProvider: Providers.ContractProviders['walletProvider']; midnightProvider: Providers.ContractProviders['midnightProvider'] } | null,
  providerOptions: CreateProvidersOptions,
  logger: Logger,
): MidnightClient {
  const { networkConfig } = providerOptions;

  // Effect implementations
  function contractFromEffect(options: ContractFromOptions): Effect.Effect<ContractBuilder, ClientError> {
    return Effect.try({
      try: () => {
        if (!options.module) {
          throw new Error('Contract module is required. Import and pass the contract module.');
        }

        const module: LoadedContractModule = {
          Contract: options.module.Contract,
          ledger: options.module.ledger,
          privateStateId: options.privateStateId ?? 'contract',
          witnesses: options.witnesses ?? {},
        };

        let providers: ContractProviders;

        if (walletContext) {
          providers = Providers.create(walletContext, providerOptions);
        } else if (walletProviders) {
          providers = Providers.createFromWalletProviders(
            walletProviders.walletProvider,
            walletProviders.midnightProvider,
            providerOptions,
          );
        } else {
          throw new Error('Either walletContext or walletProviders must be provided');
        }

        return createContractBuilder(module, providers, logger);
      },
      catch: (cause) =>
        new ClientError({
          cause,
          message: `Failed to load contract: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function waitForTxEffect(txHash: string): Effect.Effect<FinalizedTxData, ClientError> {
    return Effect.tryPromise({
      try: async () => {
        let providers: ContractProviders;

        if (walletContext) {
          providers = Providers.create(walletContext, providerOptions);
        } else if (walletProviders) {
          providers = Providers.createFromWalletProviders(
            walletProviders.walletProvider,
            walletProviders.midnightProvider,
            providerOptions,
          );
        } else {
          throw new Error('Either walletContext or walletProviders must be provided');
        }

        const data = await providers.publicDataProvider.watchForTxData(txHash);
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

  const effectAPI: MidnightClientEffect = {
    contractFrom: contractFromEffect,
    waitForTx: waitForTxEffect,
  };

  return {
    wallet: walletContext,
    networkConfig,
    logger,
    Effect: effectAPI,

    async contractFrom(options: ContractFromOptions): Promise<ContractBuilder> {
      return runEffectPromise(contractFromEffect(options));
    },

    async waitForTx(txHash: string): Promise<FinalizedTxData> {
      return runEffectPromise(waitForTxEffect(txHash));
    },
  };
}

// =============================================================================
// Contract Builder
// =============================================================================

function createContractBuilder(
  module: LoadedContractModule,
  providers: ContractProviders,
  logger: Logger,
): ContractBuilder {
  // Effect implementations
  function deployEffect(options?: DeployOptions): Effect.Effect<ConnectedContract, ContractError> {
    return Effect.tryPromise({
      try: async () => {
        const { initialPrivateState = {} } = options ?? {};

        logger.info('Deploying contract...');

        const ContractClass = module.Contract as new (witnesses: unknown) => unknown;
        const contract = new ContractClass(module.witnesses);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deployed = await deployContract(providers as any, {
          contract,
          privateStateId: module.privateStateId,
          initialPrivateState,
        } as any);

        const address = (deployed as any).deployTxData.public.contractAddress;

        logger.info(`Contract deployed at: ${address}`);

        return createConnectedContract(address, deployed, module, providers, logger);
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to deploy contract: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function joinEffect(address: string, options?: JoinOptions): Effect.Effect<ConnectedContract, ContractError> {
    return Effect.tryPromise({
      try: async () => {
        const { initialPrivateState = {} } = options ?? {};

        logger.info(`Joining contract at ${address}...`);

        const ContractClass = module.Contract as new (witnesses: unknown) => unknown;
        const contract = new ContractClass(module.witnesses);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deployed = await findDeployedContract(providers as any, {
          contractAddress: address,
          contract,
          privateStateId: module.privateStateId,
          initialPrivateState,
        } as any);

        logger.info('Contract joined');

        return createConnectedContract(address, deployed, module, providers, logger);
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to join contract at ${address}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  const effectAPI: ContractBuilderEffect = {
    deploy: deployEffect,
    join: joinEffect,
  };

  return {
    module,
    Effect: effectAPI,

    async deploy(options?: DeployOptions): Promise<ConnectedContract> {
      return runEffectPromise(deployEffect(options));
    },

    async join(address: string, options?: JoinOptions): Promise<ConnectedContract> {
      return runEffectPromise(joinEffect(address, options));
    },
  };
}

// =============================================================================
// Connected Contract
// =============================================================================

interface DeployedContractInstance {
  callTx: Record<string, (...args: unknown[]) => Promise<{ public: { txHash: string; blockHeight: number; status: string } }>>;
}

function createConnectedContract(
  address: string,
  instance: unknown,
  module: LoadedContractModule,
  providers: ContractProviders,
  logger: Logger,
): ConnectedContract {
  // Effect implementations
  function callEffect(action: string, ...args: unknown[]): Effect.Effect<CallResult, ContractError> {
    return Effect.tryPromise({
      try: async () => {
        logger.info(`Calling ${action}()...`);

        const deployed = instance as DeployedContractInstance;
        const callTx = deployed.callTx;
        if (!callTx || typeof callTx[action] !== 'function') {
          throw new Error(`Unknown action: ${action}. Available: ${Object.keys(callTx || {}).join(', ')}`);
        }

        const txData = await callTx[action](...args);

        logger.info('Transaction submitted');
        logger.info(`  TX Hash: ${txData.public.txHash}`);
        logger.info(`  Block: ${txData.public.blockHeight}`);

        return {
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
          status: txData.public.status,
        };
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to call ${action}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function stateEffect(): Effect.Effect<unknown, ContractError> {
    return Effect.tryPromise({
      try: async () => {
        const contractState = await providers.publicDataProvider.queryContractState(address);
        if (!contractState) {
          throw new Error(`Contract state not found at ${address}`);
        }
        return contractState.data;
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to query contract state: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function stateAtEffect(blockHeight: number): Effect.Effect<unknown, ContractError> {
    return Effect.tryPromise({
      try: async () => {
        const contractState = await providers.publicDataProvider.queryContractState(address, {
          type: 'blockHeight',
          blockHeight,
        });
        if (!contractState) {
          throw new Error(`Contract state not found at ${address} at block ${blockHeight}`);
        }
        return contractState.data;
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to query contract state at block ${blockHeight}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function ledgerStateEffect(): Effect.Effect<unknown, ContractError> {
    return stateEffect().pipe(Effect.map((data) => module.ledger(data)));
  }

  function ledgerStateAtEffect(blockHeight: number): Effect.Effect<unknown, ContractError> {
    return stateAtEffect(blockHeight).pipe(Effect.map((data) => module.ledger(data)));
  }

  const effectAPI: ConnectedContractEffect = {
    call: callEffect,
    state: stateEffect,
    stateAt: stateAtEffect,
    ledgerState: ledgerStateEffect,
    ledgerStateAt: ledgerStateAtEffect,
  };

  return {
    address,
    instance,
    module,
    providers,
    logger,
    Effect: effectAPI,

    async call(action: string, ...args: unknown[]): Promise<CallResult> {
      return runEffectPromise(callEffect(action, ...args));
    },

    async state(): Promise<unknown> {
      return runEffectPromise(stateEffect());
    },

    async stateAt(blockHeight: number): Promise<unknown> {
      return runEffectPromise(stateAtEffect(blockHeight));
    },

    async ledgerState(): Promise<unknown> {
      return runEffectPromise(ledgerStateEffect());
    },

    async ledgerStateAt(blockHeight: number): Promise<unknown> {
      return runEffectPromise(ledgerStateAtEffect(blockHeight));
    },
  };
}

// =============================================================================
// Promise API (backwards compatible)
// =============================================================================

/**
 * Create a Midnight client for interacting with contracts using a seed.
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * import { Effect } from 'effect';
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.Effect.create({
 *     seed: 'your-64-char-hex-seed',
 *     networkConfig: Midday.Config.NETWORKS.local,
 *     zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *     privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 *   });
 *
 *   const contract = yield* client.Effect.contractFrom({
 *     module: await import('./contracts/counter/index.js'),
 *   });
 *
 *   const deployed = yield* contract.Effect.deploy();
 *   const result = yield* deployed.Effect.call('increment');
 *
 *   return result;
 * });
 *
 * // Promise-based usage
 * const client = await Midday.Client.create({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 * });
 * ```
 */
export async function create(config: ClientConfig): Promise<MidnightClient> {
  return runEffectPromise(createEffect(config));
}

/**
 * Create a Midnight client from a connected wallet (browser).
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * const client = yield* Midday.Client.Effect.fromWallet(connection, {
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 *
 * // Promise-based usage
 * const client = await Midday.Client.fromWallet(connection, {
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 * ```
 */
export async function fromWallet(
  connection: WalletConnection,
  config: {
    zkConfigProvider: ZKConfigProvider<string>;
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
  },
): Promise<MidnightClient> {
  return runEffectPromise(fromWalletEffect(connection, config));
}

/**
 * Effect-based API export.
 */
export { ClientEffectAPI as Effect };
