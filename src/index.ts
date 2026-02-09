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
 * const loaded = await client.loadContract({
 *   module: CounterContract,
 *   zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
 *   privateStateId: 'my-counter',
 * });
 * const deployed = await loaded.deploy();
 * await deployed.actions.increment();
 * const state = await deployed.ledgerState();
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
 *   const loaded = yield* client.effect.loadContract({
 *     module: CounterContract,
 *     zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
 *     privateStateId: 'my-counter',
 *   });
 *   const deployed = yield* loaded.effect.deploy();
 *   yield* deployed.effect.actions.increment();
 *   const state = yield* deployed.effect.ledgerState();
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
