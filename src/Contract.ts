/**
 * Contract lifecycle management for Midnight Network.
 *
 * Handles contract loading, deployment, joining, calling, and state queries.
 * A contract progresses through two states: **loaded** → **deployed**.
 *
 * ## API Design
 *
 * ```typescript
 * // Promise user
 * const contract = await client.loadContract({ path: './contracts/counter' });
 * await contract.deploy();
 * await contract.call('increment');
 * const state = await contract.ledgerState();
 *
 * // Effect user
 * const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 * yield* contract.effect.deploy();
 * yield* contract.effect.call('increment');
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Data, Effect } from 'effect';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type {
  WalletProvider,
  MidnightProvider,
  ZKConfigProvider,
  PrivateStateProvider,
  ProofProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import { runEffectWithLogging } from './Runtime.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error during contract deployment, calls, or state queries.
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
 * A contract module definition.
 *
 * @typeParam TLedger - The ledger state type returned by the ledger function
 * @typeParam TCircuits - Union of circuit names (e.g., 'increment' | 'decrement')
 *
 * @since 0.2.0
 * @category model
 */
export interface ContractModule<
  TLedger = unknown,
  TCircuits extends string = string,
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Contract: new (witnesses: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    impureCircuits: Record<TCircuits, (...args: any[]) => any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ledger: (state: any) => TLedger;
}

/**
 * Infer the Ledger type from a contract module.
 *
 * @since 0.2.6
 * @category type
 */
export type InferLedger<M> = M extends ContractModule<infer L, string> ? L : unknown;

/**
 * Infer the circuit names from a contract module.
 *
 * @since 0.2.6
 * @category type
 */
export type InferCircuits<M> = M extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Contract: new (...args: any[]) => { impureCircuits: infer IC };
} ? keyof IC & string : string;

/**
 * A loaded contract module with configuration.
 *
 * @typeParam TLedger - The ledger state type
 * @typeParam TCircuits - Union of circuit names
 *
 * @since 0.2.0
 * @category model
 */
export interface LoadedContractModule<
  TLedger = unknown,
  TCircuits extends string = string,
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Contract: new (witnesses: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    impureCircuits: Record<TCircuits, (...args: any[]) => any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ledger: (state: any) => TLedger;
  privateStateId: string;
  witnesses: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compiledContract: CompiledContract.CompiledContract<any, any, any>;
}

/**
 * Options for loading a contract.
 *
 * Exactly one of these must be provided:
 * - `module` + `zkConfig`: Direct module and zkConfig (works everywhere)
 * - `path`: Load from filesystem path (Node.js only)
 * - `moduleUrl` + `zkConfigBaseUrl`: Load from URLs (browser)
 *
 * @typeParam M - The contract module type (for type inference)
 *
 * @since 0.2.0
 * @category model
 */
export interface LoadContractOptions<M extends ContractModule = ContractModule> {
  // --- Direct loading (works everywhere) ---
  /** Contract module */
  module?: M;
  /** ZK configuration provider for this contract */
  zkConfig?: ZKConfigProvider<string>;

  // --- Path-based loading (Node.js only) ---
  /** Filesystem path to contract directory (auto-loads module + zkConfig) */
  path?: string;

  // --- URL-based loading (browser) ---
  /** URL to contract module JS file */
  moduleUrl?: string;
  /** Base URL for ZK artifacts */
  zkConfigBaseUrl?: string;

