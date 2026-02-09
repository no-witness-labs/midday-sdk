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

import { Data, Effect, Stream } from 'effect';
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
import type { ContractStateObservableConfig } from '@midnight-ntwrk/midnight-js-types';
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
 * Infer typed action methods from a contract module.
 *
 * Strips the runtime `context` first parameter from each circuit function
 * and maps the return type to `Promise<CallResult>`.
 *
 * @example
 * ```typescript
 * // Given a contract with: increment(ctx, amount: bigint), decrement(ctx)
 * // InferActions<M> = { increment(amount: bigint): Promise<CallResult>; decrement(): Promise<CallResult> }
 * ```
 *
 * @since 0.8.0
 * @category type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferActions<M> = M extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Contract: new (...args: any[]) => { impureCircuits: infer IC };
} ? {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof IC]: IC[K] extends (context: any, ...args: infer A) => any
    ? (...args: A) => Promise<CallResult>
    : (...args: unknown[]) => Promise<CallResult>;
} : Record<string, (...args: unknown[]) => Promise<CallResult>>;

/**
 * Convert Promise-based actions to Effect-based actions.
 *
 * @since 0.8.0
 * @category type
 */
export type ToEffectActions<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<any>
    ? (...args: A) => Effect.Effect<CallResult, ContractError>
    : T[K];
};

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
 * @deprecated Use `LoadedContract` and `DeployedContract` types instead.
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
  publicDataProvider: PublicDataProvider;
  privateStateProvider: PrivateStateProvider;
  zkConfigProvider: ZKConfigProvider<string>;
  proofProvider: ProofProvider;
}

// =============================================================================
// Contract Handle Interfaces
// =============================================================================

/**
 * A loaded contract — ready for deployment or joining.
 *
 * Created via `client.loadContract()` or `Contract.load()`. Call `deploy()` or
 * `join()` to transition to a `DeployedContract`.
 *
 * @typeParam TLedger - The ledger state type (inferred from module)
 * @typeParam TCircuits - Union of circuit names (inferred from module)
 *
 * @since 0.7.0
 * @category model
 */
export interface LoadedContract<
  TLedger = unknown,
  TCircuits extends string = string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TActions extends Record<string, (...args: any[]) => Promise<CallResult>> = Record<string, (...args: unknown[]) => Promise<CallResult>>,
> {
  /** The loaded contract module */
  readonly module: LoadedContractModule<TLedger, TCircuits>;
  /** Contract providers (for advanced use) */
  readonly providers: ContractProviders;

  /**
   * Deploy a new contract instance.
   *
   * @returns A deployed contract handle ready for calls.
   * @throws {ContractError} When deployment fails
   */
  deploy(options?: DeployOptions): Promise<DeployedContract<TLedger, TCircuits, TActions>>;

  /**
   * Join an existing contract at an address.
   *
   * @returns A deployed contract handle ready for calls.
   * @throws {ContractError} When joining fails
   */
  join(address: string, options?: JoinOptions): Promise<DeployedContract<TLedger, TCircuits, TActions>>;

  /** Effect versions of loaded contract methods */
  readonly effect: {
    deploy(options?: DeployOptions): Effect.Effect<DeployedContract<TLedger, TCircuits, TActions>, ContractError>;
    join(address: string, options?: JoinOptions): Effect.Effect<DeployedContract<TLedger, TCircuits, TActions>, ContractError>;
  };
}

/**
 * A deployed contract — connected to the network, ready for calls.
 *
 * Created from `LoadedContract.deploy()` or `LoadedContract.join()`. Has a
 * known address and all operational methods.
 *
 * @typeParam TLedger - The ledger state type (inferred from module)
 * @typeParam TCircuits - Union of circuit names (inferred from module)
 *
 * @since 0.7.0
 * @category model
 */
export interface DeployedContract<
  TLedger = unknown,
  TCircuits extends string = string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TActions extends Record<string, (...args: any[]) => Promise<CallResult>> = Record<string, (...args: unknown[]) => Promise<CallResult>>,
