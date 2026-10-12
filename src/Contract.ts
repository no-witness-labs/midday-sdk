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
 * await contract.actions.increment();
 * const state = await contract.readState();
 *
 * // Effect user
 * const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 * yield* contract.effect.deploy();
 * yield* contract.effect.actions.increment();
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Data, Duration, Effect, Stream } from 'effect';
import {
  findDeployedContract,
  createUnprovenDeployTx,
  submitTxAsync,
  createCircuitCallTxInterface,
} from '@midnight-ntwrk/midnight-js-contracts';
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
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import { runEffectWithLogging } from './Runtime.js';
import * as PrivateState from './PrivateState.js';

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

/**
 * An operation exceeded its configured timeout. One class for the whole SDK:
 * `operation` is `'deploy'`, `'join'` or `'waitForTx'`; `txId` is set when known.
 *
 * @since 0.2.14
 * @category errors
 */
export class TxTimeoutError extends Data.TaggedError('TxTimeoutError')<{
  readonly operation: string;
  readonly timeout: number;
  readonly message: string;
  readonly txId?: string;
}> {}

/**
 * Contract state lookup returned no result at the given address (and optionally
 * at the given block height). Distinct from `ContractError` because consumers
 * may want a "not yet deployed → redirect to create flow" UX rather than
 * treating it as a crash.
 *
 * @since 0.6.3
 * @category errors
 */
export class ContractStateNotFoundError extends Data.TaggedError('ContractStateNotFoundError')<{
  readonly address: string;
  readonly blockHeight?: number;
  readonly message: string;
}> {}

/**
 * `loadContract` was called without one of the required argument shapes:
 * (1) `module` + `zkConfig`, (2) `path` (Node.js), or
 * (3) `moduleUrl` + `zkConfigBaseUrl` (browser).
 *
 * @since 0.6.3
 * @category errors
 */
export class ContractLoadArgsError extends Data.TaggedError('ContractLoadArgsError')<{
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
 * and maps the return type to `Promise<FinalizedReceipt>`.
 *
 * @example
 * ```typescript
 * // Given a contract with: increment(ctx, amount: bigint), decrement(ctx)
 * // InferActions<M> = { increment(amount: bigint): Promise<FinalizedReceipt>; decrement(): Promise<FinalizedReceipt> }
 * ```
 *
 * @category type
 */
 
export type InferActions<M> = M extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Contract: new (...args: any[]) => { impureCircuits: infer IC };
} ? {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof IC]: IC[K] extends (context: any, ...args: infer A) => any
    ? (...args: A) => Promise<FinalizedReceipt>
    : (...args: unknown[]) => Promise<FinalizedReceipt>;
} : Record<string, (...args: unknown[]) => Promise<FinalizedReceipt>>;

/**
 * Shorthand for `LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>`.
 *
 * @example
 * ```typescript
 * import * as CounterContract from './contracts/counter/contract/index.js';
 * let loaded: LoadedContractFor<typeof CounterContract>;
 * ```
 *
 * @since 0.3.0
 * @category type
 */
export type LoadedContractFor<M extends ContractModule> =
  LoadedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>;

/**
 * Shorthand for `DeployedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>`.
 *
 * @example
 * ```typescript
 * import * as CounterContract from './contracts/counter/contract/index.js';
 * let contract: DeployedContractFor<typeof CounterContract>;
 * // contract.readState() returns Promise<{ counter: bigint }>
 * ```
 *
 * @since 0.3.0
 * @category type
 */
export type DeployedContractFor<M extends ContractModule> =
  DeployedContract<InferLedger<M>, InferCircuits<M>, InferActions<M>>;

/**
 * Convert Promise-based actions to Effect-based actions.
 *
 * @category type
 */
export type ToEffectActions<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<any>
    ? (...args: A) => Effect.Effect<FinalizedReceipt, ContractError>
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
export interface SubmitDeployOptions {
  /** Initial private state (defaults to {}) */
  initialPrivateState?: unknown;
}

