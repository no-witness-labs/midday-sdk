/**
 * IndexedDB-based private state provider for browser environments.
 *
 * ## API Design
 *
 * This module uses a **module-function pattern**:
 *
 * - **Stateless**: Functions operate on PrivateStateProvider data
 * - **Module functions**: `PrivateState.get(provider, id)`, `PrivateState.set(provider, id, state)`
 * - **Data-oriented**: Provider is plain data, not an instance with methods
 *
 * ### Usage Patterns
 *
 * ```typescript
 * // Promise user
 * const provider = PrivateState.makeIndexedDB({ privateStateStoreName: 'my-app' });
 * const state = await PrivateState.get(provider, 'myContract');
 * await PrivateState.set(provider, 'myContract', { count: 0 });
 *
 * // Effect user
 * const provider = PrivateState.makeIndexedDB({ privateStateStoreName: 'my-app' });
 * const state = yield* PrivateState.effect.get(provider, 'myContract');
 * ```
 *
 * @since 0.2.0
 * @module
 */

import { Context, Effect, Layer } from 'effect';
import { BrowserLevel } from 'browser-level';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import { PrivateStateError } from './errors.js';
import { runEffectPromise } from '../utils/effect-runtime.js';

// Use string for contract address to avoid importing compact-runtime
type ContractAddress = string;

// SigningKey type matches compact-runtime's definition
type SigningKey = string;

/**
 * Configuration for IndexedDB private state storage.
 *
 * @since 0.2.0
 * @category model
 */
export interface IndexedDBPrivateStateConfig {
  /** Name of the IndexedDB store */
  privateStateStoreName: string;
  /** Password for encryption (optional, uses default if not provided) */
  password?: string;
}

/**
 * Represents a private state provider.
 *
 * This is plain data - use module functions to operate on it.
 *
 * @since 0.2.0
 * @category model
 */
export interface PrivateStateProviderData {
  /** State database */
  readonly stateDb: BrowserLevel<string, Uint8Array> | Map<string, unknown>;
  /** Signing key database */
  readonly signingKeyDb: BrowserLevel<string, Uint8Array> | Map<string, SigningKey>;
  /** Encryption function */
  readonly encrypt: (data: Uint8Array) => Uint8Array;
  /** Decryption function */
  readonly decrypt: (data: Uint8Array) => Uint8Array;
  /** Type indicator */
  readonly type: 'indexeddb' | 'memory';
}

// =============================================================================
// Internal Effect Implementations
// =============================================================================

