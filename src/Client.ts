/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * ## API Design
 *
 * This module uses a **module-function pattern**:
 *
 * - **Stateless**: Functions operate on Client/Contract data
 * - **Module functions**: `Client.contractFrom(client, options)`, `Contract.deploy(builder)`
 * - **Data-oriented**: Client/Contract are plain data, not instances with methods
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user
 * const client = await Client.create(config);
 * const builder = await Client.contractFrom(client, { module });
 * const contract = await ContractBuilder.deploy(builder);
 * const result = await Contract.call(contract, 'increment');
 *
 * // Effect user
 * const client = yield* Client.effect.create(config);
 * const builder = yield* Client.effect.contractFrom(client, { module });
 * const contract = yield* ContractBuilder.effect.deploy(builder);
 * const result = yield* Contract.effect.call(contract, 'increment');
 * ```
 *
 * @since 0.1.0
 * @module
 */

import { Context, Data, Effect, Layer } from 'effect';
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
import { runEffectPromise } from './utils/effect-runtime.js';

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
 * Error during contract deployment or calls.
 *
 * @since 0.3.0
 * @category errors
 */
export class ContractError extends Data.TaggedError('ContractError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for client operations.
 *
 * @since 0.2.0
 * @category model
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

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
  /** ZK configuration provider (required) */
  zkConfigProvider: ZKConfigProvider<string>;
  /** Private state provider (required) */
  privateStateProvider: PrivateStateProvider;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
  logging?: boolean;
}

/**
 * Options for loading a contract.
 *
 * @since 0.2.0
 * @category model
 */
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

/**
 * Options for deploying a contract.
 *
 * @since 0.2.0
 * @category model
 */
export interface DeployOptions {
  /** Initial private state (defaults to {}) */
  initialPrivateState?: unknown;
}

/**
 * Options for joining a contract.
 *
 * @since 0.2.0
 * @category model
 */
export interface JoinOptions {
  /** Initial private state (defaults to {}) */
  initialPrivateState?: unknown;
}

/**
 * Data about a finalized transaction.
 *
 * @since 0.2.0
 * @category model
 */
export interface FinalizedTxData {
  txHash: string;
  blockHeight: number;
  blockHash: string;
}

/**
 * A contract module definition.
 *
 * @since 0.2.0
 * @category model
 */
export interface ContractModule {
  Contract: new (witnesses: unknown) => unknown;
  ledger: (state: unknown) => unknown;
}

/**
 * A loaded contract module with configuration.
 *
 * @since 0.2.0
 * @category model
 */
export interface LoadedContractModule {
  Contract: new (witnesses: unknown) => unknown;
  ledger: (state: unknown) => unknown;
  privateStateId: string;
  witnesses: Record<string, unknown>;
}

/**
 * Result of a contract call.
 *
 * @since 0.2.0
 * @category model
 */
export interface CallResult {
  txHash: string;
  blockHeight: number;
  status: string;
}

// =============================================================================
// Data Types (Plain Data, No Methods)
// =============================================================================

/**
 * Represents a Midnight client.
 *
 * This is plain data - use module functions to operate on it.
 *
 * @since 0.2.0
 * @category model
 */
export interface MidnightClient {
  /** Raw wallet context for advanced use (null if using wallet connector) */
  readonly wallet: WalletContext | null;
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Logger instance */
  readonly logger: Logger;
  /** Contract providers */
  readonly providers: ContractProviders;
}

/**
 * Represents a contract builder for deploying or joining contracts.
 *
 * This is plain data - use module functions to operate on it.
 *
 * @since 0.2.0
 * @category model
 */
export interface ContractBuilder {
  /** The loaded contract module */
  readonly module: LoadedContractModule;
  /** Contract providers */
  readonly providers: ContractProviders;
  /** Logger */
  readonly logger: Logger;
}

/**
 * Represents a connected contract.
 *
 * This is plain data - use module functions to operate on it.
 *
 * @since 0.2.0
 * @category model
 */
export interface ConnectedContract {
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
}

// =============================================================================
// Logger Factory
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
// Client - Internal Effect Implementations
// =============================================================================

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
    logger.info('Wallet synced');

    const providerOptions: CreateProvidersOptions = {
      networkConfig,
      zkConfigProvider,
      privateStateProvider,
      storageConfig: storage,
    };

    const providers = Providers.create(walletContext, providerOptions);

    return {
      wallet: walletContext,
      networkConfig,
      logger,
      providers,
    };
  });
}

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

      return {
        wallet: null,
        networkConfig,
        logger,
        providers,
      };
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to create client from wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function contractFromEffect(
  client: MidnightClient,
  options: ContractFromOptions,
): Effect.Effect<ContractBuilder, ClientError> {
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

      return {
        module,
        providers: client.providers,
        logger: client.logger,
      };
    },
    catch: (cause) =>
      new ClientError({
        cause,
        message: `Failed to load contract: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function waitForTxEffect(
  client: MidnightClient,
  txHash: string,
): Effect.Effect<FinalizedTxData, ClientError> {
  return Effect.tryPromise({
    try: async () => {
      const data = await client.providers.publicDataProvider.watchForTxData(txHash);
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

// =============================================================================
// Client - Promise API
// =============================================================================

/**
 * Create a Midnight client for interacting with contracts using a seed.
 *
 * @example
 * ```typescript
 * const client = await Client.create({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Config.NETWORKS.local,
 *   zkConfigProvider,
 *   privateStateProvider,
 * });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export async function create(config: ClientConfig): Promise<MidnightClient> {
  return runEffectPromise(createEffect(config));
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
    zkConfigProvider: ZKConfigProvider<string>;
    privateStateProvider: PrivateStateProvider;
    logging?: boolean;
  },
): Promise<MidnightClient> {
  return runEffectPromise(fromWalletEffect(connection, config));
}

/**
 * Load a contract module for a client.
 *
 * @example
 * ```typescript
 * const builder = await Client.contractFrom(client, {
 *   module: await import('./contracts/counter/index.js'),
 * });
 * ```
 *
 * @since 0.2.0
 * @category operations
 */
export async function contractFrom(
  client: MidnightClient,
  options: ContractFromOptions,
): Promise<ContractBuilder> {
  return runEffectPromise(contractFromEffect(client, options));
}

/**
 * Wait for a transaction to be finalized.
 *
 * @since 0.2.0
 * @category operations
 */
export async function waitForTx(
  client: MidnightClient,
  txHash: string,
): Promise<FinalizedTxData> {
  return runEffectPromise(waitForTxEffect(client, txHash));
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @example
 * ```typescript
 * const client = yield* Client.effect.create(config);
 * const builder = yield* Client.effect.contractFrom(client, { module });
 * ```
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  create: createEffect,
  fromWallet: fromWalletEffect,
  contractFrom: contractFromEffect,
  waitForTx: waitForTxEffect,
};

// =============================================================================
// ContractBuilder - Internal Effect Implementations
// =============================================================================

interface DeployedContractInstance {
  callTx: Record<string, (...args: unknown[]) => Promise<{ public: { txHash: string; blockHeight: number; status: string } }>>;
}

function deployEffect(
  builder: ContractBuilder,
  options?: DeployOptions,
): Effect.Effect<ConnectedContract, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const { initialPrivateState = {} } = options ?? {};
      const { module, providers, logger } = builder;

      logger.info('Deploying contract...');

      const ContractClass = module.Contract as new (witnesses: unknown) => unknown;
      const contract = new ContractClass(module.witnesses);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deployed = await deployContract(providers as any, {
        contract,
        privateStateId: module.privateStateId,
        initialPrivateState,
      } as any);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const address = (deployed as any).deployTxData.public.contractAddress;

      logger.info(`Contract deployed at: ${address}`);

      return {
        address,
        instance: deployed,
        module,
        providers,
        logger,
      };
    },
    catch: (cause) =>
      new ContractError({
        cause,
        message: `Failed to deploy contract: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function joinEffect(
  builder: ContractBuilder,
  address: string,
  options?: JoinOptions,
): Effect.Effect<ConnectedContract, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const { initialPrivateState = {} } = options ?? {};
      const { module, providers, logger } = builder;

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

      return {
        address,
        instance: deployed,
        module,
        providers,
        logger,
      };
    },
    catch: (cause) =>
      new ContractError({
        cause,
        message: `Failed to join contract at ${address}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// ContractBuilder - Promise API & Effect Namespace
// =============================================================================

/**
 * ContractBuilder module functions.
 *
 * @since 0.2.0
 * @category ContractBuilder
 */
export const ContractBuilder = {
  /**
   * Deploy a new contract instance.
   *
   * @example
   * ```typescript
   * const contract = await ContractBuilder.deploy(builder);
   * ```
   *
   * @since 0.2.0
   * @category lifecycle
   */
  deploy: async (builder: ContractBuilder, options?: DeployOptions): Promise<ConnectedContract> => {
    return runEffectPromise(deployEffect(builder, options));
  },

  /**
   * Join an existing contract.
   *
   * @example
   * ```typescript
   * const contract = await ContractBuilder.join(builder, '0x...');
   * ```
   *
   * @since 0.2.0
   * @category lifecycle
   */
  join: async (builder: ContractBuilder, address: string, options?: JoinOptions): Promise<ConnectedContract> => {
    return runEffectPromise(joinEffect(builder, address, options));
  },

  /**
   * Raw Effect APIs for ContractBuilder.
   *
   * @since 0.2.0
   * @category effect
   */
  effect: {
    deploy: deployEffect,
    join: joinEffect,
  },
};

// =============================================================================
// Contract - Internal Effect Implementations
// =============================================================================

function callEffect(
  contract: ConnectedContract,
  action: string,
  ...args: unknown[]
): Effect.Effect<CallResult, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const { instance, logger } = contract;
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

function stateEffect(contract: ConnectedContract): Effect.Effect<unknown, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const { address, providers } = contract;
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

function stateAtEffect(
  contract: ConnectedContract,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const { address, providers } = contract;
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

function ledgerStateEffect(contract: ConnectedContract): Effect.Effect<unknown, ContractError> {
  return stateEffect(contract).pipe(Effect.map((data) => contract.module.ledger(data)));
}

function ledgerStateAtEffect(
  contract: ConnectedContract,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  return stateAtEffect(contract, blockHeight).pipe(Effect.map((data) => contract.module.ledger(data)));
}

// =============================================================================
// Contract - Promise API & Effect Namespace
// =============================================================================

/**
 * Contract module functions.
 *
 * @since 0.2.0
 * @category Contract
 */
export const Contract = {
  /**
   * Call a contract action.
   *
   * @example
   * ```typescript
   * const result = await Contract.call(contract, 'increment');
   * ```
   *
   * @since 0.2.0
   * @category operations
   */
  call: async (contract: ConnectedContract, action: string, ...args: unknown[]): Promise<CallResult> => {
    return runEffectPromise(callEffect(contract, action, ...args));
  },

  /**
   * Get contract state.
   *
   * @since 0.2.0
   * @category inspection
   */
  state: async (contract: ConnectedContract): Promise<unknown> => {
    return runEffectPromise(stateEffect(contract));
  },

  /**
   * Get contract state at a specific block height.
   *
   * @since 0.2.0
   * @category inspection
   */
  stateAt: async (contract: ConnectedContract, blockHeight: number): Promise<unknown> => {
    return runEffectPromise(stateAtEffect(contract, blockHeight));
  },

  /**
   * Get ledger state (parsed through ledger function).
   *
   * @since 0.2.0
   * @category inspection
   */
  ledgerState: async (contract: ConnectedContract): Promise<unknown> => {
    return runEffectPromise(ledgerStateEffect(contract));
  },

  /**
   * Get ledger state at a specific block height.
   *
   * @since 0.2.0
   * @category inspection
   */
  ledgerStateAt: async (contract: ConnectedContract, blockHeight: number): Promise<unknown> => {
    return runEffectPromise(ledgerStateAtEffect(contract, blockHeight));
  },

  /**
   * Raw Effect APIs for Contract.
   *
   * @since 0.2.0
   * @category effect
   */
  effect: {
    call: callEffect,
    state: stateEffect,
    stateAt: stateAtEffect,
    ledgerState: ledgerStateEffect,
    ledgerStateAt: ledgerStateAtEffect,
  },
};

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

/**
 * Service interface for Client operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface ClientServiceImpl {
  readonly create: (config: ClientConfig) => Effect.Effect<MidnightClient, ClientError>;
  readonly fromWallet: (
    connection: WalletConnection,
    config: {
      zkConfigProvider: ZKConfigProvider<string>;
      privateStateProvider: PrivateStateProvider;
      logging?: boolean;
    },
  ) => Effect.Effect<MidnightClient, ClientError>;
  readonly contractFrom: (
    client: MidnightClient,
    options: ContractFromOptions,
  ) => Effect.Effect<ContractBuilder, ClientError>;
  readonly waitForTx: (
    client: MidnightClient,
    txHash: string,
  ) => Effect.Effect<FinalizedTxData, ClientError>;
}

/**
 * Context.Tag for ClientService dependency injection.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const clientService = yield* ClientService;
 *   const client = yield* clientService.create(config);
 *   return client;
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(ClientLive)));
 * ```
 *
 * @since 0.2.0
 * @category service
 */
export class ClientService extends Context.Tag('ClientService')<ClientService, ClientServiceImpl>() {}

/**
 * Service interface for ContractBuilder operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface ContractBuilderServiceImpl {
  readonly deploy: (
    builder: ContractBuilder,
    options?: DeployOptions,
  ) => Effect.Effect<ConnectedContract, ContractError>;
  readonly join: (
    builder: ContractBuilder,
    address: string,
    options?: JoinOptions,
  ) => Effect.Effect<ConnectedContract, ContractError>;
}

/**
 * Context.Tag for ContractBuilderService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class ContractBuilderService extends Context.Tag('ContractBuilderService')<
  ContractBuilderService,
  ContractBuilderServiceImpl
>() {}

/**
 * Service interface for Contract operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface ContractServiceImpl {
  readonly call: (
    contract: ConnectedContract,
    action: string,
    ...args: unknown[]
  ) => Effect.Effect<CallResult, ContractError>;
  readonly state: (contract: ConnectedContract) => Effect.Effect<unknown, ContractError>;
  readonly stateAt: (
    contract: ConnectedContract,
    blockHeight: number,
  ) => Effect.Effect<unknown, ContractError>;
  readonly ledgerState: (contract: ConnectedContract) => Effect.Effect<unknown, ContractError>;
  readonly ledgerStateAt: (
    contract: ConnectedContract,
    blockHeight: number,
  ) => Effect.Effect<unknown, ContractError>;
}

/**
 * Context.Tag for ContractService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class ContractService extends Context.Tag('ContractService')<
  ContractService,
  ContractServiceImpl
>() {}

// =============================================================================
// Effect DI - Live Layers
// =============================================================================

/**
 * Live Layer for ClientService.
 *
 * @since 0.2.0
 * @category layer
 */
export const ClientLive: Layer.Layer<ClientService> = Layer.succeed(ClientService, {
  create: createEffect,
  fromWallet: fromWalletEffect,
  contractFrom: contractFromEffect,
  waitForTx: waitForTxEffect,
});

/**
 * Live Layer for ContractBuilderService.
 *
 * @since 0.2.0
 * @category layer
 */
export const ContractBuilderLive: Layer.Layer<ContractBuilderService> = Layer.succeed(
  ContractBuilderService,
  {
    deploy: deployEffect,
    join: joinEffect,
  },
);

/**
 * Live Layer for ContractService.
 *
 * @since 0.2.0
 * @category layer
 */
export const ContractLive: Layer.Layer<ContractService> = Layer.succeed(ContractService, {
  call: callEffect,
  state: stateEffect,
  stateAt: stateAtEffect,
  ledgerState: ledgerStateEffect,
  ledgerStateAt: ledgerStateAtEffect,
});

// =============================================================================
// Layer Factories
// =============================================================================

/**
 * Create a Layer providing all Client-related factory services.
 *
 * Use this when you want to create clients on-demand within your Effect programs.
 * For pre-initialized clients, use `Client.layer(config)` instead.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const program = Effect.gen(function* () {
 *   const clientService = yield* Midday.ClientService;
 *   const client = yield* clientService.create(config);
 *   return client;
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Midday.Client.services())));
 * ```
 *
 * @since 0.3.0
 * @category layer
 */
export function services(): Layer.Layer<ClientService | ContractBuilderService | ContractService> {
  return Layer.mergeAll(ClientLive, ContractBuilderLive, ContractLive);
}

// =============================================================================
// Pre-configured Client Layer
// =============================================================================

/**
 * Context.Tag for a pre-initialized MidnightClient.
 *
 * Use with `Client.layer(config)` for dependency injection of a configured client.
 *
 * @since 0.3.0
 * @category service
 */
export class MidnightClientService extends Context.Tag('MidnightClientService')<
  MidnightClientService,
  MidnightClient
>() {}

/**
 * Create a Layer that provides a pre-initialized MidnightClient.
 *
 * This is the recommended way to inject a client into Effect programs
 * when you have a known configuration at startup. Follows the same pattern
 * as `Cluster.layer(config)`.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const clientLayer = Midday.Client.layer({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 * });
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.MidnightClientService;
 *   const builder = yield* Midday.Client.effect.contractFrom(client, { module });
 *   return builder;
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(clientLayer)));
 * ```
 *
 * @since 0.3.0
 * @category layer
 */
export function layer(config: ClientConfig): Layer.Layer<MidnightClientService, ClientError> {
  return Layer.effect(MidnightClientService, createEffect(config));
}

/**
 * Create a Layer that provides a pre-initialized MidnightClient from a wallet connection.
 *
 * Use this for browser environments with Lace wallet integration.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // After connecting wallet
 * const connection = await Midday.connectWallet('testnet');
 *
 * const clientLayer = Midday.Client.layerFromWallet(connection, {
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.MidnightClientService;
 *   // Use client...
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(clientLayer)));
 * ```
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
): Layer.Layer<MidnightClientService, ClientError> {
  return Layer.effect(MidnightClientService, fromWalletEffect(connection, config));
}
