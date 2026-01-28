/**
 * HTTP-based ZK configuration provider.
 *
 * ## API Design
 *
 * This module uses a **module-function pattern**:
 *
 * - **Stateless**: Functions operate on HttpZkConfigProvider data
 * - **Module functions**: `HttpZkConfigProvider.getZKIR(provider, circuitId)`
 * - **Data-oriented**: Provider is plain data, not an instance with methods
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user
 * const provider = HttpZkConfigProvider.make('https://cdn.example.com/zk');
 * const zkir = await HttpZkConfigProvider.getZKIR(provider, 'increment');
 *
 * // Effect user
 * const provider = HttpZkConfigProvider.make('https://cdn.example.com/zk');
 * const zkir = yield* HttpZkConfigProvider.effect.getZKIR(provider, 'increment');
 * ```
 *
 * @since 0.2.0
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import {
  ZKConfigProvider,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';

import { ZkConfigError } from './errors.js';
import { runEffectPromise } from '../utils/effect-runtime.js';

/**
 * ZK configuration loaded from HTTP endpoints.
 *
 * @since 0.2.0
 * @category model
 */
export interface ZkConfig {
  /** Zero-knowledge intermediate representation */
  zkir: ZKIR;
  /** Prover key bytes */
  proverKey: ProverKey;
  /** Verifier key bytes */
  verifierKey: VerifierKey;
}

/**
 * Represents an HTTP ZK config provider.
 *
 * This is plain data - use module functions to operate on it.
 *
 * @since 0.2.0
 * @category model
 */
export interface HttpZkConfigProviderData {
  /** Base URL for ZK artifacts */
  readonly baseUrl: string;
  /** Fetch function to use */
  readonly fetchFn: typeof fetch;
  /** Internal cache for loaded configs */
  readonly cache: Map<string, ZkConfig>;
}

// =============================================================================
// Internal Effect Implementations
// =============================================================================