> {
  /** The deployed contract address (always known). */
  readonly address: string;
  /** The loaded contract module */
  readonly module: LoadedContractModule<TLedger, TCircuits>;
  /** Contract providers (for advanced use) */
  readonly providers: ContractProviders;

  /**
   * Type-safe action methods — each circuit is a direct method with inferred parameter types.
   *
   * @example
   * ```typescript
   * // Instead of: await contract.call('increment', 5n)
   * await contract.actions.increment(5n);
   * ```
   *
   * @since 0.8.0
   */
  readonly actions: TActions;

  /**
   * Call a contract action by name (untyped fallback).
   *
   * Prefer `contract.actions.actionName(...)` for type-safe calls.
   */
  call(action: TCircuits, ...args: unknown[]): Promise<CallResult>;

  /** Get raw contract state. */
  getState(): Promise<unknown>;

  /** Get raw contract state at a specific block height. */
  getStateAt(blockHeight: number): Promise<unknown>;

  /** Get parsed ledger state. */
  ledgerState(): Promise<TLedger>;

  /** Get parsed ledger state at a specific block height. */
  ledgerStateAt(blockHeight: number): Promise<TLedger>;

  /**
   * Watch for parsed ledger state changes (callback style).
   * Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsub = contract.onStateChange((state) => {
   *   console.log(state.counter);
   * });
   * // later: unsub();
   * ```
   *
   * @since 0.9.0
   */
  onStateChange(callback: (state: TLedger) => void, options?: WatchOptions): Unsubscribe;

  /**
   * Watch for parsed ledger state changes (async iterator style).
   *
   * @example
   * ```typescript
   * for await (const state of contract.watchState()) {
   *   console.log(state.counter);
   *   if (state.counter > 10n) break;
   * }
   * ```
   *
   * @since 0.9.0
   */
  watchState(options?: WatchOptions): AsyncIterableIterator<TLedger>;

  /** Watch for raw state changes (callback). */
  onRawStateChange(callback: (state: unknown) => void, options?: WatchOptions): Unsubscribe;

  /** Watch for raw state changes (async iterator). */
  watchRawState(options?: WatchOptions): AsyncIterableIterator<unknown>;

  /** Effect versions of deployed contract methods */
  readonly effect: {
    /** Type-safe Effect action methods. */
    readonly actions: ToEffectActions<TActions>;
    call(action: TCircuits, ...args: unknown[]): Effect.Effect<CallResult, ContractError>;
    getState(): Effect.Effect<unknown, ContractError>;
    getStateAt(blockHeight: number): Effect.Effect<unknown, ContractError>;
    ledgerState(): Effect.Effect<TLedger, ContractError>;
    ledgerStateAt(blockHeight: number): Effect.Effect<TLedger, ContractError>;
    /** Watch parsed state as an Effect.Stream. */
    watchState(options?: WatchOptions): Stream.Stream<TLedger, ContractError>;
    /** Watch raw state as an Effect.Stream. */
    watchRawState(options?: WatchOptions): Stream.Stream<unknown, ContractError>;
  };
}

/**
 * A read-only contract handle — can query state without a wallet or proof server.
 *
 * Created via `Client.createReadonly().loadContract()`. Only exposes state
 * reading methods. Ideal for dashboards, explorers, and monitoring.
 *
 * @typeParam TLedger - The ledger state type (inferred from module)
 *
 * @since 0.8.0
 * @category model
 */
export interface ReadonlyContract<TLedger = unknown> {
  /** The ledger parser function (from the contract module). */
  readonly ledgerParser: LedgerParser<TLedger>;

  /** Read parsed ledger state at an address. */
  readState(address: string): Promise<TLedger>;

  /** Read parsed ledger state at an address and specific block height. */
  readStateAt(address: string, blockHeight: number): Promise<TLedger>;

  /** Read raw (unparsed) contract state at an address. */
  readRawState(address: string): Promise<unknown>;

  /** Read raw contract state at an address and specific block height. */
  readRawStateAt(address: string, blockHeight: number): Promise<unknown>;

  /** Watch parsed state changes at an address (callback). */
  onStateChange(address: string, callback: (state: TLedger) => void, options?: WatchOptions): Unsubscribe;

  /** Watch parsed state changes at an address (async iterator). */
  watchState(address: string, options?: WatchOptions): AsyncIterableIterator<TLedger>;

  /** Watch raw state changes at an address (callback). */
  onRawStateChange(address: string, callback: (state: unknown) => void, options?: WatchOptions): Unsubscribe;

  /** Watch raw state changes at an address (async iterator). */
  watchRawState(address: string, options?: WatchOptions): AsyncIterableIterator<unknown>;

