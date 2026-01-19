/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * Provides a simple API for deploying, joining, and calling contracts.
 *
 * @since 0.1.0
 * @module
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import pino, { type Logger } from 'pino';
import { build as buildPretty, type PinoPretty } from 'pino-pretty';

import * as Config from './Config.js';
import * as Wallet from './Wallet.js';
import * as Providers from './Providers.js';
import type { NetworkConfig } from './Config.js';
import type { ContractProviders, StorageConfig } from './Providers.js';
import type { WalletContext } from './Wallet.js';

// =============================================================================
// Types
// =============================================================================

export interface ClientConfig {
  /** Network to connect to (default: 'local') */
  network?: string;
  /** Custom network configuration (overrides network preset) */
  networkConfig?: NetworkConfig;
  /** Wallet seed (defaults to dev wallet for local) */
  seed?: string;
  /** Storage configuration */
  storage?: StorageConfig;
  /** Enable logging (default: true) */
  logging?: boolean;
}

export interface ContractFromOptions {
  /**
   * Base for path resolution:
   * - undefined/'cwd': relative to process.cwd() (default)
   * - 'project': relative to project root (finds package.json)
   * - string (URL): relative to caller's import.meta.url
   */
  from?: string | 'project' | 'cwd';
  /** Witnesses for the contract */
  witnesses?: Record<string, unknown>;
  /** Override privateStateId (defaults to directory name) */
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
  /** Raw wallet context for advanced use */
  readonly wallet: WalletContext;
  /** Network configuration */
  readonly networkConfig: NetworkConfig;
  /** Logger instance */
  readonly logger: Logger;

  /** Load a contract from a build directory path */
  contractFrom(basePath: string, options?: ContractFromOptions): Promise<ContractBuilder>;

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

export interface LoadedContractModule {
  Contract: new (witnesses: unknown) => unknown;
  ledger: (state: unknown) => unknown;
  zkConfigPath: string;
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
// Path Resolution
// =============================================================================

function findProjectRoot(startDir: string = process.cwd()): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error('Could not find project root (no package.json found)');
}

function resolvePath(basePath: string, options?: ContractFromOptions): string {
  if (path.isAbsolute(basePath)) {
    return basePath;
  }

  const from = options?.from ?? 'cwd';

  if (from === 'cwd') {
    return path.resolve(process.cwd(), basePath);
  }

  if (from === 'project') {
    const projectRoot = findProjectRoot();
    return path.resolve(projectRoot, basePath);
  }

  // Assume it's an import.meta.url
  const callerDir = path.dirname(fileURLToPath(from));
  return path.resolve(callerDir, basePath);
}

// =============================================================================
// Logger
// =============================================================================

function createLogger(enabled: boolean): Logger {
  if (!enabled) {
    return pino.default({ level: 'silent' });
  }
  const pretty: PinoPretty.PrettyStream = buildPretty({ colorize: true, sync: true });
  return pino.default({ level: 'info' }, pretty);
}

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Create a Midnight client for interacting with contracts
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Simple - local network with dev wallet
 * const client = await Midday.Client.create();
 *
 * // Custom seed
 * const client = await Midday.Client.create({
 *   seed: 'your-64-char-hex-seed'
 * });
 *
 * // Custom network endpoints via env vars or config
 * const client = await Midday.Client.create({
 *   networkConfig: {
 *     networkId: 'testnet',
 *     indexer: 'https://indexer.testnet.midnight.network/graphql',
 *     indexerWS: 'wss://indexer.testnet.midnight.network/graphql/ws',
 *     node: 'wss://node.testnet.midnight.network',
 *     proofServer: 'https://proof.testnet.midnight.network',
 *   }
 * });
 *
 * // Load and deploy a contract
 * const counter = await (await client.contractFrom('build/simple-counter')).deploy();
 *
 * // Call actions
 * await counter.call('increment');
 *
 * // Read state
 * const state = await counter.ledgerState();
 * console.log(state.counter);
 *
 * // Join existing contract
 * const existing = await (await client.contractFrom('build/simple-counter')).join(address);
 * ```
 */
export async function create(config: ClientConfig = {}): Promise<MidnightClient> {
  const { network = 'local', networkConfig: customNetworkConfig, seed, storage, logging = true } = config;

  const logger = createLogger(logging);

  // Resolve network configuration
  const networkConfig = customNetworkConfig ?? Config.getNetworkConfig(network);

  // Resolve seed (use dev wallet only for local network)
  const walletSeed = seed ?? (network === 'local' ? Config.DEV_WALLET_SEED : undefined);
  if (!walletSeed) {
    throw new Error('Wallet seed is required for non-local networks. Provide via config.seed or MIDNIGHT_WALLET_SEED env var.');
  }

  // Initialize wallet
  logger.info('Initializing wallet...');
  const walletContext = await Wallet.init(walletSeed, networkConfig);
  await Wallet.waitForSync(walletContext);
  logger.info('Wallet synced');

  return {
    wallet: walletContext,
    networkConfig,
    logger,

    async contractFrom(basePath: string, options?: ContractFromOptions): Promise<ContractBuilder> {
      const zkConfigPath = resolvePath(basePath, options);

      if (!fs.existsSync(zkConfigPath)) {
        throw new Error(`Contract path not found: ${zkConfigPath}`);
      }

      const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
      if (!fs.existsSync(contractPath)) {
        throw new Error(`Contract module not found: ${contractPath}`);
      }

      const contractModule = await import(contractPath);

      const module: LoadedContractModule = {
        Contract: contractModule.Contract,
        ledger: contractModule.ledger,
        zkConfigPath,
        privateStateId: options?.privateStateId ?? path.basename(zkConfigPath),
        witnesses: options?.witnesses ?? {},
      };

      const providers = Providers.create(walletContext, zkConfigPath, networkConfig, storage);

      return createContractBuilder(module, providers, logger);
    },

    async waitForTx(txHash: string): Promise<FinalizedTxData> {
      const providers = Providers.create(walletContext, process.cwd(), networkConfig, storage);
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
