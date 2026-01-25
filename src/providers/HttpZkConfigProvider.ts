/**
 * HTTP-based ZK configuration provider.
 *
 * Fetches ZK circuit artifacts (ZKIR, prover keys, verifier keys) via HTTP.
 * Works in both browser and Node.js environments.
 *
 * @since 0.2.0
 * @module
 */

import {
  ZKConfigProvider,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  createProverKey,
  createVerifierKey,
  createZKIR,
} from '@midnight-ntwrk/midnight-js-types';

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
 * // Fetches from:
 * // - https://cdn.example.com/contracts/counter/increment/zkir
 * // - https://cdn.example.com/contracts/counter/increment/prover-key
 * // - https://cdn.example.com/contracts/counter/increment/verifier-key
 * const config = await zkConfig.get('increment');
 * ```
 */
export class HttpZkConfigProvider<K extends string = string> extends ZKConfigProvider<K> {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: Map<string, ZkConfig> = new Map();

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
  }

  /**
   * Get the ZKIR for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns ZKIR bytes
   */
  async getZKIR(circuitId: K): Promise<ZKIR> {
    const cached = this.cache.get(circuitId);
    if (cached) {
      return cached.zkir;
    }

    const bytes = await this.fetchBytes(`${this.baseUrl}/${circuitId}/zkir`);
    return createZKIR(bytes);
  }

  /**
   * Get the prover key for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns Prover key bytes
   */
  async getProverKey(circuitId: K): Promise<ProverKey> {
    const cached = this.cache.get(circuitId);
    if (cached) {
      return cached.proverKey;
    }

    const bytes = await this.fetchBytes(`${this.baseUrl}/${circuitId}/prover-key`);
    return createProverKey(bytes);
  }

  /**
   * Get the verifier key for a circuit.
   *
   * @param circuitId - Circuit identifier
   * @returns Verifier key bytes
   */
  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    const cached = this.cache.get(circuitId);
    if (cached) {
      return cached.verifierKey;
    }

    const bytes = await this.fetchBytes(`${this.baseUrl}/${circuitId}/verifier-key`);
    return createVerifierKey(bytes);
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

  /**
   * Fetch bytes from a URL.
   */
  private async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