  /** Effect versions of read-only methods. */
  readonly effect: {
    readState(address: string): Effect.Effect<TLedger, ContractError>;
    readStateAt(address: string, blockHeight: number): Effect.Effect<TLedger, ContractError>;
    readRawState(address: string): Effect.Effect<unknown, ContractError>;
    readRawStateAt(address: string, blockHeight: number): Effect.Effect<unknown, ContractError>;
    watchState(address: string, options?: WatchOptions): Stream.Stream<TLedger, ContractError>;
    watchRawState(address: string, options?: WatchOptions): Stream.Stream<unknown, ContractError>;
  };
}

/**
 * Legacy unified contract type.
 *
 * @deprecated Use `LoadedContract` and `DeployedContract` separately.
 * @since 0.2.6
 * @category model
 */
export type Contract<
  TLedger = unknown,
  TCircuits extends string = string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TActions extends Record<string, (...args: any[]) => Promise<CallResult>> = Record<string, (...args: unknown[]) => Promise<CallResult>>,
> = LoadedContract<TLedger, TCircuits, TActions> | DeployedContract<TLedger, TCircuits, TActions>;

// =============================================================================
// Internal Data
// =============================================================================

/**
 * Internal loaded contract data (plain object).
 * @internal
 */
export interface LoadedContractData {
  readonly module: LoadedContractModule;
  readonly providers: ContractProviders;
  readonly logging: boolean;
}

/**
 * Internal deployed contract data (plain object).
 * @internal
 */
export interface DeployedContractData extends LoadedContractData {
  readonly address: string;
  readonly instance: DeployedContractInstance;
}

/**
 * Legacy alias.
 * @deprecated Use `LoadedContractData` or `DeployedContractData`.
 * @internal
 */
export type ContractData = LoadedContractData & {
  readonly address: string | undefined;
  readonly instance: unknown | undefined;
};

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
): Effect.Effect<LoadedContractData, ContractError> {
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
  contractData: LoadedContractData,
  options?: DeployOptions,
): Effect.Effect<DeployedContractData, ContractError> {
  return Effect.gen(function* () {
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
      instance: deployed as DeployedContractInstance,
      module,
      providers,
      logging,
    };
  });
}

function joinContractEffect(
  contractData: LoadedContractData,
  address: string,
  options?: JoinOptions,
): Effect.Effect<DeployedContractData, ContractError> {
  return Effect.gen(function* () {
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
      instance: deployed as DeployedContractInstance,
      module,
      providers,
      logging,
    };
  });
}

