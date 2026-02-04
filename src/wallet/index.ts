/**
 * Browser wallet connection and providers.
 *
 * This module combines:
 * - Wallet connector (Lace browser extension)
 * - Wallet providers (WalletProvider, MidnightProvider)
 * - Wallet errors
 *
 * @since 0.3.0
 * @module
 */

// Errors
export { WalletError } from './errors.js';

// Connector
export {
  connectWallet,
  disconnectWallet,
  isWalletAvailable,
  getWalletProvingProvider,
  effect,
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
  type WalletConnectorEffect,
} from './connector.js';

// Provider
export {
  createWalletProviders,
  effect as providerEffect,
  WalletProviderService,
  WalletProviderLive,
  type WalletKeys,
  type WalletProviders,
  type WalletProviderServiceImpl,
  type WalletProviderEffect,
} from './provider.js';