  // --- Common options ---
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

/**
 * Contract state: either "loaded" (pre-deploy) or "deployed" (connected to network).
 *
 * @since 0.6.0
 * @category model
 */
export type ContractState = 'loaded' | 'deployed';

/**
 * Full providers for a contract (includes zkConfig and proofProvider).
 *
 * @since 0.3.0
 * @category model
 */
export interface ContractProviders {
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  privateStateProvider: PrivateStateProvider;
  zkConfigProvider: ZKConfigProvider<string>;
  proofProvider: ProofProvider;
}

// =============================================================================
// Contract Handle Interface
// =============================================================================

/**
 * A contract handle that manages the full lifecycle: load → deploy/join → call.
 *
 * The contract has two states:
 * - **loaded**: Contract module loaded, ready for deploy() or join()
 * - **deployed**: Connected to network, ready for call() and ledgerState()
 *
 * @typeParam TLedger - The ledger state type (inferred from module)
 * @typeParam TCircuits - Union of circuit names (inferred from module)
 *
 * @since 0.2.6
 * @category model
 */
export interface Contract<
  TLedger = unknown,
  TCircuits extends string = string,
> {
  /** Current state of the contract */
  readonly state: ContractState;
  /** The deployed contract address (undefined until deployed/joined) */
  readonly address: string | undefined;
  /** The loaded contract module */
  readonly module: LoadedContractModule<TLedger, TCircuits>;
  /** Contract providers (for advanced use) */
  readonly providers: ContractProviders;

  /**
   * Deploy a new contract instance.
   * Transitions state from "loaded" to "deployed".
   *
   * @throws {ContractError} If already deployed
   */
  deploy(options?: DeployOptions): Promise<void>;

  /**
   * Join an existing contract at an address.
   * Transitions state from "loaded" to "deployed".
   *
   * @throws {ContractError} If already deployed
   */
  join(address: string, options?: JoinOptions): Promise<void>;

  /**
   * Call a contract action.
   *
   * @throws {ContractError} If not deployed
   */
  call(action: TCircuits, ...args: unknown[]): Promise<CallResult>;

  /**
   * Get raw contract state.
   *
   * @throws {ContractError} If not deployed
   */
  getState(): Promise<unknown>;

  /**
   * Get raw contract state at a specific block height.
   *
   * @throws {ContractError} If not deployed
   */
  getStateAt(blockHeight: number): Promise<unknown>;

  /**
   * Get parsed ledger state.
   *
   * @throws {ContractError} If not deployed
   */
  ledgerState(): Promise<TLedger>;

  /**
   * Get parsed ledger state at a specific block height.
   *
   * @throws {ContractError} If not deployed
   */
  ledgerStateAt(blockHeight: number): Promise<TLedger>;

  /** Effect versions of contract methods */
  readonly effect: {
    deploy(options?: DeployOptions): Effect.Effect<void, ContractError>;
    join(address: string, options?: JoinOptions): Effect.Effect<void, ContractError>;
    call(action: TCircuits, ...args: unknown[]): Effect.Effect<CallResult, ContractError>;
    getState(): Effect.Effect<unknown, ContractError>;
    getStateAt(blockHeight: number): Effect.Effect<unknown, ContractError>;
    ledgerState(): Effect.Effect<TLedger, ContractError>;
    ledgerStateAt(blockHeight: number): Effect.Effect<TLedger, ContractError>;
  };
}

// =============================================================================
// Internal Data
// =============================================================================

/**
 * Internal contract data (plain object).
 * @internal
 */
export interface ContractData {
  readonly module: LoadedContractModule;
  readonly providers: ContractProviders;
  readonly logging: boolean;
  readonly address: string | undefined;
  readonly instance: unknown | undefined;
}

/**
 * Internal interface for deployed contract instance with callable transaction methods.
 * @internal
 */
interface DeployedContractInstance {
  callTx: Record<string, (...args: unknown[]) => Promise<{ public: { txHash: string; blockHeight: number; status: string } }>>;
}

// =============================================================================
// Contract Loading
// =============================================================================

/**
 * Load and compile a contract module from options.
 *
 * @internal Used by Client.loadContract
 */
export function loadContractModuleEffect(
  options: LoadContractOptions,
  networkConfig: { proofServer: string },
  baseProviders: {
    walletProvider: WalletProvider;
    midnightProvider: MidnightProvider;
    publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
    privateStateProvider: PrivateStateProvider;
    networkConfig: { proofServer: string };
  },
  logging: boolean,
): Effect.Effect<ContractData, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      let module: ContractModule;
      let zkConfig: ZKConfigProvider<string>;