function callContractEffect(
  contractData: DeployedContractData,
  action: string,
  ...args: unknown[]
): Effect.Effect<CallResult, ContractError> {
  return Effect.gen(function* () {
    yield* Effect.logDebug(`Calling ${action}()...`);

    const callTx = contractData.instance.callTx;
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

function contractStateEffect(contractData: DeployedContractData): Effect.Effect<unknown, ContractError> {
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
  contractData: DeployedContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
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

function ledgerStateEffect(contractData: DeployedContractData): Effect.Effect<unknown, ContractError> {
  return contractStateEffect(contractData).pipe(
    Effect.map((data) => contractData.module.ledger(data)),
  );
}

function ledgerStateAtEffect(
  contractData: DeployedContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  return contractStateAtEffect(contractData, blockHeight).pipe(
    Effect.map((data) => contractData.module.ledger(data)),
  );
}

/**
 * Type alias for the public data provider used to query contract state.
 *
 * Avoids requiring users to import the Midnight indexer package directly.
 * Create one via `Config.publicDataProvider(networkConfig)`.
 *
 * @since 0.8.0
 * @category model
 */
export type PublicDataProvider = ReturnType<typeof indexerPublicDataProvider>;

/**
 * Ledger parser function — converts raw contract state to typed ledger.
 *
 * Every compiled Compact contract exports a `ledger()` function matching this signature.
 *
 * @since 0.8.0
 * @category model
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LedgerParser<TLedger> = (state: any) => TLedger;

/**
 * Function returned by callback-style watch methods. Call it to stop watching.
 *
 * @since 0.9.0
 * @category model
 */
export type Unsubscribe = () => void;

/**
 * Options for watching contract state changes.
 *
 * Controls where the subscription stream starts from. Maps to the indexer's
 * `ContractStateObservableConfig` under the hood.
 *
 * @since 0.9.0
 * @category model
 */
export type WatchOptions =
  | { readonly from: 'latest' }
  | { readonly from: 'all' }
  | { readonly from: 'blockHeight'; readonly blockHeight: number; readonly inclusive?: boolean }
  | { readonly from: 'txId'; readonly txId: string; readonly inclusive?: boolean };

// =============================================================================
// Read-Only State Queries
// =============================================================================

/**
 * Read raw contract state without a wallet or deployment.
 *
 * @internal Effect source of truth
 */
function readRawStateEffect(
  address: string,
  provider: PublicDataProvider,
  atBlock?: number,
): Effect.Effect<unknown, ContractError> {
  return Effect.tryPromise({
    try: async () => {
      const opts = atBlock !== undefined
        ? { type: 'blockHeight' as const, blockHeight: atBlock }
        : undefined;
      const contractState = await provider.queryContractState(address, opts);
      if (!contractState) {
        throw new Error(
          atBlock !== undefined
            ? `Contract state not found at ${address} at block ${atBlock}`
            : `Contract state not found at ${address}`,
        );
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

/**
 * Read parsed ledger state without a wallet or deployment.
 *
 * @internal Effect source of truth
 */
function readStateEffect<TLedger>(
  address: string,
  provider: PublicDataProvider,
  ledgerParser: LedgerParser<TLedger>,
  atBlock?: number,
): Effect.Effect<TLedger, ContractError> {
  return readRawStateEffect(address, provider, atBlock).pipe(
    Effect.map((data) => ledgerParser(data)),
  );
}

/**
 * Read a contract's parsed ledger state without a wallet, deployment, or proof server.
 *
 * Ideal for dashboards, explorers, and read-only views that only need to
 * observe on-chain state.
 *
 * @param address - The deployed contract address
 * @param provider - Public data provider (from `Config.publicDataProvider(networkConfig)`)
 * @param ledgerParser - The contract module's `ledger` function
 * @returns Parsed ledger state
 *
 * @example
 * ```typescript
 * import * as Contract from '@no-witness-labs/midday-sdk/Contract';
 * import * as Config from '@no-witness-labs/midday-sdk/Config';
 * import { ledger } from './contracts/counter/contract/index.js';
 *
 * const pdp = Config.publicDataProvider(networkConfig);
 * const state = await Contract.readState(contractAddress, pdp, ledger);
 * console.log(state.counter); // 42n
 * ```
 *
 * @since 0.8.0
 * @category queries
 */
export async function readState<TLedger>(
  address: string,
  provider: PublicDataProvider,
  ledgerParser: LedgerParser<TLedger>,
): Promise<TLedger> {
  return runEffectWithLogging(readStateEffect(address, provider, ledgerParser), false);
}

/**
 * Read a contract's parsed ledger state at a specific block height.
 *
 * @param address - The deployed contract address
 * @param provider - Public data provider
 * @param ledgerParser - The contract module's `ledger` function
 * @param blockHeight - Block height to query at
 * @returns Parsed ledger state at the given block
 *
 * @since 0.8.0
 * @category queries
 */
export async function readStateAt<TLedger>(
  address: string,
  provider: PublicDataProvider,
  ledgerParser: LedgerParser<TLedger>,
  blockHeight: number,
): Promise<TLedger> {
  return runEffectWithLogging(readStateEffect(address, provider, ledgerParser, blockHeight), false);
}

/**
 * Read raw (unparsed) contract state without a wallet or deployment.
 *
 * @param address - The deployed contract address
 * @param provider - Public data provider
 * @returns Raw contract state data
 *
 * @since 0.8.0
 * @category queries
 */
export async function readRawState(
  address: string,
  provider: PublicDataProvider,
): Promise<unknown> {
  return runEffectWithLogging(readRawStateEffect(address, provider), false);
}

/**
 * Read raw contract state at a specific block height.
 *
 * @param address - The deployed contract address
 * @param provider - Public data provider
 * @param blockHeight - Block height to query at
 * @returns Raw contract state data at the given block
 *
 * @since 0.8.0
 * @category queries
 */
export async function readRawStateAt(
  address: string,
  provider: PublicDataProvider,
  blockHeight: number,
): Promise<unknown> {
  return runEffectWithLogging(readRawStateEffect(address, provider, blockHeight), false);
}

// =============================================================================
// Watch / Subscription Internals
// =============================================================================

/**
 * Convert WatchOptions to the indexer's ContractStateObservableConfig.
 * @internal
 */
function toObservableConfig(options?: WatchOptions): ContractStateObservableConfig {
  if (!options || options.from === 'latest') return { type: 'latest' };
  if (options.from === 'all') return { type: 'all' };
  if (options.from === 'blockHeight') {
    return { type: 'blockHeight', blockHeight: options.blockHeight, inclusive: options.inclusive };
  }
  return { type: 'txId', txId: options.txId, inclusive: options.inclusive };
}

/**
 * Watch raw contract state as an Effect.Stream.
 *
 * Wraps the indexer's RxJS `contractStateObservable` into an Effect.Stream.
 * This is the source of truth — callback and AsyncIterator APIs derive from it.
 *
 * @internal Effect.Stream source of truth
 */
function watchRawStateStream(
  address: string,
  provider: PublicDataProvider,
  options?: WatchOptions,
): Stream.Stream<unknown, ContractError> {
  return Stream.asyncPush<unknown, ContractError>((emit) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const config = toObservableConfig(options);
        const sub = provider.contractStateObservable(address, config).subscribe({
          next: (state) => emit.single(state.data),
          error: (err) =>
            emit.fail(
              new ContractError({
                cause: err,
                message: `Watch stream error: ${err instanceof Error ? err.message : String(err)}`,
              }),
            ),
          complete: () => emit.end(),
        });
        return sub;
      }),
      (sub) => Effect.sync(() => sub.unsubscribe()),
    ),
  );
}

/**
 * Watch parsed ledger state as an Effect.Stream.
 *
 * @internal Effect.Stream source of truth
 */
function watchStateStream<TLedger>(
  address: string,
  provider: PublicDataProvider,
  ledgerParser: LedgerParser<TLedger>,
  options?: WatchOptions,
): Stream.Stream<TLedger, ContractError> {
  return Stream.map(watchRawStateStream(address, provider, options), (data) => ledgerParser(data));
}

/**
 * Subscribe to a Stream via callback. Returns an unsubscribe function.
 * @internal
 */
function streamToCallback<A, E>(
  stream: Stream.Stream<A, E>,
  onValue: (value: A) => void,
  onError?: (error: E) => void,
): Unsubscribe {
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          if (onError) onError(err);
        }),
      ),
    ),
  );
  return () => Effect.runFork(fiber.interruptAsFork(fiber.id()));
}

/**
 * Convert a Stream to an AsyncIterableIterator.
 * @internal
 */
function streamToAsyncIterator<A>(
  stream: Stream.Stream<A, ContractError>,
): AsyncIterableIterator<A> {
  const queue: A[] = [];
  let done = false;
  let error: ContractError | null = null;
  let resolve: (() => void) | null = null;

  const fiber = Effect.runFork(
    Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        queue.push(value);
        if (resolve) {
          resolve();
          resolve = null;
        }
      }),
    ).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          error = err;
          if (resolve) {
            resolve();
            resolve = null;
          }
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          done = true;
          if (resolve) {
            resolve();
            resolve = null;
          }
        }),
      ),
    ),
  );

  const iterator: AsyncIterableIterator<A> = {
    next: async () => {
      while (queue.length === 0 && !done && !error) {
        await new Promise<void>((r) => { resolve = r; });
      }
      if (queue.length > 0) {
        return { value: queue.shift()!, done: false };
      }
      if (error) {
        throw error;
      }
      return { value: undefined as unknown as A, done: true };
    },
    return: async () => {
      Effect.runFork(fiber.interruptAsFork(fiber.id()));
      done = true;
      return { value: undefined as unknown as A, done: true };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return iterator;
}

// =============================================================================
// Public Watch API — Standalone
// =============================================================================

/**
 * Watch parsed contract state changes. Returns an unsubscribe function.
 *
 * @since 0.9.0
 * @category subscriptions
 */
export function watchState<TLedger>(
  address: string,
  provider: PublicDataProvider,
  ledgerParser: LedgerParser<TLedger>,
  onValue: (state: TLedger) => void,
  options?: WatchOptions,
): Unsubscribe {
  return streamToCallback(watchStateStream(address, provider, ledgerParser, options), onValue);
}

/**
 * Watch raw contract state changes. Returns an unsubscribe function.
 *
 * @since 0.9.0
 * @category subscriptions
 */
export function watchRawState(
  address: string,
  provider: PublicDataProvider,
  onValue: (state: unknown) => void,
  options?: WatchOptions,
): Unsubscribe {
  return streamToCallback(watchRawStateStream(address, provider, options), onValue);
}

// =============================================================================
// Standalone Contract Factory
// =============================================================================

/**
 * Options for creating a standalone contract (without Client).
 *
 * Accepts individual providers instead of requiring Client to assemble them.
 * Use the same module-loading options as `LoadContractOptions`.
 *
 * @typeParam M - The contract module type (for type inference)
 *
 * @since 0.6.0
 * @category model
 */
export interface CreateContractOptions<M extends ContractModule = ContractModule> extends LoadContractOptions<M> {
  /** Wallet provider for signing/balancing transactions */
  walletProvider: WalletProvider;
  /** Midnight provider for submitting transactions */
  midnightProvider: MidnightProvider;
  /** Public data provider for querying state */
  publicDataProvider: PublicDataProvider;
  /** Private state provider */
  privateStateProvider: PrivateStateProvider;
  /** Proof server URL */
  proofServerUrl: string;
  /** Enable logging (default: true) */
  logging?: boolean;
}

/**
 * Create a contract handle from individual providers (standalone, no Client needed).
 *
 * This is the Effect source of truth for standalone contract creation.
 *
 * @internal Effect source of truth
 */
function createContractEffect<M extends ContractModule>(
  options: CreateContractOptions<M>,
): Effect.Effect<LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>, ContractError> {
  const {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    proofServerUrl,
    logging = true,
    ...loadOptions
  } = options;

  const baseProviders = {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    networkConfig: { proofServer: proofServerUrl },
  };

  return loadContractModuleEffect(
    loadOptions as LoadContractOptions,
    { proofServer: proofServerUrl },
    baseProviders,
    logging,
  ).pipe(Effect.map((data) => createLoadedContractHandle(data) as LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>));
}

/**
 * Create a contract from individual providers without needing a Client.
 *
 * This enables the "Delete-Client Test" — building a complete dApp by wiring
 * module factories directly:
 *
 * @example
 * ```typescript
 * import * as Wallet from '@no-witness-labs/midday-sdk/Wallet';
 * import * as Config from '@no-witness-labs/midday-sdk/Config';
 * import * as Contract from '@no-witness-labs/midday-sdk/Contract';
 * import * as PrivateState from '@no-witness-labs/midday-sdk/PrivateState';
 *
 * const ctx = await Wallet.init(seed, networkConfig);
 * await Wallet.waitForSync(ctx);
 * const { walletProvider, midnightProvider } = Wallet.providers(ctx);
 * const publicDataProvider = Config.publicDataProvider(networkConfig);
 * const privateStateProvider = PrivateState.inMemoryProvider();
 *
 * const contract = await Contract.create({
 *   path: './contracts/counter',
 *   walletProvider,
 *   midnightProvider,
 *   publicDataProvider,
 *   privateStateProvider,
 *   proofServerUrl: networkConfig.proofServer,
 * });
 *
 * await contract.deploy();
 * await contract.call('increment');
 * ```
 *
 * @since 0.6.0
 * @category constructors
 */
export async function create<M extends ContractModule>(
  options: CreateContractOptions<M>,
): Promise<LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>> {
  const logging = options.logging ?? true;
  return runEffectWithLogging(createContractEffect(options), logging);
}

// =============================================================================
// Contract Handle Factories
// =============================================================================

/**
 * Create a LoadedContract handle from loaded data.
 *
 * @internal Used by Client to create contract handles
 */
export function createLoadedContractHandle(data: LoadedContractData): LoadedContract {
  return {
    module: data.module,
    providers: data.providers,

    deploy: async (options) => {
      const deployed = await runEffectWithLogging(deployContractEffect(data, options), data.logging);
      return createDeployedContractHandle(deployed);
    },
    join: async (address, options) => {
      const deployed = await runEffectWithLogging(joinContractEffect(data, address, options), data.logging);
      return createDeployedContractHandle(deployed);
    },

    effect: {
      deploy: (options) =>
        deployContractEffect(data, options).pipe(
          Effect.map(createDeployedContractHandle),
        ),
      join: (address, options) =>
        joinContractEffect(data, address, options).pipe(
          Effect.map(createDeployedContractHandle),
        ),
    },
  };
}

/**
 * Create a DeployedContract handle from deployed data.
 *
 * Builds the typed `actions` proxy from the deployed contract instance's `callTx` map.
 *
 * @internal
 */
export function createDeployedContractHandle(data: DeployedContractData): DeployedContract {
  // Build actions proxy — each key in callTx becomes a direct method
  const actions: Record<string, (...args: unknown[]) => Promise<CallResult>> = {};
  const effectActions: Record<string, (...args: unknown[]) => Effect.Effect<CallResult, ContractError>> = {};

  for (const key of Object.keys(data.instance.callTx)) {
    actions[key] = (...args) =>
      runEffectWithLogging(callContractEffect(data, key, ...args), data.logging);
    effectActions[key] = (...args) =>
      callContractEffect(data, key, ...args);
  }

  return {
    address: data.address,
    module: data.module,
    providers: data.providers,

    actions,

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

    onStateChange: (callback, options) =>
      streamToCallback(watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options), callback),
    watchState: (options) =>
      streamToAsyncIterator(watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options)),
    onRawStateChange: (callback, options) =>
      streamToCallback(watchRawStateStream(data.address, data.providers.publicDataProvider, options), callback),
    watchRawState: (options) =>
      streamToAsyncIterator(watchRawStateStream(data.address, data.providers.publicDataProvider, options)),

    effect: {
      actions: effectActions,
      call: (action, ...args) => callContractEffect(data, action, ...args),
      getState: () => contractStateEffect(data),
      getStateAt: (blockHeight) => contractStateAtEffect(data, blockHeight),
      ledgerState: () => ledgerStateEffect(data),
      ledgerStateAt: (blockHeight) => ledgerStateAtEffect(data, blockHeight),
      watchState: (options) =>
        watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options),
      watchRawState: (options) =>
        watchRawStateStream(data.address, data.providers.publicDataProvider, options),
    },
  };
}

