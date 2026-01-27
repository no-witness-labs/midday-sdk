/**
 * Type helpers for Effect-to-Promise API conversion.
 *
 * @since 0.3.0
 * @module
 */

import type * as Effect from 'effect/Effect';

/**
 * Utility to force TypeScript to expand and display computed types.
 * Improves IDE hover display for complex mapped types.
 */
type Expand<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R
  : T extends object
    ? { [K in keyof T]: T[K] }
    : T;

/**
 * Converts an Effect type to a Promise type by extracting the success value.
 * Handles both direct Effect types and functions returning Effects.
 *
 * @example
 * ```typescript
 * type EffectType = Effect.Effect<string, Error>;
 * type PromiseType = EffectToPromise<EffectType>; // Promise<string>
 *
 * type EffectFn = (x: number) => Effect.Effect<string, Error>;
 * type PromiseFn = EffectToPromise<EffectFn>; // (x: number) => Promise<string>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type EffectToPromise<T> = T extends Effect.Effect<infer Return, infer _Error, infer _Context>
  ? Promise<Return>
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    T extends (...args: Array<any>) => Effect.Effect<infer Return, infer _Error, infer _Context>
    ? (...args: Parameters<T>) => Promise<Return>
    : never;

/**
 * Converts an API interface with Effect-returning methods to Promise-returning methods.
 *
 * Used to create the Promise-based wrapper API from the Effect-based API.
 *
 * @example
 * ```typescript
 * interface MyAPIEffect {
 *   readonly foo: () => Effect.Effect<string, Error>;
 *   readonly bar: (n: number) => Effect.Effect<boolean, Error>;
 * }
 *
 * // Results in:
 * // {
 * //   readonly foo: () => Promise<string>;
 * //   readonly bar: (n: number) => Promise<boolean>;
 * // }
 * type MyAPI = EffectToPromiseAPI<MyAPIEffect>;
 * ```
 */
export type EffectToPromiseAPI<T> = Expand<{
  readonly [K in keyof T]: EffectToPromise<T[K]>;
}>;

/**
 * Selective Promise conversion - specify which Effects become Promises, rest become sync.
 *
 * @example
 * ```typescript
 * interface MyAPIEffect {
 *   readonly asyncOp: () => Effect.Effect<string, Error>;
 *   readonly syncOp: () => Effect.Effect<number, Error>;
 * }
 *
 * // asyncOp becomes Promise, syncOp becomes sync (returns number directly)
 * type MyAPI = SelectivePromiseAPI<MyAPIEffect, 'asyncOp'>;
 * ```
 */
export type SelectivePromiseAPI<T, PromiseKeys extends keyof T = never> = {
  // Promise-converted methods (explicitly specified)
  readonly [K in PromiseKeys]: EffectToPromise<T[K]>;
} & {
  // Direct sync access for all other keys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [K in Exclude<keyof T, PromiseKeys>]: T[K] extends Effect.Effect<infer Return, any, any> ? Return : T[K];
};

/**
 * Selective Sync conversion - specify which Effects become sync, rest become Promises.
 *
 * @example
 * ```typescript
 * interface MyAPIEffect {
 *   readonly asyncOp: () => Effect.Effect<string, Error>;
 *   readonly syncOp: () => Effect.Effect<number, Error>;
 * }
 *
 * // syncOp becomes sync (returns number), asyncOp becomes Promise
 * type MyAPI = SelectiveSyncAPI<MyAPIEffect, 'syncOp'>;
 * ```
 */
export type SelectiveSyncAPI<T, SyncKeys extends keyof T = never> = {
  // Direct sync access (explicitly specified)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [K in SyncKeys]: T[K] extends Effect.Effect<infer Return, any, any> ? Return : T[K];
} & {
  // Promise-converted methods for all other keys
  readonly [K in Exclude<keyof T, SyncKeys>]: EffectToPromise<T[K]>;
};
