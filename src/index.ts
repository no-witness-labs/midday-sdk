/**
 * Midday SDK - Developer-friendly SDK for building dapps on Midnight Network.
 *
 * Provides dual API: Effect-based and Promise-based for flexibility.
 *
 * ## Client-Centric Hub Pattern
 *
 * The SDK follows a Client-centric hub pattern where all operations flow from the client:
 * - Effect is source of truth (all logic in Effect functions)
 * - Client is the hub (everything flows from the client)
 * - Two interfaces: `.effect.method()` for Effect users, `.method()` for Promise users
 *
 * @example
 * ```typescript
 * // Promise user - simple flow
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const client = await Midday.Client.create({
 *   networkConfig: Midday.Config.NETWORKS.local,
 *   privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
 * });
 *
 * const contract = await client.loadContract({ path: './contracts/counter' });
 * await contract.deploy();
 * await contract.call('increment');
 * const state = await contract.ledgerState();
 * ```
 *
 * @example
 * ```typescript
 * // Effect user - compositional
 * import * as Midday from '@no-witness-labs/midday-sdk';
 * import { Effect } from 'effect';
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* Midday.Client.effect.create({
 *     seed: 'your-64-char-hex-seed',
 *     networkConfig: Midday.Config.NETWORKS.local,
 *     privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
 *   });
 *
 *   const contract = yield* client.effect.loadContract({ path: './contracts/counter' });
 *   yield* contract.effect.deploy();
 *   yield* contract.effect.call('increment');
 *   const state = yield* contract.effect.ledgerState();
 *
 *   return state;
 * });
 *
 * const result = await Midday.Runtime.runEffectPromise(program);
 * ```
 *
 * @since 0.1.0
 * @module
 */

// =============================================================================
// Module Namespaces (9 flat modules)
// =============================================================================

export * as Client from './Client.js';
export * as Contract from './Contract.js';
export * as Config from './Config.js';
export * as Wallet from './Wallet.js';
export * as PrivateState from './PrivateState.js';
export * as ZkConfig from './ZkConfig.js';
export * as Hash from './Hash.js';
export * as Runtime from './Runtime.js';
export * as Utils from './Utils.js';