export interface DeployOptions extends SubmitDeployOptions {
  /** Timeout in milliseconds for finalization. Fails with `TxTimeoutError` if the deploy has not landed in time. */
  timeout?: number;
}

/**
 * Options for joining a contract.
 *
 * @since 0.2.0
 * @category model
 */
export interface JoinOptions {
  /**
   * Private state to store for this contract, replacing whatever is stored.
   * Omit to keep the stored state; when nothing is stored yet, `{}` is used.
   */
  initialPrivateState?: unknown;
  /** Timeout in milliseconds. Throws `TxTimeoutError` if joining isn't finalized in time. */
  timeout?: number;
}

/**
 * Data about a finalized transaction.
 *
 * @since 0.2.0
 * @category model
 */
export type TxStatus = 'SucceedEntirely' | 'FailEntirely' | 'FailFallible';

/**
 * A transaction that has landed on-chain. `txId` is the identifier the SDK
 * watched (one of `identifiers`); `txHash` is the enclosing transaction's hash,
 * which can differ when transactions are merged. `status` is the execution
 * outcome: a finalized transaction can still have failed.
 *
 * @since 0.7.0
 * @category model
 */
export interface FinalizedReceipt {
  readonly phase: 'finalized';
  readonly txId: string;
  readonly identifiers: readonly string[];
  readonly txHash: string;
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly status: TxStatus;
}

/**
 * A deployment that has been submitted but not yet observed on-chain.
 * `wait()` resolves to the usable handle once the transaction lands with
 * `SucceedEntirely`, and fails otherwise.
 *
 * @since 0.7.0
 * @category model
 */
export interface SubmittedDeploy<
  TLedger = unknown,
  TCircuits extends string = string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TActions extends Record<string, (...args: any[]) => Promise<FinalizedReceipt>> = Record<string, (...args: unknown[]) => Promise<FinalizedReceipt>>,
> {
  readonly phase: 'submitted';
  readonly address: string;
  readonly txId: string;
  wait(options?: WaitOptions): Promise<DeployedContract<TLedger, TCircuits, TActions>>;
  readonly effect: {
    wait(options?: WaitOptions): Effect.Effect<DeployedContract<TLedger, TCircuits, TActions>, ContractError | TxTimeoutError>;
  };
}

/**
 * Options for waiting on finalization.
 *
 * @since 0.7.0
 * @category model
 */
export interface WaitOptions {
  /** Timeout in milliseconds. Fails with `TxTimeoutError` if the transaction has not landed in time. */
  timeout?: number;
}

