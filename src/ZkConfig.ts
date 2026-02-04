/**
 * Zero-knowledge configuration providers for Compact contracts.
 *
 * ZK config providers load the compiled circuit artifacts (ZKIR, prover keys,
 * verifier keys) needed to generate and verify zero-knowledge proofs.
 *
 * Each contract has its own zk circuits - this is a first principle.
 * zkConfig is loaded per-contract via `loadContract()`, not at client creation.
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
 * ```
 *
 * @since 0.3.0
 * @module
 */

import type { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

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
// Re-exports for Advanced Use
// =============================================================================

/**
 * HTTP-based ZK config provider class.
 *
 * Use `fromUrl()` for most cases. Direct class access is provided
 * for advanced configuration or subclassing.
 *
 * @since 0.3.0
 * @category advanced
 */
export { HttpZkConfigProvider } from './providers/HttpZkConfigProvider.js';

// Re-export error type
export { ZkConfigError } from './providers/errors.js';
