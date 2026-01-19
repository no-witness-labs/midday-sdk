/**
 * Midday SDK - Developer-friendly SDK for building dapps on Midnight Network.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const client = await Midday.Client.create();
 * const contract = await (await client.contractFrom('build/my-contract')).deploy();
 * await contract.call('myAction', arg1, arg2);
 * const state = await contract.ledgerState();
 * ```
 *
 * @since 0.1.0
 * @module
 */

export * as Client from './Client.js';
export * as Config from './Config.js';
export * as Wallet from './Wallet.js';
export * as Providers from './Providers.js';

// Re-export commonly used types for convenience
export type { ClientConfig, MidnightClient, ContractBuilder, ConnectedContract, CallResult, FinalizedTxData } from './Client.js';
export type { NetworkConfig } from './Config.js';
export type { WalletContext } from './Wallet.js';
export type { ContractProviders, StorageConfig } from './Providers.js';