/** @deprecated name kept for one release; use {@link FinalizedReceipt}. */
export type CallResult = FinalizedReceipt;

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
  TActions extends Record<string, (...args: any[]) => Promise<FinalizedReceipt>> = Record<string, (...args: unknown[]) => Promise<FinalizedReceipt>>,
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
   * @throws {TxTimeoutError} When the timeout is exceeded
   */
  deploy(options?: DeployOptions): Promise<DeployedContract<TLedger, TCircuits, TActions>>;

  /**
   * Submit the deployment and return without waiting for it to land. Use the
   * result's `address`/`txId` for progress and `wait()` for the usable handle.
   */
  submitDeploy(options?: SubmitDeployOptions): Promise<SubmittedDeploy<TLedger, TCircuits, TActions>>;

  /**
   * Join an existing contract at an address.
   *
   * @returns A deployed contract handle ready for calls.
   * @throws {ContractError} When joining fails
   * @throws {TxTimeoutError} When the timeout is exceeded
   */
  join(address: string, options?: JoinOptions): Promise<DeployedContract<TLedger, TCircuits, TActions>>;

  /** Effect versions of loaded contract methods */
  readonly effect: {
    deploy(options?: DeployOptions): Effect.Effect<DeployedContract<TLedger, TCircuits, TActions>, ContractError | TxTimeoutError>;
    submitDeploy(options?: SubmitDeployOptions): Effect.Effect<SubmittedDeploy<TLedger, TCircuits, TActions>, ContractError>;
    join(address: string, options?: JoinOptions): Effect.Effect<DeployedContract<TLedger, TCircuits, TActions>, ContractError | TxTimeoutError>;
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
  TActions extends Record<string, (...args: any[]) => Promise<FinalizedReceipt>> = Record<string, (...args: unknown[]) => Promise<FinalizedReceipt>>,
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
   * await contract.actions.increment(5n);
   * ```
   *
   * @since 0.6.0
   */
  readonly actions: TActions;

  /**
   * Call a contract action by name (untyped fallback).
   *
   * Prefer `contract.actions.actionName(...)` for type-safe calls.
   */
  call(action: TCircuits, ...args: unknown[]): Promise<FinalizedReceipt>;

  /** Get raw contract state. */
  readStateValue(): Promise<unknown>;

  /** Get raw contract state at a specific block height. */
  readStateValueAt(blockHeight: number): Promise<unknown>;

  /** Get parsed ledger state. */
  readState(): Promise<TLedger>;

  /** Get parsed ledger state at a specific block height. */
  readStateAt(blockHeight: number): Promise<TLedger>;

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
   * @since 0.2.14
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
   * @since 0.2.14
   */
  watchState(options?: WatchOptions): AsyncIterableIterator<TLedger>;

  /** Watch for raw state changes (callback). */
  onStateValueChange(callback: (state: unknown) => void, options?: WatchOptions): Unsubscribe;

  /** Watch for raw state changes (async iterator). */
  watchStateValue(options?: WatchOptions): AsyncIterableIterator<unknown>;

  /** Effect versions of deployed contract methods */
  readonly effect: {
    /** Type-safe Effect action methods. */
    readonly actions: ToEffectActions<TActions>;
    call(action: TCircuits, ...args: unknown[]): Effect.Effect<FinalizedReceipt, ContractError>;
    readStateValue(): Effect.Effect<unknown, ContractError | ContractStateNotFoundError>;
    readStateValueAt(blockHeight: number): Effect.Effect<unknown, ContractError | ContractStateNotFoundError>;
    readState(): Effect.Effect<TLedger, ContractError | ContractStateNotFoundError>;
    readStateAt(blockHeight: number): Effect.Effect<TLedger, ContractError | ContractStateNotFoundError>;
    /** Watch parsed state as an Effect.Stream. */
    watchState(options?: WatchOptions): Stream.Stream<TLedger, ContractError>;
    /** Watch raw state as an Effect.Stream. */
    watchStateValue(options?: WatchOptions): Stream.Stream<unknown, ContractError>;
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
 * @since 0.2.14
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
  readStateValue(address: string): Promise<unknown>;

  /** Read raw contract state at an address and specific block height. */
  readStateValueAt(address: string, blockHeight: number): Promise<unknown>;

  /** Watch parsed state changes at an address (callback). */
  onStateChange(address: string, callback: (state: TLedger) => void, options?: WatchOptions): Unsubscribe;

  /** Watch parsed state changes at an address (async iterator). */
  watchState(address: string, options?: WatchOptions): AsyncIterableIterator<TLedger>;

  /** Watch raw state changes at an address (callback). */
  onStateValueChange(address: string, callback: (state: unknown) => void, options?: WatchOptions): Unsubscribe;

  /** Watch raw state changes at an address (async iterator). */
  watchStateValue(address: string, options?: WatchOptions): AsyncIterableIterator<unknown>;

  /** Effect versions of read-only methods. */
  readonly effect: {
    readState(address: string): Effect.Effect<TLedger, ContractError | ContractStateNotFoundError>;
    readStateAt(address: string, blockHeight: number): Effect.Effect<TLedger, ContractError | ContractStateNotFoundError>;
    readStateValue(address: string): Effect.Effect<unknown, ContractError | ContractStateNotFoundError>;
    readStateValueAt(address: string, blockHeight: number): Effect.Effect<unknown, ContractError | ContractStateNotFoundError>;
    watchState(address: string, options?: WatchOptions): Stream.Stream<TLedger, ContractError>;
    watchStateValue(address: string, options?: WatchOptions): Stream.Stream<unknown, ContractError>;
  };
}

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
 * Internal interface for deployed contract instance with callable transaction methods.
 * @internal
 */
/** The on-chain fields midnight-js reports for a finalized transaction. @internal */
export interface UpstreamFinalizedTxData {
  txId: string;
  identifiers: readonly string[];
  txHash: string;
  blockHeight: number;
  blockHash: string;
  status: string;
}

/** @internal */
export function toReceipt(data: UpstreamFinalizedTxData): FinalizedReceipt {
  const status = data.status;
  if (status !== 'SucceedEntirely' && status !== 'FailEntirely' && status !== 'FailFallible') {
    throw new ContractError({ cause: data, message: `Unknown transaction status '${String(status)}'` });
  }
  return {
    phase: 'finalized',
    txId: String(data.txId),
    identifiers: [...data.identifiers].map(String),
    txHash: String(data.txHash),
    blockHeight: data.blockHeight,
    blockHash: String(data.blockHash),
    status,
  };
}

interface DeployedContractInstance {
  callTx: Record<string, (...args: unknown[]) => Promise<{ public: UpstreamFinalizedTxData }>>;
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
): Effect.Effect<LoadedContractData, ContractError | ContractLoadArgsError> {
  return Effect.tryPromise({
    try: async () => {
      let module: ContractModule;
      let zkConfig: ZKConfigProvider<string>;

      if (options.path) {
        const { join } = await import('path');
        const { NodeZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');

        const modulePath = join(options.path, 'contract', 'index.js');
        module = await import(/* @vite-ignore */ modulePath);
        zkConfig = new NodeZkConfigProvider(options.path);
      } else if (options.moduleUrl && options.zkConfigBaseUrl) {
        const { HttpZkConfigProvider } = await import('./ZkConfig.js');
        module = await import(/* @vite-ignore */ options.moduleUrl);
        zkConfig = new HttpZkConfigProvider(options.zkConfigBaseUrl);
      } else if (options.module && options.zkConfig) {
        module = options.module;
        zkConfig = options.zkConfig;
      } else {
        throw new ContractLoadArgsError({
          message:
            'Contract loading requires one of: ' +
            '(1) module + zkConfig, ' +
            '(2) path (Node.js), or ' +
            '(3) moduleUrl + zkConfigBaseUrl (browser)',
        });
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
      cause instanceof ContractLoadArgsError
        ? cause
        : new ContractError({
            cause,
            message: `Failed to load contract: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
  });
}