function fetchBytesEffect(
  provider: HttpZkConfigProviderData,
  url: string,
): Effect.Effect<Uint8Array, ZkConfigError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await provider.fetchFn(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    },
    catch: (cause) =>
      new ZkConfigError({
        cause,
        message: `Failed to fetch ZK config from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function getZKIREffect(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Effect.Effect<ZKIR, ZkConfigError> {
  return Effect.gen(function* () {
    const cached = provider.cache.get(circuitId);
    if (cached) {
      return cached.zkir;
    }

    const bytes = yield* fetchBytesEffect(provider, `${provider.baseUrl}/${circuitId}/zkir`);
    return createZKIR(bytes);
  });
}

function getProverKeyEffect(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Effect.Effect<ProverKey, ZkConfigError> {
  return Effect.gen(function* () {
    const cached = provider.cache.get(circuitId);
    if (cached) {
      return cached.proverKey;
    }

    const bytes = yield* fetchBytesEffect(provider, `${provider.baseUrl}/${circuitId}/prover-key`);
    return createProverKey(bytes);
  });
}

function getVerifierKeyEffect(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Effect.Effect<VerifierKey, ZkConfigError> {
  return Effect.gen(function* () {
    const cached = provider.cache.get(circuitId);
    if (cached) {
      return cached.verifierKey;
    }

    const bytes = yield* fetchBytesEffect(provider, `${provider.baseUrl}/${circuitId}/verifier-key`);
    return createVerifierKey(bytes);
  });
}

// =============================================================================
// Promise API
// =============================================================================

/**
 * Create a new HTTP ZK config provider.
 *
 * @param baseUrl - Base URL for ZK artifacts (without trailing slash)
 * @param fetchFn - Optional custom fetch function (defaults to global fetch)
 * @returns HttpZkConfigProviderData
 *
 * @example
 * ```typescript
 * const provider = HttpZkConfigProvider.make('https://cdn.example.com/contracts/counter');
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function make(baseUrl: string, fetchFn?: typeof fetch): HttpZkConfigProviderData {
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    fetchFn: fetchFn ?? fetch,
    cache: new Map(),
  };
}

/**
 * Get the ZKIR for a circuit.
 *
 * @param provider - The provider data
 * @param circuitId - Circuit identifier
 * @returns ZKIR bytes
 *
 * @since 0.2.0
 * @category operations
 */
export async function getZKIR(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Promise<ZKIR> {
  return runEffectPromise(getZKIREffect(provider, circuitId));
}

/**
 * Get the prover key for a circuit.
 *
 * @param provider - The provider data
 * @param circuitId - Circuit identifier
 * @returns Prover key bytes
 *
 * @since 0.2.0
 * @category operations
 */
export async function getProverKey(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Promise<ProverKey> {
  return runEffectPromise(getProverKeyEffect(provider, circuitId));
}

/**
 * Get the verifier key for a circuit.
 *
 * @param provider - The provider data
 * @param circuitId - Circuit identifier
 * @returns Verifier key bytes
 *
 * @since 0.2.0
 * @category operations
 */
export async function getVerifierKey(
  provider: HttpZkConfigProviderData,
  circuitId: string,
): Promise<VerifierKey> {
  return runEffectPromise(getVerifierKeyEffect(provider, circuitId));
}

/**
 * Clear the cache for a specific circuit or all circuits.
 *
 * @param provider - The provider data
 * @param circuitId - Optional circuit ID to clear (clears all if not provided)
 *
 * @since 0.2.0
 * @category utilities
 */
export function clearCache(provider: HttpZkConfigProviderData, circuitId?: string): void {
  if (circuitId) {
    provider.cache.delete(circuitId);
  } else {
    provider.cache.clear();
  }
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  getZKIR: getZKIREffect,
  getProverKey: getProverKeyEffect,
  getVerifierKey: getVerifierKeyEffect,
};

// =============================================================================
// ZKConfigProvider Wrapper Class (for midnight-js compatibility)
// =============================================================================

/**
 * HTTP-based ZK configuration provider class.
 *
 * This class wraps the module functions to provide compatibility with
 * the midnight-js ZKConfigProvider interface.
 *
 * @example
 * ```typescript
 * const zkConfig = new HttpZkConfigProvider('https://cdn.example.com/contracts/counter');
 *
 * // Use with midnight-js
 * const client = await Client.create({
 *   zkConfigProvider: zkConfig,
 *   // ...
 * });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export class HttpZkConfigProvider<K extends string = string> extends ZKConfigProvider<K> {
  private readonly data: HttpZkConfigProviderData;

  /**
   * Create a new HTTP ZK config provider.
   *
   * @param baseUrl - Base URL for ZK artifacts (without trailing slash)
   * @param fetchFn - Optional custom fetch function (defaults to global fetch)
   */
  constructor(baseUrl: string, fetchFn?: typeof fetch) {
    super();
    this.data = make(baseUrl, fetchFn);
  }

  /**
   * Get the ZKIR for a circuit.
   */
  async getZKIR(circuitId: K): Promise<ZKIR> {
    return getZKIR(this.data, circuitId);
  }

  /**
   * Get the prover key for a circuit.
   */
  async getProverKey(circuitId: K): Promise<ProverKey> {
    return getProverKey(this.data, circuitId);
  }

  /**
   * Get the verifier key for a circuit.
   */
  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return getVerifierKey(this.data, circuitId);
  }

  /**
   * Clear the cache for a specific circuit or all circuits.
   */
  clearCache(circuitId?: K): void {
    clearCache(this.data, circuitId);
  }

  /**
   * Raw Effect APIs for advanced users.
   *
   * @since 0.2.0
   * @category effect
   */
  readonly effect = {
    getZKIR: (circuitId: K) => getZKIREffect(this.data, circuitId),
    getProverKey: (circuitId: K) => getProverKeyEffect(this.data, circuitId),
    getVerifierKey: (circuitId: K) => getVerifierKeyEffect(this.data, circuitId),
  };
}

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

/**
 * Service interface for ZkConfig operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface ZkConfigServiceImpl {
  readonly getZKIR: (
    provider: HttpZkConfigProviderData,
    circuitId: string,
  ) => Effect.Effect<ZKIR, ZkConfigError>;
  readonly getProverKey: (
    provider: HttpZkConfigProviderData,
    circuitId: string,
  ) => Effect.Effect<ProverKey, ZkConfigError>;
  readonly getVerifierKey: (
    provider: HttpZkConfigProviderData,
    circuitId: string,
  ) => Effect.Effect<VerifierKey, ZkConfigError>;
}

/**
 * Context.Tag for ZkConfigService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class ZkConfigService extends Context.Tag('ZkConfigService')<
  ZkConfigService,
  ZkConfigServiceImpl
>() {}

// =============================================================================
// Effect DI - Live Layer
// =============================================================================

/**
 * Live Layer for ZkConfigService.
 *
 * @since 0.2.0
 * @category layer
 */
export const ZkConfigLive: Layer.Layer<ZkConfigService> = Layer.succeed(ZkConfigService, {
  getZKIR: getZKIREffect,
  getProverKey: getProverKeyEffect,
  getVerifierKey: getVerifierKeyEffect,
});

/**
 * ZK configuration provider service for dependency injection.
 *
 * This tag allows injecting a ZKConfigProvider instance.
 *
 * @since 0.3.0
 * @category services
 */
export class ZkConfigProviderService extends Context.Tag('ZkConfigProviderService')<
  ZkConfigProviderService,
  ZKConfigProvider<string>
>() {}