      if (options.path) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { join } = require('path');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { NodeZkConfigProvider } = require('@midnight-ntwrk/midnight-js-node-zk-config-provider');

        const modulePath = join(options.path, 'contract', 'index.js');
        module = await import(modulePath);
        zkConfig = new NodeZkConfigProvider(options.path);
      } else if (options.moduleUrl && options.zkConfigBaseUrl) {
        const { HttpZkConfigProvider } = await import('./ZkConfig.js');
        module = await import(/* webpackIgnore: true */ options.moduleUrl);
        zkConfig = new HttpZkConfigProvider(options.zkConfigBaseUrl);
      } else if (options.module && options.zkConfig) {
        module = options.module;
        zkConfig = options.zkConfig;
      } else {
        throw new Error(
          'Contract loading requires one of: ' +
          '(1) module + zkConfig, ' +
          '(2) path (Node.js), or ' +
          '(3) moduleUrl + zkConfigBaseUrl (browser)',
        );
      }

      const witnesses = options.witnesses ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiledContract: any = CompiledContract.make('contract', module.Contract as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiledContractWithWitnesses = (CompiledContract.withWitnesses as any)(compiledContract, witnesses);

      const loadedModule: LoadedContractModule = {
        Contract: module.Contract,
        ledger: module.ledger,
        privateStateId: options.privateStateId ?? 'contract',
        witnesses,
        compiledContract: compiledContractWithWitnesses,
      };

      const proofProvider = httpClientProofProvider(
        networkConfig.proofServer,
        zkConfig,
      );

      const providers: ContractProviders = {
        walletProvider: baseProviders.walletProvider,
        midnightProvider: baseProviders.midnightProvider,
        publicDataProvider: baseProviders.publicDataProvider,
        privateStateProvider: baseProviders.privateStateProvider,
        zkConfigProvider: zkConfig,
        proofProvider,
      };

      return {
        module: loadedModule,
        providers,
        logging,
        address: undefined,
        instance: undefined,
      };
    },
    catch: (cause) =>
      new ContractError({
        cause,
        message: `Failed to load contract: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Contract Effects
// =============================================================================

function deployContractEffect(
  contractData: ContractData,
  options?: DeployOptions,
): Effect.Effect<ContractData, ContractError> {
  return Effect.gen(function* () {
    if (contractData.address !== undefined) {
      return yield* Effect.fail(
        new ContractError({
          cause: new Error('Already deployed'),
          message: `Contract already deployed at ${contractData.address}. Cannot deploy again.`,
        }),
      );
    }

    const { initialPrivateState = {} } = options ?? {};
    const { module, providers, logging } = contractData;

    yield* Effect.logDebug('Deploying contract...');

    const deployed = yield* Effect.tryPromise({
      try: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deployContract(providers as any, {
          compiledContract: module.compiledContract,
          privateStateId: module.privateStateId,
          initialPrivateState,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to deploy contract: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const address = (deployed as any).deployTxData.public.contractAddress;

    yield* Effect.logDebug(`Contract deployed at: ${address}`);

    return {
      address,
      instance: deployed,
      module,
      providers,
      logging,
    };
  });
}

function joinContractEffect(
  contractData: ContractData,
  address: string,
  options?: JoinOptions,
): Effect.Effect<ContractData, ContractError> {
  return Effect.gen(function* () {
    if (contractData.address !== undefined) {
      return yield* Effect.fail(
        new ContractError({
          cause: new Error('Already deployed'),
          message: `Contract already connected at ${contractData.address}. Cannot join another.`,
        }),
      );
    }

    const { initialPrivateState = {} } = options ?? {};
    const { module, providers, logging } = contractData;

    yield* Effect.logDebug(`Joining contract at ${address}...`);

    const deployed = yield* Effect.tryPromise({
      try: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findDeployedContract(providers as any, {
          contractAddress: address,
          compiledContract: module.compiledContract,
          privateStateId: module.privateStateId,
          initialPrivateState,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to join contract at ${address}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    yield* Effect.logDebug('Contract joined');

    return {
      address,
      instance: deployed,
      module,
      providers,
      logging,
    };
  });
}

function callContractEffect(
  contractData: ContractData,
  action: string,
  ...args: unknown[]
): Effect.Effect<CallResult, ContractError> {
  return Effect.gen(function* () {
    if (contractData.instance === undefined) {
      return yield* Effect.fail(
        new ContractError({
          cause: new Error('Not deployed'),
          message: 'Contract not deployed. Call deploy() or join() first.',
        }),
      );
    }

    const { instance } = contractData;
    yield* Effect.logDebug(`Calling ${action}()...`);

    const deployed = instance as DeployedContractInstance;
    const callTx = deployed.callTx;
    if (!callTx || typeof callTx[action] !== 'function') {
      return yield* Effect.fail(
        new ContractError({
          cause: new Error(`Unknown action: ${action}`),
          message: `Unknown action: ${action}. Available: ${Object.keys(callTx || {}).join(', ')}`,
        }),
      );
    }

    const txData = yield* Effect.tryPromise({
      try: () => callTx[action](...args),
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to call ${action}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    yield* Effect.logDebug('Transaction submitted');
    yield* Effect.logDebug(`  TX Hash: ${txData.public.txHash}`);
    yield* Effect.logDebug(`  Block: ${txData.public.blockHeight}`);

    return {
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
      status: txData.public.status,
    };
  });
}

function contractStateEffect(contractData: ContractData): Effect.Effect<unknown, ContractError> {
  if (contractData.address === undefined) {
    return Effect.fail(
      new ContractError({
        cause: new Error('Not deployed'),
        message: 'Contract not deployed. Call deploy() or join() first.',
      }),
    );
  }

  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const contractState = await contractData.providers.publicDataProvider.queryContractState(address);
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

function contractStateAtEffect(
  contractData: ContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  if (contractData.address === undefined) {
    return Effect.fail(
      new ContractError({
        cause: new Error('Not deployed'),
        message: 'Contract not deployed. Call deploy() or join() first.',
      }),
    );
  }

  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const contractState = await contractData.providers.publicDataProvider.queryContractState(address, {
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

function ledgerStateEffect(contractData: ContractData): Effect.Effect<unknown, ContractError> {
  return contractStateEffect(contractData).pipe(
    Effect.map((data) => contractData.module.ledger(data)),
  );
}

function ledgerStateAtEffect(
  contractData: ContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  return contractStateAtEffect(contractData, blockHeight).pipe(
    Effect.map((data) => contractData.module.ledger(data)),
  );
}

// =============================================================================
// Contract Handle Factory
// =============================================================================

/**
 * Create a stateful Contract handle from internal data.
 *
 * @internal Used by Client to create contract handles
 */
export function createContractHandle(initialData: ContractData): Contract {
  let data: ContractData = initialData;

  const handle: Contract = {
    get state(): ContractState {
      return data.address !== undefined ? 'deployed' : 'loaded';
    },

    get address() {
      return data.address;
    },
    get module() {
      return data.module;
    },
    get providers() {
      return data.providers;
    },

    // Lifecycle methods
    deploy: async (options) => {
      const newData = await runEffectWithLogging(deployContractEffect(data, options), data.logging);
      data = newData;
    },
    join: async (address, options) => {
      const newData = await runEffectWithLogging(joinContractEffect(data, address, options), data.logging);
      data = newData;
    },

    // Contract methods
    call: (action, ...args) =>
      runEffectWithLogging(callContractEffect(data, action, ...args), data.logging),
    getState: () =>
      runEffectWithLogging(contractStateEffect(data), data.logging),
    getStateAt: (blockHeight) =>
      runEffectWithLogging(contractStateAtEffect(data, blockHeight), data.logging),
    ledgerState: () =>
      runEffectWithLogging(ledgerStateEffect(data), data.logging),
    ledgerStateAt: (blockHeight) =>
      runEffectWithLogging(ledgerStateAtEffect(data, blockHeight), data.logging),

    // Effect API
    effect: {
      deploy: (options) =>
        deployContractEffect(data, options).pipe(
          Effect.tap((newData) => Effect.sync(() => { data = newData; })),
        ),
      join: (address, options) =>
        joinContractEffect(data, address, options).pipe(
          Effect.tap((newData) => Effect.sync(() => { data = newData; })),
        ),
      call: (action, ...args) => callContractEffect(data, action, ...args),
      getState: () => contractStateEffect(data),
      getStateAt: (blockHeight) => contractStateAtEffect(data, blockHeight),
      ledgerState: () => ledgerStateEffect(data),
      ledgerStateAt: (blockHeight) => ledgerStateAtEffect(data, blockHeight),
    },
  };

  return handle;
}

// =============================================================================
// Standalone Contract Loaders
// =============================================================================

/**
 * Result of loading a contract from a path.
 *
 * @since 0.4.0
 * @category model
 */
export interface ContractLoadResult<T = ContractModule> {
  /** The contract module with TypeScript types. */
  readonly module: T;
  /** ZK config provider for circuit artifacts. */
  readonly zkConfig: ZKConfigProvider<string>;
}

/**
 * Options for loading a contract module.
 *
 * @since 0.4.0
 * @category model
 */
export interface ContractLoadOptions {
  /** Subdirectory within the contract path where the compiled module lives. @default 'contract' */
  readonly moduleSubdir?: string;
  /** Module entry point filename. @default 'index.js' */
  readonly moduleEntry?: string;
}

/**
 * Load a Compact contract from a directory path.
 *
 * Note: Prefer using `client.loadContract({ path })` which handles this automatically.
 * This function is useful when you need to load the module before creating a client.
 *
 * @param contractPath - Absolute path to the contract directory
 * @param options - Optional loading configuration
 * @returns Promise resolving to the contract module and ZK config provider
 *
 * @example
 * ```typescript
 * const { module, zkConfig } = await Midday.Contract.loadContractModule(contractPath);
 * const contract = await client.loadContract({ module, zkConfig });
 * ```
 *
 * @since 0.4.0
 * @category loading
 */
export async function loadContractModule<T = ContractModule>(
  contractPath: string,
  options: ContractLoadOptions = {},
): Promise<ContractLoadResult<T>> {
  const { moduleSubdir = 'contract', moduleEntry = 'index.js' } = options;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeZkConfigProvider } = require('@midnight-ntwrk/midnight-js-node-zk-config-provider');

  const modulePath = join(contractPath, moduleSubdir, moduleEntry);
  const module = (await import(modulePath)) as T;
  const zkConfig = new NodeZkConfigProvider(contractPath) as ZKConfigProvider<string>;

  return { module, zkConfig };
}

/**
 * Load a contract from URLs (browser environments).
 *
 * @param moduleUrl - URL to the contract module
 * @param zkConfigBaseUrl - Base URL for ZK artifacts
 * @returns Promise resolving to the contract module and ZK config provider
 *
 * @since 0.4.0
 * @category loading
 */
export async function loadContractModuleFromUrl<T = ContractModule>(
  moduleUrl: string,
  zkConfigBaseUrl: string,
): Promise<ContractLoadResult<T>> {
  const { HttpZkConfigProvider } = await import('./ZkConfig.js');

  const module = (await import(/* webpackIgnore: true */ moduleUrl)) as T;
  const zkConfig = new HttpZkConfigProvider(zkConfigBaseUrl) as ZKConfigProvider<string>;

  return { module, zkConfig };
}
