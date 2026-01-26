/**
 * Midday SDK - Developer-friendly SDK for building dapps on Midnight Network.
 *
 * @example
 * ```typescript
 * // Browser with Lace wallet
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
 * // Node.js or browser with seed
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const client = await Midday.Client.create({
 *   seed: 'your-64-char-hex-seed',
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
 *   privateStateProvider: Midday.inMemoryPrivateStateProvider(),
 * });
 * ```
 *
 * @since 0.1.0
 * @module
 */

// Core modules
export * as Client from './Client.js';
export * as Config from './Config.js';
export * as Wallet from './Wallet.js';
export * as Providers from './Providers.js';

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
} from './wallet/connector.js';
export { createWalletProviders, type WalletKeys, type WalletProviders } from './wallet/provider.js';

// Providers
export { HttpZkConfigProvider, type ZkConfig } from './providers/HttpZkConfigProvider.js';

// Re-export FetchZkConfigProvider for browser use
export { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
export {
  indexedDBPrivateStateProvider,
  inMemoryPrivateStateProvider,
  type IndexedDBPrivateStateConfig,
} from './providers/IndexedDBPrivateStateProvider.js';

// Re-export ledger utilities for balance checking
export { nativeToken } from '@midnight-ntwrk/ledger-v6';

// Re-export commonly used types for convenience
export type {
  ClientConfig,
  MidnightClient,
  ContractBuilder,
  ConnectedContract,
  CallResult,
  FinalizedTxData,
  ContractModule,
  ContractFromOptions,
  Logger,
} from './Client.js';
export type { NetworkConfig } from './Config.js';
export type { WalletContext } from './Wallet.js';
export type { ContractProviders, StorageConfig, CreateProvidersOptions } from './Providers.js';
