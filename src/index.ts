/**
 * Midday SDK - Developer-friendly SDK for building dapps on Midnight Network.
 *
 * Provides dual API: Effect-based and Promise-based for flexibility.
 *
 * @example
 * ```typescript
 * // Browser with Lace wallet (Promise-based)
 * import {
 *   Client,
 *   Contract,
 *   ContractBuilder,
 *   Providers,
 *   Wallet,
 * } from '@no-witness-labs/midday-sdk';
 *
 * const connection = await Wallet.connectWallet('testnet');
 * const client = await Client.fromWallet(connection, {
 *   zkConfigProvider: new Providers.HttpZkConfigProvider('https://cdn.example.com/zk'),
 *   privateStateProvider: Providers.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 *
 * const builder = await Client.contractFrom(client, {
 *   module: await import('./contracts/counter/index.js'),
 * });
 * const contract = await ContractBuilder.deploy(builder);
 * await Contract.call(contract, 'increment');
 * ```
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * import {
 *   Client,
 *   Contract,
 *   ContractBuilder,
 *   Config,
 *   Providers,
 *   runEffectPromise,
 * } from '@no-witness-labs/midday-sdk';
 * import { Effect } from 'effect';
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Client.effect.create({
 *     seed: 'your-64-char-hex-seed',
 *     networkConfig: Config.NETWORKS.local,
 *     zkConfigProvider: new Providers.HttpZkConfigProvider('http://localhost:3000/zk'),
 *     privateStateProvider: Providers.inMemoryPrivateStateProvider(),
 *   });
 *
 *   const builder = yield* Client.effect.contractFrom(client, {
 *     module: await import('./contracts/counter/index.js'),
 *   });
 *
 *   const contract = yield* ContractBuilder.effect.deploy(builder);
 *   const result = yield* Contract.effect.call(contract, 'increment');
 *
 *   return result;
 * });
 *
 * const result = await runEffectPromise(program);
 * ```
 *
 * @since 0.1.0
 * @module
 */

// Re-export Effect for consumer convenience
export { Effect, pipe, Context, Layer } from 'effect';

// Services for dependency injection (from Config module)
export {
  NetworkConfigService,
  SdkConfigService,
  makeSdkLayer,
  type SdkConfig,
} from './Config.js';

// Core modules
export * as Client from './Client.js';
export { Contract, ContractBuilder } from './Client.js';
export * as Config from './Config.js';
export * as Wallet from './Wallet.js';
export * as Providers from './Providers.js';

// Effect utilities
export { runEffect, runEffectPromise, runEffectWithLogging } from './utils/effect-runtime.js';

// Logging (Effect Logger layers)
export * as SdkLogger from './Logger.js';
export {
  pretty as prettyLogger,
  json as jsonLogger,
  logFmt as logFmtLogger,
  none as noopLogger,
  Default as DefaultLogger,
  withDebug,
  withInfo,
  withWarning,
  withError,
  fromEnabled as loggerFromEnabled,
} from './Logger.js';

// Error types (colocated with their modules)
export { ClientError, ContractError } from './Client.js';
export { WalletError } from './wallet/errors.js';
export { ProviderError, ZkConfigError, PrivateStateError } from './providers/errors.js';

// Type helpers
export type {
  EffectToPromise,
  EffectToPromiseAPI,
  SelectivePromiseAPI,
  SelectiveSyncAPI,
} from './sdk/Type.js';

// Utilities
export { hexToBytes, bytesToHex, base64ToBytes, bytesToBase64 } from './utils/hex.js';
export { parseShieldedAddress, hexToPublicKey, type ParsedAddress } from './utils/address.js';
export { createCoin, createCustomCoin, getNativeTokenColor, type CoinInfo } from './utils/coin.js';

// Wallet connector (browser)
export {
  connectWallet,
  disconnectWallet,
  isWalletAvailable,
  getWalletProvingProvider,
  effect as WalletConnectorEffect,
  WalletConnectorService,
  WalletConnectorLive,
  type WalletConnection,
  type ShieldedAddresses,
  type InitialAPI,
  type ConnectedAPI,
  type Configuration,
  type ProvingProvider,
  type KeyMaterialProvider,
  type WalletConnectorServiceImpl,
} from './wallet/connector.js';
export {
  createWalletProviders,
  effect as WalletProviderEffect,
  WalletProviderService,
  WalletProviderLive,
  type WalletKeys,
  type WalletProviders,
  type WalletProviderServiceImpl,
} from './wallet/provider.js';

// Providers
export {
  HttpZkConfigProvider,
  make as makeHttpZkConfigProvider,
  getZKIR,
  getProverKey,
  getVerifierKey,
  clearCache as clearZkConfigCache,
  effect as HttpZkConfigProviderEffect,
  ZkConfigService,
  ZkConfigLive,
  ZkConfigProviderService,
  type ZkConfig,
  type HttpZkConfigProviderData,
  type ZkConfigServiceImpl,
} from './providers/HttpZkConfigProvider.js';

// Re-export FetchZkConfigProvider for browser use
export { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
export {
  indexedDBPrivateStateProvider,
  inMemoryPrivateStateProvider,
  makeIndexedDB as makeIndexedDBPrivateState,
  makeInMemory as makeInMemoryPrivateState,
  get as getPrivateState,
  set as setPrivateState,
  remove as removePrivateState,
  clear as clearPrivateState,
  effect as PrivateStateEffect,
  PrivateStateService,
  PrivateStateLive,
  PrivateStateProviderService,
  type IndexedDBPrivateStateConfig,
  type PrivateStateProviderData,
  type PrivateStateServiceImpl,
} from './providers/IndexedDBPrivateStateProvider.js';

// Re-export ledger utilities for balance checking
export { nativeToken } from '@midnight-ntwrk/ledger-v6';

// Re-export commonly used types for convenience
export type {
  ClientConfig,
  MidnightClient,
  CallResult,
  FinalizedTxData,
  ContractModule,
  ContractFromOptions,
  DeployOptions,
  JoinOptions,
  LoadedContractModule,
  ClientServiceImpl,
  ContractBuilderServiceImpl,
  ContractServiceImpl,
} from './Client.js';
export {
  ClientService,
  ClientLive,
  ContractBuilderService,
  ContractBuilderLive,
  ContractService,
  ContractLive,
  MidnightClientService,
} from './Client.js';
export type { NetworkConfig } from './Config.js';
export type { WalletContext, WalletServiceImpl } from './Wallet.js';
export { WalletService, WalletLive } from './Wallet.js';
export type {
  ContractProviders,
  StorageConfig,
  CreateProvidersOptions,
  ContractProvidersEffect,
  ProvidersServiceImpl,
} from './Providers.js';
export { ProvidersService, ProvidersLive } from './Providers.js';
