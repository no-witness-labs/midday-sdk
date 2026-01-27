/**
 * Midday SDK - Developer-friendly SDK for building dapps on Midnight Network.
 *
 * Provides dual API: Effect-based and Promise-based for flexibility.
 *
 * @example
 * ```typescript
 * // Browser with Lace wallet (Promise-based)
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const connection = await Midday.connectWallet('testnet');
 * const client = await Midday.Client.fromWallet(connection, {
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 *
 * const contract = await client.contractFrom({
 *   module: await import('./contracts/counter/index.js'),
 * });
 * await contract.deploy();
 * await contract.call('increment');
 * ```
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * import * as Midday from '@no-witness-labs/midday-sdk';
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
 * const result = await Midday.runEffectPromise(program);
 * ```
 *
 * @since 0.1.0
 * @module
 */

// Re-export Effect for consumer convenience
export { Effect, pipe, Context, Layer } from 'effect';

// Services for dependency injection
export {
  LoggerService,
  NetworkConfigService,
  ZkConfigProviderService,
  PrivateStateProviderService,
  SdkConfigService,
  makeSdkLayer,
  type SdkConfig,
} from './services/index.js';

// Core modules
export * as Client from './Client.js';
export * as Config from './Config.js';
export * as Wallet from './Wallet.js';
export * as Providers from './Providers.js';

// Effect utilities
export { runEffect, runEffectPromise } from './utils/effect-runtime.js';

// Error types
export {
  ClientError,
  WalletError,
  ProviderError,
  ContractError,
  ZkConfigError,
  PrivateStateError,
} from './errors/index.js';

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
  type WalletConnection,
  type ShieldedAddresses,
  type InitialAPI,
  type ConnectedAPI,
  type Configuration,
  type ProvingProvider,
  type KeyMaterialProvider,
  type WalletConnectorEffect,
} from './wallet/connector.js';
export {
  createWalletProviders,
  type WalletKeys,
  type WalletProviders,
  type WalletProviderEffect,
} from './wallet/provider.js';

// Providers
export {
  HttpZkConfigProvider,
  type ZkConfig,
  type ZkConfigProviderEffect,
} from './providers/HttpZkConfigProvider.js';

// Re-export FetchZkConfigProvider for browser use
export { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
export {
  indexedDBPrivateStateProvider,
  inMemoryPrivateStateProvider,
  type IndexedDBPrivateStateConfig,
  type PrivateStateProviderEffect,
  type IndexedDBPrivateStateProviderWithEffect,
  type InMemoryPrivateStateProviderWithEffect,
} from './providers/IndexedDBPrivateStateProvider.js';

// Re-export ledger utilities for balance checking
export { nativeToken } from '@midnight-ntwrk/ledger-v6';

// Re-export commonly used types for convenience
export type {
  ClientConfig,
  MidnightClient,
  MidnightClientEffect,
  ContractBuilder,
  ContractBuilderEffect,
  ConnectedContract,
  ConnectedContractEffect,
  CallResult,
  FinalizedTxData,
  ContractModule,
  ContractFromOptions,
  Logger,
  ClientEffect,
} from './Client.js';
export type { NetworkConfig } from './Config.js';
export type { WalletContext, WalletEffect } from './Wallet.js';
export type {
  ContractProviders,
  StorageConfig,
  CreateProvidersOptions,
  ContractProvidersEffect,
} from './Providers.js';
