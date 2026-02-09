/**
 * Effect runtime utilities for executing Effect programs, plus logging configuration.
 *
 * Provides three runners that bridge Effect programs to standard TypeScript:
 * - `runEffect()` — sync runner for sync Effects
 * - `runEffectPromise()` — async runner for async Effects
 * - `runEffectWithLogging()` — async runner with Logger layer
 *
 * All runners clean Effect.ts internal stack frames from errors for better DX.
 *
 * The `Logger` sub-namespace provides pre-configured Effect Logger layers:
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Run an Effect synchronously
 * const result = Midday.Runtime.runEffect(Effect.succeed(42));
 *
 * // Run an async Effect
 * const data = await Midday.Runtime.runEffectPromise(someAsyncEffect);
 *
 * // Use Logger layers with Effect
 * const program = Effect.gen(function* () {
 *   yield* Effect.logInfo('Starting operation');
 *   yield* Effect.logDebug('Debug details');
 * });
 *
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.pretty)));
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.withDebug)));
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.json)));
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Cause, Effect, Exit, Layer, Logger as EffectLogger, LogLevel } from 'effect';

// =============================================================================
// Stack Trace Cleaning
// =============================================================================

/**
 * Patterns to filter from stack traces — Effect.ts internal implementation details.
 */
const EFFECT_INTERNAL_PATTERNS = [
  /node_modules\/.pnpm\/effect@.*\/node_modules\/effect\//,
  /at FiberRuntime\./,
  /at EffectPrimitive\./,
  /at Object\.Iterator/,
  /at runLoop/,
  /at evaluateEffect/,
  /at body \(/,
  /effect_instruction_i\d+/,
  /at pipeArguments/,
  /at pipe \(/,
  /at Arguments\./,
  /at Module\./,
  /at issue \(/,
  /at \.\.\.$/, // Lines like "... 7 lines matching cause stack trace ..."
];

/**
 * Clean a single error's stack trace by removing Effect.ts internals.
 */
function cleanStackTrace(stack: string | undefined): string {
  if (!stack) return '';

  const lines = stack.split('\n');
  const cleaned = lines.filter((line) => {
    // Keep the error message line (first line)
    if (!line.trim().startsWith('at ')) return true;

    // Filter out Effect.ts internal lines
    return !EFFECT_INTERNAL_PATTERNS.some((pattern) => pattern.test(line));
  });

  return cleaned.join('\n');
}

/**
 * Recursively clean error chain (error and all causes).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanErrorChain(error: any): any {
  if (!error) return error;

  // Clean current error's stack
  if (error.stack) {
    error.stack = cleanStackTrace(error.stack);
  }

  // Recursively clean cause chain
  if (error.cause) {
    error.cause = cleanErrorChain(error.cause);
  }

  // Handle Effect.ts internal cause field
  if (error[Symbol.for('effect/Runtime/FiberFailure/Cause')]) {
    const cause = error[Symbol.for('effect/Runtime/FiberFailure/Cause')];
    if (cause && typeof cause === 'object') {
      if (cause.error) {
        cause.error = cleanErrorChain(cause.error);
      }
    }
  }

  return error;
}

// =============================================================================
// Effect Runners
// =============================================================================

/**
 * Run an Effect synchronously with clean error handling.
 *
 * - Executes the Effect using `Effect.runSyncExit`
 * - On failure, extracts the error and cleans stack traces
 * - Removes Effect.ts internal stack frames for cleaner error messages
 * - Throws the cleaned error for standard error handling
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const myEffect = Effect.succeed(42);
 *
 * try {
 *   const result = Midday.Runtime.runEffect(myEffect);
 *   console.log(result);
 * } catch (error) {
 *   // Error with clean stack trace, no Effect.ts internals
 *   console.error(error);
 * }
 * ```
 *
 * @since 0.3.0
 * @category runners
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): A {
  const exit = Effect.runSyncExit(effect);

  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    const cleanedError = cleanErrorChain(error);
    throw cleanedError;
  }

  return exit.value;
}

/**
 * Run an Effect asynchronously and convert it to a Promise with clean error handling.
 *
 * - Executes the Effect using `Effect.runPromiseExit`
 * - On failure, extracts the error and cleans stack traces
 * - Removes Effect.ts internal stack frames for cleaner error messages
 * - Throws the cleaned error for standard Promise error handling
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const myEffect = Effect.tryPromise(() => fetch('/api'));
 *
 * async function example() {
 *   try {
 *     const result = await Midday.Runtime.runEffectPromise(myEffect);
 *     console.log(result);
 *   } catch (error) {
 *     console.error(error);
 *   }
 * }
 * ```
 *
 * @since 0.3.0
 * @category runners
 */
export async function runEffectPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    const cleanedError = cleanErrorChain(error);
    throw cleanedError;
  }

  return exit.value;
}

/**
 * Run an Effect asynchronously with optional logging configuration.
 *
 * - Applies `Logger.pretty` in both cases
 * - When logging is enabled, sets minimum log level to Debug (shows all logs)
 * - When logging is disabled, uses default log level (hides Debug messages)
 * - On failure, extracts the error and cleans stack traces
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const myEffect = Effect.gen(function* () {
 *   yield* Effect.logDebug('Starting...');
 *   return 42;
 * });
 *
 * // With logging enabled
 * await Midday.Runtime.runEffectWithLogging(myEffect, true);
 *
 * // With logging disabled (silent)
 * await Midday.Runtime.runEffectWithLogging(myEffect, false);
 * ```
 *
 * @since 0.3.0
 * @category runners
 */
export async function runEffectWithLogging<A, E>(
  effect: Effect.Effect<A, E>,
  logging: boolean,
): Promise<A> {
  const loggerLayer = Logger.fromEnabled(logging);
  const withLog = Effect.provide(effect, loggerLayer);
  return runEffectPromise(withLog);
}

// =============================================================================
// Logger Sub-namespace
// =============================================================================

/**
 * Pre-configured Effect Logger layers for the Midday SDK.
 *
 * Provides ready-to-use logging configurations that can be applied
 * to any Effect program via `Effect.provide()`.
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const program = Effect.gen(function* () {
 *   yield* Effect.logInfo('Hello');
 *   yield* Effect.logDebug('Debug info');
 * });
 *
 * // Pretty console output (development)
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.pretty)));
 *
 * // JSON output (production)
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.json)));
 *
 * // Show debug messages
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.withDebug)));
 *
 * // Disable all logging
 * Effect.runFork(program.pipe(Effect.provide(Midday.Runtime.Logger.none)));
 * ```
 *
 * @since 0.3.0
 * @category namespace
 */
export const Logger = {
  /**
   * Pretty console logger with colors and formatting.
   * Best for development.
   *
   * @since 0.3.0
   */
  pretty: EffectLogger.pretty,

  /**
   * JSON structured logger.
   * Best for production and log aggregation systems.
   *
   * @since 0.3.0
   */
  json: EffectLogger.json,

  /**
   * Logfmt logger (key=value format).
   * Compatible with many log analysis tools.
   *
   * @since 0.3.0
   */
  logFmt: EffectLogger.logFmt,

  /**
   * No-op logger that discards all messages.
   * Use when logging should be completely disabled.
   *
   * @since 0.3.0
   */
  none: EffectLogger.replace(EffectLogger.defaultLogger, EffectLogger.none),

  /**
   * Default SDK logger (pretty in development).
   *
   * @since 0.3.0
   */
  Default: EffectLogger.pretty,

  /**
   * Set minimum log level to Debug (shows all messages).
   *
   * @since 0.3.0
   */
  withDebug: EffectLogger.minimumLogLevel(LogLevel.Debug),

  /**
   * Set minimum log level to Info (default).
   *
   * @since 0.3.0
   */
  withInfo: EffectLogger.minimumLogLevel(LogLevel.Info),

  /**
   * Set minimum log level to Warning.
   *
   * @since 0.3.0
   */
  withWarning: EffectLogger.minimumLogLevel(LogLevel.Warning),

  /**
   * Set minimum log level to Error.
   *
   * @since 0.3.0
   */
  withError: EffectLogger.minimumLogLevel(LogLevel.Error),

  /**
   * Create a logger layer based on enabled flag.
   * Provides backwards compatibility with the `logging: boolean` option.
   *
   * When enabled: pretty logger + Debug level visible
   * When disabled: pretty logger only (Debug hidden by default)
   *
   * @param enabled - Whether debug logging is enabled
   * @returns Logger layer
   *
   * @since 0.3.0
   */
  fromEnabled(enabled: boolean): Layer.Layer<never> {
    return enabled
      ? Layer.merge(EffectLogger.pretty, EffectLogger.minimumLogLevel(LogLevel.Debug))
      : EffectLogger.pretty;
  },
};