function getEffect(
  provider: PrivateStateProviderData,
  privateStateId: string,
): Effect.Effect<unknown | null, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.stateDb as Map<string, unknown>;
    return Effect.succeed(store.get(privateStateId) ?? null);
  }

  return Effect.tryPromise({
    try: async () => {
      const stateDb = provider.stateDb as BrowserLevel<string, Uint8Array>;
      try {
        const encrypted = await stateDb.get(privateStateId);
        const decrypted = provider.decrypt(encrypted);
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json);
      } catch (error: unknown) {
        if ((error as { code?: string })?.code === 'LEVEL_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to get private state '${privateStateId}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function setEffect(
  provider: PrivateStateProviderData,
  privateStateId: string,
  state: unknown,
): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.stateDb as Map<string, unknown>;
    return Effect.sync(() => {
      store.set(privateStateId, state);
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const stateDb = provider.stateDb as BrowserLevel<string, Uint8Array>;
      const json = JSON.stringify(state);
      const bytes = new TextEncoder().encode(json);
      const encrypted = provider.encrypt(bytes);
      await stateDb.put(privateStateId, encrypted);
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to set private state '${privateStateId}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function removeEffect(
  provider: PrivateStateProviderData,
  privateStateId: string,
): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.stateDb as Map<string, unknown>;
    return Effect.sync(() => {
      store.delete(privateStateId);
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const stateDb = provider.stateDb as BrowserLevel<string, Uint8Array>;
      try {
        await stateDb.del(privateStateId);
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'LEVEL_NOT_FOUND') {
          throw error;
        }
      }
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to remove private state '${privateStateId}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function clearEffect(provider: PrivateStateProviderData): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.stateDb as Map<string, unknown>;
    return Effect.sync(() => {
      store.clear();
    });
  }

  return Effect.tryPromise({
    try: () => (provider.stateDb as BrowserLevel<string, Uint8Array>).clear(),
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to clear private state: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function setSigningKeyEffect(
  provider: PrivateStateProviderData,
  address: ContractAddress,
  signingKey: SigningKey,
): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.signingKeyDb as Map<string, SigningKey>;
    return Effect.sync(() => {
      store.set(address, signingKey);
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const signingKeyDb = provider.signingKeyDb as BrowserLevel<string, Uint8Array>;
      const json = JSON.stringify(signingKey);
      const serialized = new TextEncoder().encode(json);
      const encrypted = provider.encrypt(serialized);
      await signingKeyDb.put(address, encrypted);
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to set signing key for '${address}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function getSigningKeyEffect(
  provider: PrivateStateProviderData,
  address: ContractAddress,
): Effect.Effect<SigningKey | null, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.signingKeyDb as Map<string, SigningKey>;
    return Effect.succeed(store.get(address) ?? null);
  }

  return Effect.tryPromise({
    try: async () => {
      const signingKeyDb = provider.signingKeyDb as BrowserLevel<string, Uint8Array>;
      try {
        const encrypted = await signingKeyDb.get(address);
        const decrypted = provider.decrypt(encrypted);
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json) as SigningKey;
      } catch (error: unknown) {
        if ((error as { code?: string })?.code === 'LEVEL_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to get signing key for '${address}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function removeSigningKeyEffect(
  provider: PrivateStateProviderData,
  address: ContractAddress,
): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.signingKeyDb as Map<string, SigningKey>;
    return Effect.sync(() => {
      store.delete(address);
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const signingKeyDb = provider.signingKeyDb as BrowserLevel<string, Uint8Array>;
      try {
        await signingKeyDb.del(address);
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'LEVEL_NOT_FOUND') {
          throw error;
        }
      }
    },
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to remove signing key for '${address}': ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

function clearSigningKeysEffect(provider: PrivateStateProviderData): Effect.Effect<void, PrivateStateError> {
  if (provider.type === 'memory') {
    const store = provider.signingKeyDb as Map<string, SigningKey>;
    return Effect.sync(() => {
      store.clear();
    });
  }

  return Effect.tryPromise({
    try: () => (provider.signingKeyDb as BrowserLevel<string, Uint8Array>).clear(),
    catch: (cause) =>
      new PrivateStateError({
        cause,
        message: `Failed to clear signing keys: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
}

// =============================================================================
// Promise API
// =============================================================================

/**
 * Create an IndexedDB-based private state provider.
 *
 * @param config - Configuration options
 * @returns PrivateStateProviderData
 *
 * @example
 * ```typescript
 * const provider = makeIndexedDB({
 *   privateStateStoreName: 'my-dapp-state',
 *   password: 'user-password',
 * });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function makeIndexedDB(config: IndexedDBPrivateStateConfig): PrivateStateProviderData {
  const { privateStateStoreName, password = 'default-password-change-me' } = config;

  const stateDb = new BrowserLevel<string, Uint8Array>(`${privateStateStoreName}-state`, {
    valueEncoding: 'view',
  });

  const signingKeyDb = new BrowserLevel<string, Uint8Array>(`${privateStateStoreName}-signing-keys`, {
    valueEncoding: 'view',
  });

  // Simple XOR-based encryption (for demonstration - real apps should use proper crypto)
  const passwordBytes = new TextEncoder().encode(password);

  function encrypt(data: Uint8Array): Uint8Array {
    const encrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      encrypted[i] = data[i] ^ passwordBytes[i % passwordBytes.length];
    }
    return encrypted;
  }

  function decrypt(data: Uint8Array): Uint8Array {
    return encrypt(data); // XOR is symmetric
  }

  return {
    stateDb,
    signingKeyDb,
    encrypt,
    decrypt,
    type: 'indexeddb',
  };
}

/**
 * Create an in-memory private state provider (no persistence).
 *
 * @returns PrivateStateProviderData
 *
 * @example
 * ```typescript
 * const provider = makeInMemory();
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function makeInMemory(): PrivateStateProviderData {
  return {
    stateDb: new Map<string, unknown>(),
    signingKeyDb: new Map<string, SigningKey>(),
    encrypt: (data) => data,
    decrypt: (data) => data,
    type: 'memory',
  };
}

/**
 * Get private state.
 *
 * @since 0.2.0
 * @category operations
 */
export async function get(
  provider: PrivateStateProviderData,
  privateStateId: string,
): Promise<unknown | null> {
  return runEffectPromise(getEffect(provider, privateStateId));
}

/**
 * Set private state.
 *
 * @since 0.2.0
 * @category operations
 */
export async function set(
  provider: PrivateStateProviderData,
  privateStateId: string,
  state: unknown,
): Promise<void> {
  return runEffectPromise(setEffect(provider, privateStateId, state));
}

/**
 * Remove private state.
 *
 * @since 0.2.0
 * @category operations
 */
export async function remove(
  provider: PrivateStateProviderData,
  privateStateId: string,
): Promise<void> {
  return runEffectPromise(removeEffect(provider, privateStateId));
}

/**
 * Clear all private state.
 *
 * @since 0.2.0
 * @category operations
 */
export async function clear(provider: PrivateStateProviderData): Promise<void> {
  return runEffectPromise(clearEffect(provider));
}

/**
 * Set signing key.
 *
 * @since 0.2.0
 * @category operations
 */
export async function setSigningKey(
  provider: PrivateStateProviderData,
  address: ContractAddress,
  signingKey: SigningKey,
): Promise<void> {
  return runEffectPromise(setSigningKeyEffect(provider, address, signingKey));
}

/**
 * Get signing key.
 *
 * @since 0.2.0
 * @category operations
 */
export async function getSigningKey(
  provider: PrivateStateProviderData,
  address: ContractAddress,
): Promise<SigningKey | null> {
  return runEffectPromise(getSigningKeyEffect(provider, address));
}

/**
 * Remove signing key.
 *
 * @since 0.2.0
 * @category operations
 */
export async function removeSigningKey(
  provider: PrivateStateProviderData,
  address: ContractAddress,
): Promise<void> {
  return runEffectPromise(removeSigningKeyEffect(provider, address));
}

/**
 * Clear all signing keys.
 *
 * @since 0.2.0
 * @category operations
 */
export async function clearSigningKeys(provider: PrivateStateProviderData): Promise<void> {
  return runEffectPromise(clearSigningKeysEffect(provider));
}

/**
 * Raw Effect APIs for advanced users.
 *
 * @since 0.2.0
 * @category effect
 */
export const effect = {
  get: getEffect,
  set: setEffect,
  remove: removeEffect,
  clear: clearEffect,
  setSigningKey: setSigningKeyEffect,
  getSigningKey: getSigningKeyEffect,
  removeSigningKey: removeSigningKeyEffect,
  clearSigningKeys: clearSigningKeysEffect,
};

// =============================================================================
// PrivateStateProvider Wrapper (for midnight-js compatibility)
// =============================================================================

/**
 * Create a browser-compatible private state provider using IndexedDB.
 *
 * This function returns a PrivateStateProvider compatible with midnight-js.
 *
 * @param config - Configuration options
 * @returns PrivateStateProvider compatible with midnight-js
 *
 * @example
 * ```typescript
 * const provider = indexedDBPrivateStateProvider({
 *   privateStateStoreName: 'my-dapp-state',
 *   password: 'user-password',
 * });
 *
 * // Use with Client.create()
 * const client = await Client.create({
 *   privateStateProvider: provider,
 *   // ...
 * });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function indexedDBPrivateStateProvider(
  config: IndexedDBPrivateStateConfig,
): PrivateStateProvider<string, unknown> {
  const data = makeIndexedDB(config);

  return {
    async get(privateStateId: string): Promise<unknown | null> {
      return get(data, privateStateId);
    },
    async set(privateStateId: string, state: unknown): Promise<void> {
      return set(data, privateStateId, state);
    },
    async remove(privateStateId: string): Promise<void> {
      return remove(data, privateStateId);
    },
    async clear(): Promise<void> {
      return clear(data);
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      return setSigningKey(data, address, signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return getSigningKey(data, address);
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      return removeSigningKey(data, address);
    },
    async clearSigningKeys(): Promise<void> {
      return clearSigningKeys(data);
    },
  };
}

/**
 * Create an in-memory private state provider (no persistence).
 *
 * This function returns a PrivateStateProvider compatible with midnight-js.
 *
 * @returns PrivateStateProvider that stores state in memory
 *
 * @example
 * ```typescript
 * const provider = inMemoryPrivateStateProvider();
 *
 * // Use with Client.create()
 * const client = await Client.create({
 *   privateStateProvider: provider,
 *   // ...
 * });
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export function inMemoryPrivateStateProvider(): PrivateStateProvider<string, unknown> {
  const data = makeInMemory();

  return {
    async get(privateStateId: string): Promise<unknown | null> {
      return get(data, privateStateId);
    },
    async set(privateStateId: string, state: unknown): Promise<void> {
      return set(data, privateStateId, state);
    },
    async remove(privateStateId: string): Promise<void> {
      return remove(data, privateStateId);
    },
    async clear(): Promise<void> {
      return clear(data);
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      return setSigningKey(data, address, signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return getSigningKey(data, address);
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      return removeSigningKey(data, address);
    },
    async clearSigningKeys(): Promise<void> {
      return clearSigningKeys(data);
    },
  };
}

// =============================================================================
// Effect DI - Service Definitions
// =============================================================================

/**
 * Service interface for PrivateState operations.
 *
 * @since 0.2.0
 * @category service
 */
export interface PrivateStateServiceImpl {
  readonly get: (
    provider: PrivateStateProviderData,
    privateStateId: string,
  ) => Effect.Effect<unknown | null, PrivateStateError>;
  readonly set: (
    provider: PrivateStateProviderData,
    privateStateId: string,
    state: unknown,
  ) => Effect.Effect<void, PrivateStateError>;
  readonly remove: (
    provider: PrivateStateProviderData,
    privateStateId: string,
  ) => Effect.Effect<void, PrivateStateError>;
  readonly clear: (provider: PrivateStateProviderData) => Effect.Effect<void, PrivateStateError>;
  readonly setSigningKey: (
    provider: PrivateStateProviderData,
    address: string,
    signingKey: string,
  ) => Effect.Effect<void, PrivateStateError>;
  readonly getSigningKey: (
    provider: PrivateStateProviderData,
    address: string,
  ) => Effect.Effect<string | null, PrivateStateError>;
  readonly removeSigningKey: (
    provider: PrivateStateProviderData,
    address: string,
  ) => Effect.Effect<void, PrivateStateError>;
  readonly clearSigningKeys: (
    provider: PrivateStateProviderData,
  ) => Effect.Effect<void, PrivateStateError>;
}

/**
 * Context.Tag for PrivateStateService dependency injection.
 *
 * @since 0.2.0
 * @category service
 */
export class PrivateStateService extends Context.Tag('PrivateStateService')<
  PrivateStateService,
  PrivateStateServiceImpl
>() {}

// =============================================================================
// Effect DI - Live Layer
// =============================================================================

/**
 * Live Layer for PrivateStateService.
 *
 * @since 0.2.0
 * @category layer
 */
export const PrivateStateLive: Layer.Layer<PrivateStateService> = Layer.succeed(PrivateStateService, {
  get: getEffect,
  set: setEffect,
  remove: removeEffect,
  clear: clearEffect,
  setSigningKey: setSigningKeyEffect,
  getSigningKey: getSigningKeyEffect,
  removeSigningKey: removeSigningKeyEffect,
  clearSigningKeys: clearSigningKeysEffect,
});

/**
 * Private state provider service for dependency injection.
 *
 * This tag allows injecting a PrivateStateProvider instance.
 *
 * @since 0.3.0
 * @category services
 */
export class PrivateStateProviderService extends Context.Tag('PrivateStateProviderService')<
  PrivateStateProviderService,
  PrivateStateProvider
>() {}
