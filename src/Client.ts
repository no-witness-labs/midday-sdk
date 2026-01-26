/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * Provides a simple API for deploying, joining, and calling contracts.
 * Supports both seed-based (Node.js/browser) and wallet-based (browser) initialization.
 *
 * @since 0.1.0
 * @module
 */

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

export interface MidnightClient {
  /** Raw wallet context for advanced use (null if using wallet connector) */
  readonly wallet: WalletContext | null;
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Logger instance */
  readonly logger: Logger;

  /** Load a contract from module */
  contractFrom(options: ContractFromOptions): Promise<ContractBuilder>;

  /** Wait for a transaction to be finalized on-chain by its hash */
  waitForTx(txHash: string): Promise<FinalizedTxData>;
}

export interface FinalizedTxData {
  txHash: string;
  blockHeight: number;
  blockHash: string;
}

export interface ContractBuilder {
  /** The loaded contract module */
  readonly module: LoadedContractModule;
  /** Deploy a new instance */
  deploy(options?: DeployOptions): Promise<ConnectedContract>;
  /** Join an existing deployed contract */
  join(address: string, options?: JoinOptions): Promise<ConnectedContract>;
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

  /** Call a contract circuit - waits for transaction to be finalized */
  call(action: string, ...args: unknown[]): Promise<CallResult>;

  /** Query contract public state (raw) - latest */
  state(): Promise<unknown>;

  /** Query contract public state at specific block height (raw) */
  stateAt(blockHeight: number): Promise<unknown>;

  /** Query contract public state (parsed via ledger) - latest */
  ledgerState(): Promise<unknown>;

  /** Query contract public state at specific block height (parsed via ledger) */
  ledgerStateAt(blockHeight: number): Promise<unknown>;
}

export interface CallResult {
  txHash: string;
  blockHeight: number;
  status: string;
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
// Client Implementation
// =============================================================================

/**
 * Create a Midnight client for interacting with contracts using a seed.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const client = await Midday.Client.create({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 *
 * const counter = await client.contractFrom({
 *   module: await import('./contracts/counter/index.js'),
 *   privateStateId: 'counter',
 * });
 *
 * await counter.deploy();
 * await counter.call('increment');
 * ```
 */
export async function create(config: ClientConfig): Promise<MidnightClient> {
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
    throw new Error('Wallet seed is required for non-local networks. Provide via config.seed.');
  }

  // Initialize wallet
  logger.info('Initializing wallet...');
  const walletContext = await Wallet.init(walletSeed, networkConfig);
  await Wallet.waitForSync(walletContext);
  logger.info('Wallet synced');

  const providerOptions: CreateProvidersOptions = {
    networkConfig,
    zkConfigProvider,
    privateStateProvider,
    storageConfig: storage,
  };

  return createClientInternal(walletContext, null, providerOptions, logger);
}

/**
 * Create a Midnight client from a connected wallet (browser).
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Connect to Lace wallet
 * const connection = await Midday.connectWallet('testnet');
 *
 * // Create client from wallet
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

    async contractFrom(options: ContractFromOptions): Promise<ContractBuilder> {
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

    async waitForTx(txHash: string): Promise<FinalizedTxData> {
      const data = await providers.publicDataProvider.watchForTxData(txHash);
      return {
        txHash: data.txHash,
        blockHeight: data.blockHeight,
        blockHash: data.blockHash,
      };
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

  return {
    wallet: walletContext,
    networkConfig,
    logger,

    async contractFrom(options: ContractFromOptions): Promise<ContractBuilder> {
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

    async waitForTx(txHash: string): Promise<FinalizedTxData> {
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
  return {
    module,

    async deploy(options?: DeployOptions): Promise<ConnectedContract> {
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

    async join(address: string, options?: JoinOptions): Promise<ConnectedContract> {
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
  return {
    address,
    instance,
    module,
    providers,
    logger,

    async call(action: string, ...args: unknown[]): Promise<CallResult> {
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

    async state(): Promise<unknown> {
      const contractState = await providers.publicDataProvider.queryContractState(address);
      if (!contractState) {
        throw new Error(`Contract state not found at ${address}`);
      }
      return contractState.data;
    },

    async stateAt(blockHeight: number): Promise<unknown> {
      const contractState = await providers.publicDataProvider.queryContractState(address, {
        type: 'blockHeight',
        blockHeight,
      });
      if (!contractState) {
        throw new Error(`Contract state not found at ${address} at block ${blockHeight}`);
      }
      return contractState.data;
    },

    async ledgerState(): Promise<unknown> {
      const data = await this.state();
      return module.ledger(data);
    },

    async ledgerStateAt(blockHeight: number): Promise<unknown> {
      const data = await this.stateAt(blockHeight);
      return module.ledger(data);
    },
  };
}
