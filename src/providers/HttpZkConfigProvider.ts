/**
 * HTTP-based ZK configuration provider.
 *
 * Fetches ZK circuit artifacts (ZKIR, prover keys, verifier keys) via HTTP.
 * Works in both browser and Node.js environments.
 *
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.2.0
 * @module
 */

import { Effect } from 'effect';
import {
  ZKConfigProvider,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';

import { ZkConfigError } from '../errors/index.js';
import { runEffectPromise } from '../utils/effect-runtime.js';

/**
 * ZK configuration loaded from HTTP endpoints.
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
 * Effect-based interface for ZK config provider.
 */
export interface ZkConfigProviderEffect<K extends string = string> {
  readonly getZKIR: (circuitId: K) => Effect.Effect<ZKIR, ZkConfigError>;
  readonly getProverKey: (circuitId: K) => Effect.Effect<ProverKey, ZkConfigError>;
  readonly getVerifierKey: (circuitId: K) => Effect.Effect<VerifierKey, ZkConfigError>;
}

/**
 * HTTP-based ZK configuration provider.
 *
 * Fetches ZK artifacts from a base URL with the following structure:
 * - `{baseUrl}/{circuitId}/zkir`
 * - `{baseUrl}/{circuitId}/prover-key`
 * - `{baseUrl}/{circuitId}/verifier-key`
 *
 * @typeParam K - Circuit identifier type (usually string)
 *
 * @example
 * ```typescript
 * const zkConfig = new HttpZkConfigProvider('https://cdn.example.com/contracts/counter');
 *
 * // Effect-based usage
 * const zkir = yield* zkConfig.Effect.getZKIR('increment');
 *
 * // Promise-based usage
 * const zkir = await zkConfig.getZKIR('increment');
 * ```
 */
export class HttpZkConfigProvider<K extends string = string> extends ZKConfigProvider<K> {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: Map<string, ZkConfig> = new Map();

  /**
   * Effect-based API for ZK config operations.
   */
  readonly Effect: ZkConfigProviderEffect<K>;

  /**
   * Create a new HTTP ZK config provider.
   *
   * @param baseUrl - Base URL for ZK artifacts (without trailing slash)
   * @param fetchFn - Optional custom fetch function (defaults to global fetch)
   */
  constructor(baseUrl: string, fetchFn?: typeof fetch) {
    super();
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchFn = fetchFn ?? fetch;

    // Initialize Effect API
    this.Effect = {
      getZKIR: (circuitId: K) => this.getZKIREffect(circuitId),
      getProverKey: (circuitId: K) => this.getProverKeyEffect(circuitId),
      getVerifierKey: (circuitId: K) => this.getVerifierKeyEffect(circuitId),
    };
  }

  // ===========================================================================
  // Effect API (internal)
  // ===========================================================================

  private getZKIREffect(circuitId: K): Effect.Effect<ZKIR, ZkConfigError> {
    return Effect.gen(this, function* () {
      const cached = this.cache.get(circuitId);
      if (cached) {
        return cached.zkir;
      }

      const bytes = yield* this.fetchBytesEffect(`${this.baseUrl}/${circuitId}/zkir`);
      return createZKIR(bytes);
    });
  }

  private getProverKeyEffect(circuitId: K): Effect.Effect<ProverKey, ZkConfigError> {
    return Effect.gen(this, function* () {
      const cached = this.cache.get(circuitId);
      if (cached) {
        return cached.proverKey;
      }

      const bytes = yield* this.fetchBytesEffect(`${this.baseUrl}/${circuitId}/prover-key`);
      return createProverKey(bytes);
    });
  }

  private getVerifierKeyEffect(circuitId: K): Effect.Effect<VerifierKey, ZkConfigError> {
    return Effect.gen(this, function* () {
      const cached = this.cache.get(circuitId);
      if (cached) {
        return cached.verifierKey;
      }

      const bytes = yield* this.fetchBytesEffect(`${this.baseUrl}/${circuitId}/verifier-key`);
      return createVerifierKey(bytes);
    });
  }

  private fetchBytesEffect(url: string): Effect.Effect<Uint8Array, ZkConfigError> {
    return Effect.tryPromise({
      try: async () => {
        const response = await this.fetchFn(url);
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

  // ===========================================================================
  // Promise API (for ZKConfigProvider compatibility)
  // ===========================================================================

  /**
   * Get the ZKIR for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns ZKIR bytes
   */
  async getZKIR(circuitId: K): Promise<ZKIR> {
    return runEffectPromise(this.getZKIREffect(circuitId));
  }

  /**
   * Get the prover key for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns Prover key bytes
   */
  async getProverKey(circuitId: K): Promise<ProverKey> {
    return runEffectPromise(this.getProverKeyEffect(circuitId));
  }

  /**
   * Get the verifier key for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns Verifier key bytes
   */
  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return runEffectPromise(this.getVerifierKeyEffect(circuitId));
  }

  /**
   * Clear the cache for a specific circuit or all circuits.
   *
   * @param circuitId - Optional circuit ID to clear (clears all if not provided)
   */
  clearCache(circuitId?: K): void {
    if (circuitId) {
      this.cache.delete(circuitId);
    } else {
      this.cache.clear();
    }
  }
}
