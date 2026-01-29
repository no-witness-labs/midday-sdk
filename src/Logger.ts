/**
 * Effect-based logging for the Midday SDK.
 *
 * Uses Effect's built-in Logger service for structured logging with:
 * - Multiple log levels (trace, debug, info, warning, error, fatal)
 * - Swappable implementations (pretty, JSON, custom)
 * - Layer-based configuration
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect';
 * import { SdkLogger } from 'midday-sdk';
 *
 * // Use default pretty logger
 * const program = Effect.gen(function* () {
 *   yield* Effect.logInfo('Starting operation');
 *   yield* Effect.logDebug('Debug details');
 * });
 *
 * Effect.runFork(program.pipe(Effect.provide(SdkLogger.pretty)));
 *
 * // Use JSON logger for production
 * Effect.runFork(program.pipe(Effect.provide(SdkLogger.json)));
 *
 * // Disable logging
 * Effect.runFork(program.pipe(Effect.provide(SdkLogger.none)));
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Layer, Logger, LogLevel } from 'effect';

// =============================================================================
// Logger Layers
// =============================================================================

/**
 * Pretty console logger with colors and formatting.
 * Best for development.
 *
 * @since 0.3.0
 * @category layers
 */
export const pretty = Logger.pretty;

/**
 * JSON structured logger.
 * Best for production and log aggregation systems.
 *
 * @since 0.3.0
 * @category layers
 */
export const json = Logger.json;

/**
 * Logfmt logger (key=value format).
 * Compatible with many log analysis tools.
 *
 * @since 0.3.0
 * @category layers
 */
export const logFmt = Logger.logFmt;

/**
 * No-op logger that discards all messages.
 * Use when logging should be completely disabled.
 *
 * @since 0.3.0
 * @category layers
 */
export const none = Logger.replace(Logger.defaultLogger, Logger.none);

/**
 * Default SDK logger (pretty in development).
 *
 * @since 0.3.0
 * @category layers
 */
export const Default = pretty;

// =============================================================================
// Log Level Layers
// =============================================================================

/**
 * Set minimum log level to Debug (shows all messages).
 *
 * @since 0.3.0
 * @category layers
 */
export const withDebug = Logger.minimumLogLevel(LogLevel.Debug);

/**
 * Set minimum log level to Info (default).
 *
 * @since 0.3.0
 * @category layers
 */
export const withInfo = Logger.minimumLogLevel(LogLevel.Info);

/**
 * Set minimum log level to Warning.
 *
 * @since 0.3.0
 * @category layers
 */
export const withWarning = Logger.minimumLogLevel(LogLevel.Warning);

/**
 * Set minimum log level to Error.
 *
 * @since 0.3.0
 * @category layers
 */
export const withError = Logger.minimumLogLevel(LogLevel.Error);

// =============================================================================
// Factory Functions
// =============================================================================

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
 * @category constructors
 */
export function fromEnabled(enabled: boolean): Layer.Layer<never> {
  return enabled
    ? Layer.merge(pretty, Logger.minimumLogLevel(LogLevel.Debug))
    : pretty;
}

// =============================================================================
// Namespace Export
// =============================================================================

/**
 * SDK Logger utilities.
 *
 * @since 0.3.0
 * @category namespace
 */
export const SdkLogger = {
  /** Pretty console logger */
  pretty,
  /** JSON structured logger */
  json,
  /** Logfmt logger */
  logFmt,
  /** No-op logger */
  none,
  /** Default SDK logger */
  Default,
  /** Debug log level */
  withDebug,
  /** Info log level */
  withInfo,
  /** Warning log level */
  withWarning,
  /** Error log level */
  withError,
  /** Create logger from enabled flag */
  fromEnabled,
};