// =============================================================================
// Provider Instrumentation (logging)
// =============================================================================

function instrumentProviders(providers: ContractProviders): ContractProviders {
  const log = (label: string) => console.log(`[midday-sdk] ${label} — ${new Date().toISOString()}`);

  return {
    ...providers,
    proofProvider: {
      ...providers.proofProvider,
      proveTx: async (...args) => {
        log('proofProvider.proveTx START');
        const result = await providers.proofProvider.proveTx(...args);
        log('proofProvider.proveTx DONE');
        return result;
      },
    },
    walletProvider: {
      ...providers.walletProvider,
      balanceTx: async (...args) => {
        log('walletProvider.balanceTx START');
        const result = await providers.walletProvider.balanceTx(...args);
        log('walletProvider.balanceTx DONE');
        return result;
      },
    },
    midnightProvider: {
      ...providers.midnightProvider,
      submitTx: async (...args) => {
        log('midnightProvider.submitTx START');
        const result = await providers.midnightProvider.submitTx(...args);
        log(`midnightProvider.submitTx DONE — txId: ${result}`);
        return result;
      },
    },
  };
}

// =============================================================================
// Contract Effects
// =============================================================================

interface SubmittedDeployData {
  readonly address: string;
  readonly txId: string;
  readonly wait: (options?: WaitOptions) => Effect.Effect<DeployedContractData, ContractError | TxTimeoutError>;
}

