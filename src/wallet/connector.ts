/**
 * Wallet connector for Lace wallet integration in browser.
 *
 * Connects to the Lace browser extension via DAppConnectorAPI v4.
 *
 * @since 0.2.0
 * @module
 */

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
 * Check if running in browser with Lace wallet available.
 */
export function isWalletAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.midnight?.mnLace;
}

/**
 * Wait for the wallet extension to be injected.
 */
async function waitForWallet(timeout: number = 5000): Promise<InitialAPI> {
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
 * Check if API version is compatible.
 */
function isVersionCompatible(version: string, required: string): boolean {
  const [major] = version.split('.').map(Number);
  const [requiredMajor] = required.split('.').map(Number);
  return major >= requiredMajor;
}

/**
 * Connect to the Lace wallet in browser.
 *
 * @param networkId - Network to connect to (default: 'testnet')
 * @returns WalletConnection with wallet API and keys
 *
 * @example
 * ```typescript
 * const connection = await connectWallet('testnet');
 * const client = await Midday.Client.fromWallet(connection, {
 *   zkConfigProvider: new Midday.FetchZkConfigProvider(window.location.origin, fetch.bind(window)),
 *   privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
 * });
 * ```
 */
export async function connectWallet(networkId: string = 'testnet'): Promise<WalletConnection> {
  if (typeof window === 'undefined') {
    throw new Error('connectWallet() can only be used in browser environment');
  }

  const connector = await waitForWallet();

  if (!isVersionCompatible(connector.apiVersion, '4.0')) {
    throw new Error(
      `Incompatible wallet API version: ${connector.apiVersion}. Requires 4.x or higher. Please update Lace.`,
    );
  }

  const wallet = await connector.connect(networkId);
  const config = await wallet.getConfiguration();
  const addresses = await wallet.getShieldedAddresses();

  return {
    wallet,
    config,
    addresses,
    coinPublicKey: addresses.shieldedCoinPublicKey,
    encryptionPublicKey: addresses.shieldedEncryptionPublicKey,
  };
}

/**
 * Get a proving provider from the connected wallet.
 */
export async function getWalletProvingProvider(
  wallet: ConnectedAPI,
  zkConfigProvider: KeyMaterialProvider,
): Promise<ProvingProvider> {
  return wallet.getProvingProvider(zkConfigProvider);
}

/**
 * Disconnect from the wallet (if supported).
 */
export async function disconnectWallet(): Promise<void> {
  // Currently Lace doesn't expose a disconnect API
}
