/**
 * Wallet connector for Lace wallet integration in browser.
 *
 * Connects to the Lace browser extension via DAppConnectorAPI v4.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.2.0
 * @module
 */

import { Effect } from 'effect';
import { WalletError } from '../errors/index.js';
import { runEffect, runEffectPromise } from '../utils/effect-runtime.js';

// Types based on @midnight-ntwrk/dapp-connector-api v4
// Defined locally to avoid import issues with type-only exports

/**
 * Key material provider for proving.
 */
export interface KeyMaterialProvider {
  getZKIR(circuitKeyLocation: string): Promise<Uint8Array>;
  getProverKey(circuitKeyLocation: string): Promise<Uint8Array>;
  getVerifierKey(circuitKeyLocation: string): Promise<Uint8Array>;
}

/**
 * Proving provider from wallet.
 */
export interface ProvingProvider {
  check(serializedPreimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(serializedPreimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>;
}

/**
 * Network configuration from wallet.
 */
export interface Configuration {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  substrateNodeUri: string;
  networkId: string;
}

/**
 * Initial API for wallet connection.
 */
export interface InitialAPI {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  connect: (networkId: string) => Promise<ConnectedAPI>;
}

/**
 * Connected wallet API.
 */
export interface ConnectedAPI {
  getShieldedBalances(): Promise<Record<string, bigint>>;
  getUnshieldedBalances(): Promise<Record<string, bigint>>;
  getDustBalance(): Promise<{ cap: bigint; balance: bigint }>;
  getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getDustAddress(): Promise<{ dustAddress: string }>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  balanceSealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<string>;
  getProvingProvider(keyMaterialProvider: KeyMaterialProvider): Promise<ProvingProvider>;
  getConfiguration(): Promise<Configuration>;
  hintUsage(methodNames: string[]): Promise<void>;
}

declare global {
  interface Window {
    midnight?: {
      mnLace?: InitialAPI;
      [key: string]: InitialAPI | undefined;
    };
  }
}

/**
 * Shielded addresses returned by wallet.
 */
export interface ShieldedAddresses {
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

/**
 * Result of connecting to a wallet.
 */
export interface WalletConnection {
  wallet: ConnectedAPI;
  config: Configuration;
  addresses: ShieldedAddresses;
  coinPublicKey: string;
  encryptionPublicKey: string;
}

/**
 * Effect-based interface for wallet connector.
 */
export interface WalletConnectorEffect {
  readonly connect: (networkId?: string) => Effect.Effect<WalletConnection, WalletError>;
  readonly isAvailable: () => Effect.Effect<boolean, never>;
  readonly disconnect: () => Effect.Effect<void, never>;
  readonly getProvingProvider: (wallet: ConnectedAPI, zkConfigProvider: KeyMaterialProvider) => Effect.Effect<ProvingProvider, WalletError>;
}

// =============================================================================
// Effect API
// =============================================================================

function isAvailableEffect(): Effect.Effect<boolean, never> {
  return Effect.sync(() => typeof window !== 'undefined' && !!window.midnight?.mnLace);
}

function waitForWalletEffect(timeout: number = 5000): Effect.Effect<InitialAPI, WalletError> {
  return Effect.tryPromise({
    try: async () => {
      const start = Date.now();

      while (Date.now() - start < timeout) {
        if (window.midnight?.mnLace) {
          return window.midnight.mnLace;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error('Lace wallet not found. Please install the Lace browser extension.');
    },
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Wallet not available: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function isVersionCompatible(version: string, required: string): boolean {
  const [major] = version.split('.').map(Number);
  const [requiredMajor] = required.split('.').map(Number);
  return major >= requiredMajor;
}

function connectEffect(networkId: string = 'testnet'): Effect.Effect<WalletConnection, WalletError> {
  return Effect.gen(function* () {
    if (typeof window === 'undefined') {
      return yield* Effect.fail(
        new WalletError({
          cause: new Error('Browser environment required'),
          message: 'connectWallet() can only be used in browser environment',
        }),
      );
    }

    const connector = yield* waitForWalletEffect();

    if (!isVersionCompatible(connector.apiVersion, '4.0')) {
      return yield* Effect.fail(
        new WalletError({
          cause: new Error('Incompatible API version'),
          message: `Incompatible wallet API version: ${connector.apiVersion}. Requires 4.x or higher. Please update Lace.`,
        }),
      );
    }

    const wallet = yield* Effect.tryPromise({
      try: () => connector.connect(networkId),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to connect to wallet: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    const config = yield* Effect.tryPromise({
      try: () => wallet.getConfiguration(),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to get wallet configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    const addresses = yield* Effect.tryPromise({
      try: () => wallet.getShieldedAddresses(),
      catch: (cause) =>
        new WalletError({
          cause,
          message: `Failed to get wallet addresses: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    return {
      wallet,
      config,
      addresses,
      coinPublicKey: addresses.shieldedCoinPublicKey,
      encryptionPublicKey: addresses.shieldedEncryptionPublicKey,
    };
  });
}

function disconnectEffect(): Effect.Effect<void, never> {
  // Currently Lace doesn't expose a disconnect API
  return Effect.void;
}

function getProvingProviderEffect(wallet: ConnectedAPI, zkConfigProvider: KeyMaterialProvider): Effect.Effect<ProvingProvider, WalletError> {
  return Effect.tryPromise({
    try: () => wallet.getProvingProvider(zkConfigProvider),
    catch: (cause) =>
      new WalletError({
        cause,
        message: `Failed to get proving provider: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

/**
 * Effect-based API for wallet connector.
 */
export const WalletConnectorEffectAPI: WalletConnectorEffect = {
  connect: connectEffect,
  isAvailable: isAvailableEffect,
  disconnect: disconnectEffect,
  getProvingProvider: getProvingProviderEffect,
};

// =============================================================================
// Promise API (backwards compatible)
// =============================================================================

/**
 * Check if running in browser with Lace wallet available.
 */
export function isWalletAvailable(): boolean {
  return runEffect(isAvailableEffect());
}

/**
 * Connect to the Lace wallet in browser.
 *
 * @param networkId - Network to connect to (default: 'testnet')
 * @returns WalletConnection with wallet API and keys
 *
 * @example
 * ```typescript
 * // Effect-based usage
 * const connection = yield* Midday.WalletConnector.Effect.connect('testnet');
 *
 * // Promise-based usage
 * const connection = await Midday.connectWallet('testnet');
 * ```
 */
export async function connectWallet(networkId: string = 'testnet'): Promise<WalletConnection> {
  return runEffectPromise(connectEffect(networkId));
}

/**
 * Get a proving provider from the connected wallet.
 */
export async function getWalletProvingProvider(
  wallet: ConnectedAPI,
  zkConfigProvider: KeyMaterialProvider,
): Promise<ProvingProvider> {
  return runEffectPromise(getProvingProviderEffect(wallet, zkConfigProvider));
}

/**
 * Disconnect from the wallet (if supported).
 */
export async function disconnectWallet(): Promise<void> {
  return runEffectPromise(disconnectEffect());
}

/**
 * Effect-based API export.
 */
export { WalletConnectorEffectAPI as Effect };
