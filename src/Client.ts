/**
 * High-level client for interacting with Midnight Network contracts.
 *
 * ## API Design
 *
 * This module uses a **Client-centric hub pattern** following the Effect hybrid pattern:
 *
 * - **Effect is source of truth**: All logic in Effect functions
 * - **Client is the hub**: All operations flow from the client
 * - **Two interfaces**: `.effect.method()` for Effect users, `.method()` for Promise users
 * - **Effects call Effects, Promises call Promises**: Never mix execution models
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user - simple flow
 * const client = await Midday.Client.create(config);
 * const contract = await client.loadContract({ path: './contracts/counter' });
 * await contract.deploy();
 * await contract.call('increment');
 * const state = await contract.ledgerState();
 *
 * // Effect user - compositional
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.effect.create(config);
 *   const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 *   yield* contract.effect.deploy();
 *   yield* contract.effect.call('increment');
 *   const state = yield* contract.effect.ledgerState();
 * });
 * ```
 *
 * @since 0.1.0
 * @module
 */

import { Context, Data, Effect, Layer, Scope } from 'effect';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Transaction } from '@midnight-ntwrk/ledger-v7';
import type { ZKConfigProvider, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import * as Config from './Config.js';
import * as Wallet from './Wallet.js';
import * as Providers from './Providers.js';
import type { NetworkConfig } from './Config.js';
import type { BaseProviders, ContractProviders, StorageConfig, CreateBaseProvidersOptions } from './Providers.js';
import type { WalletContext } from './Wallet.js';
import type { WalletConnection } from './wallet/connector.js';
import { createWalletProviders } from './wallet/provider.js';
import { runEffectWithLogging } from './utils/effect-runtime.js';
import { bytesToHex, hexToBytes } from './utils/hex.js';

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
  /** Fee relay — delegate fee payment to a funded wallet so non-funded wallets can transact.
   * - `{ seed }` — Node.js: initialize a local wallet from seed
   * - `{ url }` — Browser: proxy to a fee relay HTTP server
   */
  feeRelay?: { seed: string } | { url: string };
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
  Contract: new (...args: any[]) => { impureCircuits: infer IC }
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
// Internal Data Types (Plain Data, No Methods)
// =============================================================================

/**
 * Internal client data (plain object).
 * Uses BaseProviders (no zkConfig) - zkConfig is per-contract.
 * @internal
 */
interface ClientData {
  readonly wallet: WalletContext | null;
  readonly relayerWallet: WalletContext | null;
  readonly networkConfig: NetworkConfig;
  readonly providers: BaseProviders;
  readonly logging: boolean;
}

/**
 * Internal contract data (plain object).
 * Represents either a loaded (pre-deploy) or deployed contract.
 * @internal
 */
interface ContractData {
  readonly module: LoadedContractModule;
  readonly providers: ContractProviders;
  readonly logging: boolean;
  /** Address (undefined until deployed/joined) */
  readonly address: string | undefined;
  /** Deployed instance (undefined until deployed/joined) */
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
// Public Handle Interfaces (Objects with Methods)
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
  /** Base providers (for advanced use - no zkConfig) */
  readonly providers: BaseProviders;
  /** Raw wallet context (null if using wallet connector) */
  readonly wallet: WalletContext | null;
  /** Fee relay wallet context (null if fee relay not configured) */
  readonly relayerWallet: WalletContext | null;

  // Promise API - for simple usage
  /**
   * Load a contract module. Returns a Contract in "loaded" state.
   * Call `deploy()` or `join()` on it to connect to the network.
   *
   * @typeParam M - Contract module type (inferred from options.module)
   *
   * @example
   * ```typescript
   * // Load with module - types are inferred!
   * import * as CounterContract from './contracts/counter/contract';
   *
   * const contract = await client.loadContract({
   *   module: CounterContract,
   *   zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
   * });
   * const state = await contract.ledgerState(); // state.counter is typed
   * await contract.call('increment'); // autocompletes circuit names
   * ```
   */
  loadContract<M extends ContractModule>(
    options: LoadContractOptions<M>
  ): Promise<Contract<InferLedger<M>, InferCircuits<M>>>;

  /**
   * Wait for a transaction to be finalized.
   */
  waitForTx(txHash: string): Promise<FinalizedTxData>;

  /**
   * Close the client and release all resources (wallet connections, WebSocket subscriptions).
   *
   * Call this before shutting down to avoid leaked connections and noisy errors.
   *
   * @example
   * ```typescript
   * const client = await Midday.Client.create(config);
   * try {
   *   // ... use client ...
   * } finally {
   *   await client.close();
   * }
   * ```
   *
   * @since 0.2.9
   */
  close(): Promise<void>;

  /**
   * Supports `await using client = await Midday.Client.create(config);`
   * Requires TypeScript 5.2+ and ES2022+ target.
   *
   * @since 0.2.9
   */
  [Symbol.asyncDispose](): Promise<void>;

  // Effect API - for composition
  /** Effect versions of client methods */
  readonly effect: {
    loadContract<M extends ContractModule>(
      options: LoadContractOptions<M>
    ): Effect.Effect<Contract<InferLedger<M>, InferCircuits<M>>, ClientError>;
    waitForTx(txHash: string): Effect.Effect<FinalizedTxData, ClientError>;
    close(): Effect.Effect<void, ClientError>;
  };
}

/**
 * Contract state: either "loaded" (pre-deploy) or "deployed" (connected to network).
 *
 * @since 0.6.0
 * @category model
 */
export type ContractState = 'loaded' | 'deployed';

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

  // Lifecycle methods (loaded → deployed)
  /**
   * Deploy a new contract instance.
   * Transitions state from "loaded" to "deployed".
   *
   * @throws {ContractError} If already deployed
   * @example
   * ```typescript
   * await contract.deploy();
   * console.log(contract.address); // Now available
   * ```
   */
  deploy(options?: DeployOptions): Promise<void>;

  /**
   * Join an existing contract at an address.
   * Transitions state from "loaded" to "deployed".
   *
   * @throws {ContractError} If already deployed
   * @example
   * ```typescript
   * await contract.join('0x...');
   * ```
   */
  join(address: string, options?: JoinOptions): Promise<void>;

  // Contract methods (require deployed state)
  /**
   * Call a contract action.
   *
   * @throws {ContractError} If not deployed
   * @example
   * ```typescript
   * const result = await contract.call('increment');
   * ```
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
   * @example
   * ```typescript
   * const state = await contract.ledgerState();
   * console.log(state.counter); // Typed!
   * ```
   */
  ledgerState(): Promise<TLedger>;

  /**
   * Get parsed ledger state at a specific block height.
   *
   * @throws {ContractError} If not deployed
   */
  ledgerStateAt(blockHeight: number): Promise<TLedger>;

  // Effect API
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
// Effect Implementations (Source of Truth)
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
      feeRelay,
    } = config;

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

    // Create base providers (no zkConfig - that's per-contract)
    const providerOptions: CreateBaseProvidersOptions = {
      networkConfig,
      privateStateProvider,
      storageConfig: storage,
      feeRelayWallet: relayerWallet ?? undefined,
    };

    const providers = Providers.createBase(walletContext, providerOptions);

    return {
      wallet: walletContext,
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

    // Create network config from wallet configuration
    const networkConfig: NetworkConfig = {
      networkId: connection.config.networkId,
      indexer: connection.config.indexerUri,
      indexerWS: connection.config.indexerWsUri,
      node: connection.config.substrateNodeUri,
      proofServer: connection.config.proverServerUri ?? '',
    };

    // Create wallet providers from connection
    let { walletProvider, midnightProvider } = createWalletProviders(connection.wallet, connection.addresses);

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
          // FinalizedTransaction = Transaction<SignatureEnabled, Proof, Binding>
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

    // Create base providers (no zkConfig - that's per-contract)
    const providerOptions: CreateBaseProvidersOptions = {
      networkConfig,
      privateStateProvider,
    };

    // Create providers using the wallet providers
    const providers = Providers.createBaseFromWalletProviders(walletProvider, midnightProvider, providerOptions);

    yield* Effect.logDebug('Connected to wallet');

    return {
      wallet: null,
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
): Effect.Effect<ContractData, ClientError> {
  return Effect.tryPromise({
    try: async () => {
      let module: ContractModule;
      let zkConfig: ZKConfigProvider<string>;

      // Determine loading method
      if (options.path) {
        // Path-based loading (Node.js) — dynamic import to avoid bundlers following the chain
        const { join } = await import(/* @vite-ignore */ 'path');
        const { NodeZkConfigProvider } = await import(/* @vite-ignore */ '@midnight-ntwrk/midnight-js-node-zk-config-provider');

        const modulePath = join(options.path, 'contract', 'index.js');
        module = await import(/* @vite-ignore */ modulePath);
        zkConfig = new NodeZkConfigProvider(options.path);
      } else if (options.moduleUrl && options.zkConfigBaseUrl) {
        // URL-based loading (browser)
        const { HttpZkConfigProvider } = await import('./providers/HttpZkConfigProvider.js');

        module = await import(/* @vite-ignore */ /* webpackIgnore: true */ options.moduleUrl);
        zkConfig = new HttpZkConfigProvider(options.zkConfigBaseUrl);
      } else if (options.module && options.zkConfig) {
        // Direct loading
        module = options.module;
        zkConfig = options.zkConfig;
      } else {
        throw new Error(
          'Contract loading requires one of: ' +
          '(1) module + zkConfig, ' +
          '(2) path (Node.js), or ' +
          '(3) moduleUrl + zkConfigBaseUrl (browser)'
        );
      }

      // Create the v7 CompiledContract wrapper
      const witnesses = options.witnesses ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiledContract: any = CompiledContract.make('contract', module.Contract as any);
      // IMPORTANT: Always call withWitnesses - even with empty {} - because the 
      // contract constructor expects a witnesses object (context.witnesses must be defined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiledContractWithWitnesses = (CompiledContract.withWitnesses as any)(compiledContract, witnesses);

      const loadedModule: LoadedContractModule = {
        Contract: module.Contract,
        ledger: module.ledger,
        privateStateId: options.privateStateId ?? 'contract',
        witnesses,
        compiledContract: compiledContractWithWitnesses,
      };

      // Create proofProvider with zkConfigProvider for this contract
      const proofProvider = httpClientProofProvider(
        clientData.providers.networkConfig.proofServer,
        zkConfig,
      );

      // Create full providers with zkConfig and proofProvider for this contract
      const providers: ContractProviders = {
        ...clientData.providers,
        zkConfigProvider: zkConfig,
        proofProvider,
      };

      return {
        module: loadedModule,
        providers,
        logging: clientData.logging,
        address: undefined,
        instance: undefined,
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

function deployContractEffect(
  contractData: ContractData,
  options?: DeployOptions,
): Effect.Effect<ContractData, ContractError> {
  return Effect.gen(function* () {
    // State machine check
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
    // State machine check
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
    // State machine check
    if (contractData.instance === undefined) {
      return yield* Effect.fail(
        new ContractError({
          cause: new Error('Not deployed'),
          message: `Contract not deployed. Call deploy() or join() first.`,
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
        message: `Contract not deployed. Call deploy() or join() first.`,
      }),
    );
  }

  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const { providers } = contractData;
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

function contractStateAtEffect(
  contractData: ContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  if (contractData.address === undefined) {
    return Effect.fail(
      new ContractError({
        cause: new Error('Not deployed'),
        message: `Contract not deployed. Call deploy() or join() first.`,
      }),
    );
  }

  const address = contractData.address;
  return Effect.tryPromise({
    try: async () => {
      const { providers } = contractData;
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

function ledgerStateEffect(contractData: ContractData): Effect.Effect<unknown, ContractError> {
  return contractStateEffect(contractData).pipe(
    Effect.map((data) => contractData.module.ledger(data))
  );
}

function ledgerStateAtEffect(
  contractData: ContractData,
  blockHeight: number,
): Effect.Effect<unknown, ContractError> {
  return contractStateAtEffect(contractData, blockHeight).pipe(
    Effect.map((data) => contractData.module.ledger(data))
  );
}

// =============================================================================
// Handle Factories (Create handles with methods from data)
// =============================================================================

/**
 * Create a stateful Contract handle from internal data.
 * The contract maintains mutable state internally for simplicity.
 * @internal
 */
function createContractHandle(initialData: ContractData): Contract {
  // Mutable state - the contract data can change via deploy/join
  let data: ContractData = initialData;

  const handle: Contract = {
    // Computed state property
    get state(): ContractState {
      return data.address !== undefined ? 'deployed' : 'loaded';
    },

    // Data accessors
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
      data = newData; // Update internal state
    },
    join: async (address, options) => {
      const newData = await runEffectWithLogging(joinContractEffect(data, address, options), data.logging);
      data = newData; // Update internal state
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
          Effect.tap((newData) => Effect.sync(() => { data = newData; }))
        ),
      join: (address, options) =>
        joinContractEffect(data, address, options).pipe(
          Effect.tap((newData) => Effect.sync(() => { data = newData; }))
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

/**
 * Create a MiddayClient handle from internal data.
 * @internal
 */
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
  });
}

function createClientHandle(data: ClientData): MiddayClient {
  return {
    // Data accessors
    networkConfig: data.networkConfig,
    providers: data.providers,
    wallet: data.wallet,
    relayerWallet: data.relayerWallet,

    // Promise API - returns Contract directly (new API)
    loadContract: async <M extends ContractModule>(options: LoadContractOptions<M>) => {
      const contractData = await runEffectWithLogging(
        loadContractEffect(data, options),
        data.logging
      );
      return createContractHandle(contractData) as Contract<InferLedger<M>, InferCircuits<M>>;
    },
    waitForTx: (txHash) =>
      runEffectWithLogging(waitForTxEffect(data, txHash), data.logging),
    close: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    [Symbol.asyncDispose]: () =>
      runEffectWithLogging(closeClientEffect(data), data.logging),

    // Effect API
    effect: {
      loadContract: <M extends ContractModule>(options: LoadContractOptions<M>) =>
        loadContractEffect(data, options).pipe(
          Effect.map((contractData) => createContractHandle(contractData) as Contract<InferLedger<M>, InferCircuits<M>>)
        ),
      waitForTx: (txHash) => waitForTxEffect(data, txHash),
      close: () => closeClientEffect(data),
    },
  };
}

// =============================================================================
// Module - Public API
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
 * Guarantees cleanup even if the body throws — the wallet and all WebSocket
 * connections are stopped before the promise settles.
 *
 * @example
 * ```typescript
 * await Midday.Client.withClient(config, async (client) => {
 *   const contract = await client.loadContract({ path: './contracts/counter' });
 *   await contract.deploy();
 *   await contract.call('increment');
 * });
 * // client.close() called automatically
 * ```
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
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.effect.create(config);
 *   const contract = yield* client.effect.loadContract({ module });
 *   yield* contract.effect.deploy();
 *   yield* contract.effect.call('increment');
 * });
 * ```
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  /**
   * Create a client (Effect version).
   */
  create: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError> =>
    createClientDataEffect(config).pipe(Effect.map(createClientHandle)),

  /**
   * Create a scoped client that is automatically closed when the scope exits.
   *
   * @example
   * ```typescript
   * const program = Effect.scoped(
   *   Effect.gen(function* () {
   *     const client = yield* Midday.Client.effect.createScoped(config);
   *     const contract = yield* client.effect.loadContract({ module });
   *     yield* contract.effect.deploy();
   *   })
   * );
   * // wallet stopped automatically when scope closes
   * ```
   *
   * @since 0.2.9
   */
  createScoped: (config: ClientConfig): Effect.Effect<MiddayClient, ClientError, Scope.Scope> =>
    Effect.acquireRelease(
      createClientDataEffect(config).pipe(Effect.map(createClientHandle)),
      (client) => client.effect.close().pipe(
        Effect.catchAll(() => Effect.void),
      ),
    ),

  /**
   * Run an Effect with a client that is automatically closed when done.
   *
   * @example
   * ```typescript
   * const result = yield* Midday.Client.effect.withClient(config, (client) =>
   *   Effect.gen(function* () {
   *     const contract = yield* client.effect.loadContract({ module });
   *     yield* contract.effect.deploy();
   *   })
   * );
   * ```
   *
   * @since 0.2.9
   */
  withClient: <A, E>(config: ClientConfig, body: (client: MiddayClient) => Effect.Effect<A, E>): Effect.Effect<A, E | ClientError> =>
    Effect.scoped(
      Effect.acquireRelease(
        createClientDataEffect(config).pipe(Effect.map(createClientHandle)),
        (client) => client.effect.close().pipe(
          Effect.catchAll(() => Effect.void),
        ),
      ).pipe(Effect.flatMap(body)),
    ),

  /**
   * Create a client from wallet (Effect version).
   */
  fromWallet: (
    connection: WalletConnection,
    config: {
      privateStateProvider: PrivateStateProvider;
      logging?: boolean;
      feeRelay?: { seed: string } | { url: string };
    },
  ): Effect.Effect<MiddayClient, ClientError> =>
    fromWalletDataEffect(connection, config).pipe(Effect.map(createClientHandle)),
};

// =============================================================================
// Contract Loading (Static Functions - Can Be Used Before Client Exists)
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
 * Options for loading a contract.
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
 * // Preferred: let loadContract handle it
 * const contract = await client.loadContract({ path: contractPath });
 *
 * // Alternative: load separately (useful for pre-loading)
 * const { module, zkConfig } = await Midday.Client.loadContractModule(contractPath);
 * const contract = await client.loadContract({ module, zkConfig });
 * ```
 *
 * @since 0.4.0
 * @category loading
 */
export async function loadContractModule<T = ContractModule>(
  contractPath: string,
  options: ContractLoadOptions = {}
): Promise<ContractLoadResult<T>> {
  const { moduleSubdir = 'contract', moduleEntry = 'index.js' } = options;

  // Dynamic imports to avoid bundlers following the chain into Node.js packages
  const { join } = await import(/* @vite-ignore */ 'path');
  const { NodeZkConfigProvider } = await import(/* @vite-ignore */ '@midnight-ntwrk/midnight-js-node-zk-config-provider');

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
  zkConfigBaseUrl: string
): Promise<ContractLoadResult<T>> {
  const { HttpZkConfigProvider } = await import('./providers/HttpZkConfigProvider.js');

  const module = (await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleUrl)) as T;
  const zkConfig = new HttpZkConfigProvider(zkConfigBaseUrl) as ZKConfigProvider<string>;

  return { module, zkConfig };
}

// =============================================================================
// Effect DI - Service Definitions (For Advanced DI Patterns)
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

// =============================================================================
// Pre-configured Client Layer
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
 *
 * @example
 * ```typescript
 * const clientLayer = Midday.Client.layer({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider,
 *   privateStateProvider,
 * });
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.MiddayClientService;
 *   const builder = yield* client.effect.loadContract({ module });
 *   return builder;
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(clientLayer)));
 * ```
 *
 * @since 0.3.0
 * @category layer
 */
export function layer(config: ClientConfig): Layer.Layer<MiddayClientService, ClientError> {
  return Layer.effect(MiddayClientService, effect.create(config));
}

/**
 * Create a Layer that provides a pre-initialized MiddayClient from a wallet connection.
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
