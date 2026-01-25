/**
 * Wallet connector for Lace wallet integration in browser.
 *
 * Connects to the Lace browser extension via DAppConnectorAPI.
 *
 * @since 0.2.0
 * @module
 */

/**
 * Wallet state exposed by the DApp Connector.
 */
export interface DAppConnectorWalletState {
  /** Bech32m encoded address */
  address: string;
  /** Bech32m encoded coin public key */
  coinPublicKey: string;
  /** Bech32m encoded encryption public key */
  encryptionPublicKey: string;
  /** @deprecated Legacy hex address */
  addressLegacy?: string;
  /** @deprecated Legacy hex coin public key */
  coinPublicKeyLegacy?: string;
  /** @deprecated Legacy hex encryption public key */
  encryptionPublicKeyLegacy?: string;
}

/**
 * Service URIs provided by the wallet.
 */
export interface ServiceUriConfig {
  /** Indexer URI */
  indexerUri: string;
  /** Indexer WebSocket URI */
  indexerWsUri: string;
  /** Prover Server URI */
  proverServerUri: string;
  /** Substrate Node URI */
  substrateNodeUri: string;
}

/**
 * Wallet API exposed by the DApp Connector.
 */
export interface DAppConnectorWalletAPI {
  /** Get wallet state */
  state: () => Promise<DAppConnectorWalletState>;
  /** Balance and prove a transaction */
  balanceAndProveTransaction: (tx: unknown, newCoins: unknown[]) => Promise<unknown>;
  /** Submit a transaction */
  submitTransaction: (tx: unknown) => Promise<string>;
  /** @deprecated Use balanceAndProveTransaction instead */
  balanceTransaction?: (tx: unknown, newCoins: unknown[], ttl: Date) => Promise<unknown>;
  /** @deprecated Use balanceAndProveTransaction instead */
  proveTransaction?: (tx: unknown) => Promise<unknown>;
}

/**
 * DApp Connector API Definition.
 */
export interface DAppConnectorAPI {
  /** Wallet name */
  name: string;
  /** API version (semver) */
  apiVersion: string;
  /** Check if wallet has authorized the dapp */
  isEnabled: () => Promise<boolean>;
  /** Get service URIs */
  serviceUriConfig: () => Promise<ServiceUriConfig>;
  /** Request wallet access */
  enable: () => Promise<DAppConnectorWalletAPI>;
}

declare global {
  interface Window {
    midnight?: {
      mnLace?: DAppConnectorAPI;
      [key: string]: DAppConnectorAPI | undefined;
    };
  }
}

/**
 * Result of connecting to a wallet.
 */
export interface WalletConnection {
  /** Connected wallet API */
  wallet: DAppConnectorWalletAPI;
  /** Network service URIs */
  uris: ServiceUriConfig;
  /** Coin public key as bech32m string */
  coinPublicKey: string;
  /** Encryption public key as bech32m string */
  encryptionPublicKey: string;
}

/**
 * Check if running in browser with Lace wallet available.
 *
 * @returns true if Lace wallet extension is detected
 *
 * @example
 * ```typescript
 * if (isWalletAvailable()) {
 *   const connection = await connectWallet();
 * } else {
 *   console.log('Please install Lace wallet');
 * }
 * ```
 */
export function isWalletAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.midnight?.mnLace;
}

/**
 * Wait for the wallet extension to be injected.
 *
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns The DAppConnectorAPI once available
 * @throws Error if wallet not found within timeout
 */
async function waitForWallet(timeout: number = 5000): Promise<DAppConnectorAPI> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (window.midnight?.mnLace) {
      return window.midnight.mnLace;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Lace wallet not found. Please install the Lace browser extension.');
}

/**
 * Connect to the Lace wallet in browser.
 *
 * Opens a connection dialog in the user's Lace wallet extension.
 * User must approve the connection.
 *
 * @param networkId - Network to connect to (default: 'testnet')
 * @returns WalletConnection with wallet API and keys
 * @throws Error if not in browser or wallet unavailable
 *
 * @example
 * ```typescript
 * // Connect to Lace wallet
 * const connection = await connectWallet('testnet');
 *
 * // Use connection to create client
 * const client = await Midday.Client.fromWallet(connection);
 *
 * console.log('Coin key:', connection.coinPublicKey);
 * console.log('Encryption key:', connection.encryptionPublicKey);
 * ```
 */
export async function connectWallet(_networkId: string = 'testnet'): Promise<WalletConnection> {
  if (typeof window === 'undefined') {
    throw new Error('connectWallet() can only be used in browser environment');
  }

  const connector = await waitForWallet();

  // Check API version compatibility
  const [major] = connector.apiVersion.split('.').map(Number);
  if (major < 2) {
    throw new Error(`Unsupported wallet API version: ${connector.apiVersion}. Please update Lace.`);
  }

  // Enable wallet access
  const wallet = await connector.enable();

  // Get service URIs for the network
  const uris = await connector.serviceUriConfig();

  // Get wallet state to extract keys
  const state = await wallet.state();

  return {
    wallet,
    uris,
    coinPublicKey: state.coinPublicKey,
    encryptionPublicKey: state.encryptionPublicKey,
  };
}

/**
 * Disconnect from the wallet (if supported).
 *
 * Note: Some wallet implementations may not support explicit disconnect.
 */
export async function disconnectWallet(): Promise<void> {
  // Currently Lace doesn't expose a disconnect API
  // The connection persists until the page is closed
  // This function is provided for future compatibility
}