/**
 * @deprecated Use `createLoadedContractHandle` instead.
 * @internal
 */
export const createContractHandle = createLoadedContractHandle;

/**
 * Create a ReadonlyContract handle from a ledger parser and provider.
 *
 * @internal Used by Client.createReadonly().loadContract()
 */
export function createReadonlyContractHandle<TLedger>(
  ledgerParser: LedgerParser<TLedger>,
  provider: PublicDataProvider,
): ReadonlyContract<TLedger> {
  return {
    ledgerParser,

    readState: (address) =>
      runEffectWithLogging(readStateEffect(address, provider, ledgerParser), false),
    readStateAt: (address, blockHeight) =>
      runEffectWithLogging(readStateEffect(address, provider, ledgerParser, blockHeight), false),
    readRawState: (address) =>
      runEffectWithLogging(readRawStateEffect(address, provider), false),
    readRawStateAt: (address, blockHeight) =>
      runEffectWithLogging(readRawStateEffect(address, provider, blockHeight), false),

    onStateChange: (address, callback, options) =>
      streamToCallback(watchStateStream(address, provider, ledgerParser, options), callback),
    watchState: (address, options) =>
      streamToAsyncIterator(watchStateStream(address, provider, ledgerParser, options)),
    onRawStateChange: (address, callback, options) =>
      streamToCallback(watchRawStateStream(address, provider, options), callback),
    watchRawState: (address, options) =>
      streamToAsyncIterator(watchRawStateStream(address, provider, options)),

    effect: {
      readState: (address) => readStateEffect(address, provider, ledgerParser),
      readStateAt: (address, blockHeight) => readStateEffect(address, provider, ledgerParser, blockHeight),
      readRawState: (address) => readRawStateEffect(address, provider),
      readRawStateAt: (address, blockHeight) => readRawStateEffect(address, provider, blockHeight),
      watchState: (address, options) =>
        watchStateStream(address, provider, ledgerParser, options),
      watchRawState: (address, options) =>
        watchRawStateStream(address, provider, options),
    },
  };
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

// =============================================================================
// Effect Namespace
// =============================================================================

/**
 * Raw Effect APIs for advanced users who want to compose Effects.
 *
 * @since 0.6.0
 * @category effect
 */
export const effect = {
  create: createContractEffect,
  readState: readStateEffect,
  readRawState: readRawStateEffect,
  watchState: watchStateStream,
  watchRawState: watchRawStateStream,
};
