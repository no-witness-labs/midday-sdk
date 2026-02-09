/**
 * Zero-knowledge configuration providers for Compact contracts.
 *
 * ZK config providers load the compiled circuit artifacts (ZKIR, prover keys,
 * verifier keys) needed to generate and verify zero-knowledge proofs.
 *
 * Provides filesystem (`fromPath`) and HTTP (`fromUrl`) factory functions,
 * plus an HTTP-based provider with caching for advanced use cases.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * // Preferred: Load zkConfig automatically via loadContract path option
 * const contract = await client.loadContract({ path: './contracts/my-contract' });
 *
 * // Alternative: Pre-load zkConfig for advanced use cases
 * const zkConfig = Midday.ZkConfig.fromPath('./contracts/my-contract');
 * const contract = await client.loadContract({ module, zkConfig });
 *
 * // HTTP-based provider with caching
 * const provider = Midday.ZkConfig.makeHttp('https://cdn.example.com/zk');
 * const zkir = await Midday.ZkConfig.getZKIR(provider, 'increment');
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Context, Data, Effect, Layer } from 'effect';
import type { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  ZKConfigProvider as ZKConfigProviderBase,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

import { runEffectPromise } from './Runtime.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error fetching ZK configuration.
 *
 * @since 0.3.0
 * @category errors
 */
export class ZkConfigError extends Data.TaggedError('ZkConfigError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

// =============================================================================
// Types
// =============================================================================

/**
 * A provider that loads ZK circuit configuration (ZKIR, prover/verifier keys).
 *
 * @since 0.3.0
 * @category model
 */
export type Provider = ZKConfigProvider<string>;

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
 * This is plain data — use module functions to operate on it.
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
// Factory Functions
// =============================================================================

/**
 * Create a ZK config provider that loads from the local filesystem.
 *
 * This provider reads compiled contract artifacts from disk. Use this
 * in Node.js environments (tests, scripts, backend services).
 *
 * @param contractPath - Path to the compiled contract directory
 * @returns A ZK config provider instance
 *
 * @example
 * ```typescript
 * const zkConfig = Midday.ZkConfig.fromPath('./contracts/my-contract');
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export function fromPath(contractPath: string): Provider {
  return new NodeZkConfigProvider(contractPath);
}

/**
 * Create a ZK config provider that loads from an HTTP server.
 *
 * This provider fetches compiled contract artifacts over HTTP. Use this
 * in browser environments or when artifacts are hosted on a CDN.
 *
 * @param baseUrl - Base URL where ZK artifacts are hosted
 * @returns A ZK config provider instance
 *
 * @example
 * ```typescript
 * const zkConfig = Midday.ZkConfig.fromUrl('https://cdn.example.com/zk');
 * ```
 *
 * @since 0.3.0
 * @category constructors
 */
export function fromUrl(baseUrl: string): Provider {
  return new FetchZkConfigProvider(baseUrl);
}

// =============================================================================
// HTTP Provider — Internal Effects
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
// HTTP Provider — Promise API
// =============================================================================

/**
 * Create a new HTTP ZK config provider data object.
 *
 * @param baseUrl - Base URL for ZK artifacts (without trailing slash)
 * @param fetchFn - Optional custom fetch function (defaults to global fetch)
 * @returns HttpZkConfigProviderData
 *
 * @example
 * ```typescript
 * const provider = Midday.ZkConfig.makeHttp('https://cdn.example.com/contracts/counter');
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function makeHttp(baseUrl: string, fetchFn?: typeof fetch): HttpZkConfigProviderData {
  // Wrap global fetch to preserve 'this' context in browsers
  const defaultFetch: typeof fetch = (input, init) => fetch(input, init);
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    fetchFn: fetchFn ?? defaultFetch,
    cache: new Map(),
  };
}

/**
 * Get the ZKIR for a circuit.
 *
 * @throws {ZkConfigError} When fetch fails
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
 * @throws {ZkConfigError} When fetch fails
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
 * @throws {ZkConfigError} When fetch fails
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
// HttpZkConfigProvider Class (midnight-js compatibility)
// =============================================================================

/**
 * HTTP-based ZK configuration provider class.
 *
 * Wraps the module functions to provide compatibility with
 * the midnight-js `ZKConfigProvider` interface.
 *
 * @example
 * ```typescript
 * const zkConfig = new Midday.ZkConfig.HttpZkConfigProvider(
 *   'https://cdn.example.com/contracts/counter',
 * );
 * const contract = await client.loadContract({ module, zkConfig });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export class HttpZkConfigProvider<K extends string = string> extends ZKConfigProviderBase<K> {
  private readonly data: HttpZkConfigProviderData;

  constructor(baseUrl: string, fetchFn?: typeof fetch) {
    super();
    this.data = makeHttp(baseUrl, fetchFn);
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    return getZKIR(this.data, circuitId);
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    return getProverKey(this.data, circuitId);
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return getVerifierKey(this.data, circuitId);
  }

  clearCache(circuitId?: K): void {
    clearCache(this.data, circuitId);
  }

  readonly httpEffect = {
    getZKIR: (circuitId: K) => getZKIREffect(this.data, circuitId),
    getProverKey: (circuitId: K) => getProverKeyEffect(this.data, circuitId),
    getVerifierKey: (circuitId: K) => getVerifierKeyEffect(this.data, circuitId),
  };
}

// =============================================================================
// Effect DI — Service Definitions
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
 * @since 0.3.0
 * @category service
 */
export class ZkConfigProviderService extends Context.Tag('ZkConfigProviderService')<
  ZkConfigProviderService,
  ZKConfigProvider<string>
>() {}