/**
 * Builds, proves, balances and submits the deploy transaction, stores the
 * private state and signing key, and returns a `wait` stage that resolves to
 * the deployed data once the transaction lands with `SucceedEntirely`.
 */
function submitDeployEffect(
  contractData: LoadedContractData,
  options?: SubmitDeployOptions,
): Effect.Effect<SubmittedDeployData, ContractError> {
  return Effect.gen(function* () {
    const { initialPrivateState = {} } = options ?? {};
    const { module, providers, logging } = contractData;

    yield* Effect.logDebug('Deploying contract...');

    const instrumentedProviders = logging ? instrumentProviders(providers) : providers;

    // Step 1: Create unproven deploy tx (gets contract address)
    const unprovenDeployTxData = yield* Effect.tryPromise({
      try: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createUnprovenDeployTx(instrumentedProviders as any, {
          compiledContract: module.compiledContract,
          privateStateId: module.privateStateId,
          initialPrivateState,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to create deploy tx: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const address = (unprovenDeployTxData as any).public.contractAddress as string;
    const boundPrivateState = PrivateState.boundToContract(providers.privateStateProvider, address);
    const boundProviders = { ...providers, privateStateProvider: boundPrivateState };
    yield* Effect.logDebug(`Contract address: ${address}`);

    // Step 2: Prove, balance, and submit (non-blocking — no watchForTxData)
    const txId = yield* Effect.tryPromise({
      try: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        submitTxAsync(instrumentedProviders as any, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          unprovenTx: (unprovenDeployTxData as any).private.unprovenTx,
        }),
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Failed to submit deploy tx: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
    yield* Effect.logDebug(`Deploy tx submitted: ${txId}`);

    // Step 3: Save private state and signing key. Written before finalization on
    // purpose: they are the recovery material for a deploy whose outcome is not
    // yet known.
    yield* Effect.tryPromise({
      try: async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        boundPrivateState.setContractAddress(address as any);
        if (module.privateStateId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await boundPrivateState.set(module.privateStateId, (unprovenDeployTxData as any).private.initialPrivateState);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await boundPrivateState.setSigningKey(address as any, (unprovenDeployTxData as any).private.signingKey);
      },
      catch: (cause) =>
        new ContractError({
          cause,
          message: `Deploy tx ${String(txId)} submitted (address: ${address}) but storing its private state failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callTx = createCircuitCallTxInterface((logging ? instrumentProviders(boundProviders) : boundProviders) as any, module.compiledContract as any, address as any, module.privateStateId);
    const deployed: DeployedContractData = {
      address,
      instance: { callTx } as unknown as DeployedContractInstance,
      module,
      providers: boundProviders,
      logging,
    };

    // Step 4: the wait stage. A deploy that lands as a failure must not yield a usable handle.
    const wait = (waitOptions?: WaitOptions): Effect.Effect<DeployedContractData, ContractError | TxTimeoutError> => {
      const base = Effect.gen(function* () {
        const deployTxData = yield* Effect.tryPromise({
          try: () => providers.publicDataProvider.watchForTxData(String(txId)),
          catch: (cause) =>
            new ContractError({
              cause,
              message: `Deploy tx ${String(txId)} submitted (address: ${address}) but finalization watch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });
        if (deployTxData.status !== SucceedEntirely) {
          return yield* Effect.fail(
            new ContractError({
              cause: deployTxData,
              message: `Deploy tx ${String(txId)} for ${address} landed with status '${String(deployTxData.status)}'`,
            }),
          );
        }
        yield* Effect.logDebug(`Contract deployed at: ${address}`);
        return deployed;
      });
      if (waitOptions?.timeout == null) return base;
      return Effect.timeoutFail(base, {
        duration: Duration.millis(waitOptions.timeout),
        onTimeout: () =>
          new TxTimeoutError({
            operation: 'deploy',
            txId: String(txId),
            timeout: waitOptions.timeout!,
            message: `Deploy tx ${String(txId)} for ${address} was not finalized within ${waitOptions.timeout}ms`,
          }),
      });
    };

    return { address, txId: String(txId), wait };
  });
}

/** Submit and wait. `timeout` bounds the whole pipeline (proving, submission and finalization). */
function deployContractEffect(
  contractData: LoadedContractData,
  options?: DeployOptions,
): Effect.Effect<DeployedContractData, ContractError | TxTimeoutError> {
  const base = submitDeployEffect(contractData, options).pipe(Effect.flatMap((submitted) => submitted.wait()));
  if (options?.timeout == null) return base;
  return Effect.timeoutFail(base, {
    duration: Duration.millis(options.timeout),
    onTimeout: () =>
      new TxTimeoutError({
        operation: 'deploy',
        timeout: options.timeout!,
        message: `Contract deployment was not finalized within ${options.timeout}ms`,
      }),
  });
}

function joinContractEffect(
  contractData: LoadedContractData,
  address: string,
  options?: JoinOptions,
): Effect.Effect<DeployedContractData, ContractError | TxTimeoutError> {
  const base = Effect.gen(function* () {
    // midnight-js replaces the stored private state whenever `initialPrivateState`
    // is present in its options, so it is only passed when the caller asked for a
    // replacement, or when nothing is stored yet (first join in this store).
    const replacement = options && 'initialPrivateState' in options ? { initialPrivateState: options.initialPrivateState } : undefined;
    const { module, providers: sharedProviders, logging } = contractData;
    const providers = {
      ...sharedProviders,
      privateStateProvider: PrivateState.boundToContract(sharedProviders.privateStateProvider, address),
    };

    yield* Effect.logDebug(`Joining contract at ${address}...`);

    const privateState = yield* Effect.tryPromise({
      try: async () => {
        if (replacement) return replacement;
        if (!module.privateStateId) return {};
        const stored = await providers.privateStateProvider.get(module.privateStateId);
        return stored === null ? { initialPrivateState: {} } : {};
      },
      catch: (cause) =>
        new ContractError({ cause, message: `Failed to read stored private state for ${address}: ${cause instanceof Error ? cause.message : String(cause)}` }),
    });

    const deployed = yield* Effect.tryPromise({
      try: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findDeployedContract(providers as any, {
          contractAddress: address,
          compiledContract: module.compiledContract,
          privateStateId: module.privateStateId,
          ...privateState,
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

  if (options?.timeout != null) {
    return Effect.timeoutFail(base, {
      duration: Duration.millis(options.timeout),
      onTimeout: () =>
        new TxTimeoutError({
          operation: 'join',
          timeout: options.timeout!,
          message: `Contract join at ${address} was not finalized within ${options.timeout}ms`,
        }),
    });
  }

  return base;
}

function callContractEffect(
  contractData: DeployedContractData,
  action: string,
  ...args: unknown[]
): Effect.Effect<FinalizedReceipt, ContractError> {
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

    return yield* Effect.try({
      try: () => toReceipt(txData.public),
      catch: (e) => (e instanceof ContractError ? e : new ContractError({ cause: e, message: String(e) })),
    });
  });
}

function contractStateEffect(
  contractData: DeployedContractData,
): Effect.Effect<unknown, ContractError | ContractStateNotFoundError> {
  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const contractState = await contractData.providers.publicDataProvider.queryContractState(address);
      if (!contractState) {
        throw new ContractStateNotFoundError({
          address,
          message: `Contract state not found at ${address}`,
        });
      }
      return contractState.data;
    },
    catch: (cause) =>
      cause instanceof ContractStateNotFoundError
        ? cause
        : new ContractError({
            cause,
            message: `Failed to query contract state: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
  });
}

function contractStateAtEffect(
  contractData: DeployedContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError | ContractStateNotFoundError> {
  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const contractState = await contractData.providers.publicDataProvider.queryContractState(address, {
        type: 'blockHeight',
        blockHeight,
      });
      if (!contractState) {
        throw new ContractStateNotFoundError({
          address,
          blockHeight,
          message: `Contract state not found at ${address} at block ${blockHeight}`,
        });
      }
      return contractState.data;
    },
    catch: (cause) =>
      cause instanceof ContractStateNotFoundError
        ? cause
        : new ContractError({
            cause,
            message: `Failed to query contract state at block ${blockHeight}: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
  });
}

function ledgerStateEffect(
  contractData: DeployedContractData,
): Effect.Effect<unknown, ContractError | ContractStateNotFoundError> {
  return contractStateEffect(contractData).pipe(
    Effect.map((data) => contractData.module.ledger(data)),
  );
}

function ledgerStateAtEffect(
  contractData: DeployedContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError | ContractStateNotFoundError> {
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
 * @category model
 */
export type PublicDataProvider = ReturnType<typeof indexerPublicDataProvider>;

/**
 * Ledger parser function — converts raw contract state to typed ledger.
 *
 * Every compiled Compact contract exports a `ledger()` function matching this signature.
 *
 * @category model
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LedgerParser<TLedger> = (state: any) => TLedger;

/**
 * Function returned by callback-style watch methods. Call it to stop watching.
 *
 * @category model
 */
export type Unsubscribe = () => void;

/**
 * Options for watching contract state changes.
 *
 * Controls where the subscription stream starts from. Maps to the indexer's
 * `ContractStateObservableConfig` under the hood.
 *
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
): Effect.Effect<unknown, ContractError | ContractStateNotFoundError> {
  return Effect.tryPromise({
    try: async () => {
      const opts = atBlock !== undefined
        ? { type: 'blockHeight' as const, blockHeight: atBlock }
        : undefined;
      const contractState = await provider.queryContractState(address, opts);
      if (!contractState) {
        throw new ContractStateNotFoundError({
          address,
          blockHeight: atBlock,
          message:
            atBlock !== undefined
              ? `Contract state not found at ${address} at block ${atBlock}`
              : `Contract state not found at ${address}`,
        });
      }
      return contractState.data;
    },
    catch: (cause) =>
      cause instanceof ContractStateNotFoundError
        ? cause
        : new ContractError({
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
): Effect.Effect<TLedger, ContractError | ContractStateNotFoundError> {
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
 * @since 0.6.3
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
 * @since 0.6.3
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
 * @since 0.6.3
 * @category queries
 */
export async function readStateValue(
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
 * @since 0.6.3
 * @category queries
 */
export async function readStateValueAt(
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
 * @since 0.2.14
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
 * @category subscriptions
 */
export function watchStateValue(
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
  /** Enable debug logging (default: false) */
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
): Effect.Effect<LoadedContractFor<M>, ContractError | ContractLoadArgsError> {
  const {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    proofServerUrl,
    logging = false,
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
  ).pipe(Effect.map((data) => createLoadedContractHandle(data) as LoadedContractFor<M>));
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
 * const wallet = await Wallet.fromSeed(seed, networkConfig);
 * const { walletProvider, midnightProvider } = wallet.providers();
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
 * await contract.actions.increment();
 * ```
 *
 * @since 0.6.0
 * @category constructors
 */
export async function create<M extends ContractModule>(
  options: CreateContractOptions<M>,
): Promise<LoadedContractFor<M>> {
  const logging = options.logging ?? false;
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
    submitDeploy: async (options) => {
      const submitted = await runEffectWithLogging(submitDeployEffect(data, options), data.logging);
      return createSubmittedDeployHandle(submitted, data.logging);
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
      submitDeploy: (options) =>
        submitDeployEffect(data, options).pipe(Effect.map((submitted) => createSubmittedDeployHandle(submitted, data.logging))),
      join: (address, options) =>
        joinContractEffect(data, address, options).pipe(
          Effect.map(createDeployedContractHandle),
        ),
    },
  };
}

function createSubmittedDeployHandle(submitted: SubmittedDeployData, logging: boolean): SubmittedDeploy {
  const waitEff = (options?: WaitOptions) => submitted.wait(options).pipe(Effect.map(createDeployedContractHandle));
  return {
    phase: 'submitted',
    address: submitted.address,
    txId: submitted.txId,
    wait: (options) => runEffectWithLogging(waitEff(options), logging),
    effect: { wait: waitEff },
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
  const actions: Record<string, (...args: unknown[]) => Promise<FinalizedReceipt>> = {};
  const effectActions: Record<string, (...args: unknown[]) => Effect.Effect<FinalizedReceipt, ContractError>> = {};

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
    readStateValue: () =>
      runEffectWithLogging(contractStateEffect(data), data.logging),
    readStateValueAt: (blockHeight) =>
      runEffectWithLogging(contractStateAtEffect(data, blockHeight), data.logging),
    readState: () =>
      runEffectWithLogging(ledgerStateEffect(data), data.logging),
    readStateAt: (blockHeight) =>
      runEffectWithLogging(ledgerStateAtEffect(data, blockHeight), data.logging),

    onStateChange: (callback, options) =>
      streamToCallback(watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options), callback),
    watchState: (options) =>
      streamToAsyncIterator(watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options)),
    onStateValueChange: (callback, options) =>
      streamToCallback(watchRawStateStream(data.address, data.providers.publicDataProvider, options), callback),
    watchStateValue: (options) =>
      streamToAsyncIterator(watchRawStateStream(data.address, data.providers.publicDataProvider, options)),

    effect: {
      actions: effectActions,
      call: (action, ...args) => callContractEffect(data, action, ...args),
      readStateValue: () => contractStateEffect(data),
      readStateValueAt: (blockHeight) => contractStateAtEffect(data, blockHeight),
      readState: () => ledgerStateEffect(data),
      readStateAt: (blockHeight) => ledgerStateAtEffect(data, blockHeight),
      watchState: (options) =>
        watchStateStream(data.address, data.providers.publicDataProvider, data.module.ledger, options),
      watchStateValue: (options) =>
        watchRawStateStream(data.address, data.providers.publicDataProvider, options),
    },
  };
}

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
    readStateValue: (address) =>
      runEffectWithLogging(readRawStateEffect(address, provider), false),
    readStateValueAt: (address, blockHeight) =>
      runEffectWithLogging(readRawStateEffect(address, provider, blockHeight), false),

    onStateChange: (address, callback, options) =>
      streamToCallback(watchStateStream(address, provider, ledgerParser, options), callback),
    watchState: (address, options) =>
      streamToAsyncIterator(watchStateStream(address, provider, ledgerParser, options)),
    onStateValueChange: (address, callback, options) =>
      streamToCallback(watchRawStateStream(address, provider, options), callback),
    watchStateValue: (address, options) =>
      streamToAsyncIterator(watchRawStateStream(address, provider, options)),

    effect: {
      readState: (address) => readStateEffect(address, provider, ledgerParser),
      readStateAt: (address, blockHeight) => readStateEffect(address, provider, ledgerParser, blockHeight),
      readStateValue: (address) => readRawStateEffect(address, provider),
      readStateValueAt: (address, blockHeight) => readRawStateEffect(address, provider, blockHeight),
      watchState: (address, options) =>
        watchStateStream(address, provider, ledgerParser, options),
      watchStateValue: (address, options) =>
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

  const { join } = await import('path');
  const { NodeZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');

  const modulePath = join(contractPath, moduleSubdir, moduleEntry);
  const module = (await import(/* @vite-ignore */ modulePath)) as T;
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

  const module = (await import(/* @vite-ignore */ moduleUrl)) as T;
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
  readStateValue: readRawStateEffect,
  watchState: watchStateStream,
  watchStateValue: watchRawStateStream,
};
