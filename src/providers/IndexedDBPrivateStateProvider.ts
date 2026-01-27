/**
 * IndexedDB-based private state provider for browser environments.
 *
 * Uses browser-level (which wraps IndexedDB) for persistent encrypted storage.
 * Provides dual API: Effect-based and Promise-based.
 *
 * @since 0.2.0
 * @module
 */

import { Effect } from 'effect';
import { BrowserLevel } from 'browser-level';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

import { PrivateStateError } from '../errors/index.js';
import { runEffectPromise } from '../utils/effect-runtime.js';

// Use string for contract address to avoid importing compact-runtime
type ContractAddress = string;

// Simplified signing key type - actual structure may differ
type SigningKey = unknown;

/**
 * Configuration for IndexedDB private state storage.
 */
export interface IndexedDBPrivateStateConfig {
  /** Name of the IndexedDB store */
  privateStateStoreName: string;
  /** Password for encryption (optional, uses default if not provided) */
  password?: string;
}

/**
 * Effect-based interface for private state provider.
 */
export interface PrivateStateProviderEffect {
  readonly get: (privateStateId: string) => Effect.Effect<unknown | null, PrivateStateError>;
  readonly set: (privateStateId: string, state: unknown) => Effect.Effect<void, PrivateStateError>;
  readonly remove: (privateStateId: string) => Effect.Effect<void, PrivateStateError>;
  readonly clear: () => Effect.Effect<void, PrivateStateError>;
  readonly setSigningKey: (address: ContractAddress, signingKey: SigningKey) => Effect.Effect<void, PrivateStateError>;
  readonly getSigningKey: (address: ContractAddress) => Effect.Effect<SigningKey | null, PrivateStateError>;
  readonly removeSigningKey: (address: ContractAddress) => Effect.Effect<void, PrivateStateError>;
  readonly clearSigningKeys: () => Effect.Effect<void, PrivateStateError>;
}

/**
 * Extended PrivateStateProvider with Effect API.
 */
export interface IndexedDBPrivateStateProviderWithEffect extends PrivateStateProvider<string, unknown> {
  readonly Effect: PrivateStateProviderEffect;
}

/**
 * Create a browser-compatible private state provider using IndexedDB.
 *
 * This provider stores encrypted private state in the browser's IndexedDB,
 * allowing state to persist across page reloads.
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
 * // Effect-based usage
 * const state = yield* provider.Effect.get('myContract');
 *
 * // Promise-based usage
 * const state = await provider.get('myContract');
 * ```
 */
export function indexedDBPrivateStateProvider(
  config: IndexedDBPrivateStateConfig,
): IndexedDBPrivateStateProviderWithEffect {
  const { privateStateStoreName, password = 'default-password-change-me' } = config;

  // Create separate stores for state and signing keys
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

  function serializeSigningKey(signingKey: SigningKey): Uint8Array {
    const json = JSON.stringify(signingKey);
    return new TextEncoder().encode(json);
  }

  function deserializeSigningKey(data: Uint8Array): SigningKey {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json) as SigningKey;
  }

  // Effect-based implementations
  function getEffect(privateStateId: string): Effect.Effect<unknown | null, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
        try {
          const encrypted = await stateDb.get(privateStateId);
          const decrypted = decrypt(encrypted);
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

  function setEffect(privateStateId: string, state: unknown): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
        const json = JSON.stringify(state);
        const bytes = new TextEncoder().encode(json);
        const encrypted = encrypt(bytes);
        await stateDb.put(privateStateId, encrypted);
      },
      catch: (cause) =>
        new PrivateStateError({
          cause,
          message: `Failed to set private state '${privateStateId}': ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function removeEffect(privateStateId: string): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
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

  function clearEffect(): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: () => stateDb.clear(),
      catch: (cause) =>
        new PrivateStateError({
          cause,
          message: `Failed to clear private state: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function setSigningKeyEffect(address: ContractAddress, signingKey: SigningKey): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
        const serialized = serializeSigningKey(signingKey);
        const encrypted = encrypt(serialized);
        await signingKeyDb.put(address, encrypted);
      },
      catch: (cause) =>
        new PrivateStateError({
          cause,
          message: `Failed to set signing key for '${address}': ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  function getSigningKeyEffect(address: ContractAddress): Effect.Effect<SigningKey | null, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
        try {
          const encrypted = await signingKeyDb.get(address);
          const decrypted = decrypt(encrypted);
          return deserializeSigningKey(decrypted);
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

  function removeSigningKeyEffect(address: ContractAddress): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: async () => {
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

  function clearSigningKeysEffect(): Effect.Effect<void, PrivateStateError> {
    return Effect.tryPromise({
      try: () => signingKeyDb.clear(),
      catch: (cause) =>
        new PrivateStateError({
          cause,
          message: `Failed to clear signing keys: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  }

  // Effect API object
  const effectAPI: PrivateStateProviderEffect = {
    get: getEffect,
    set: setEffect,
    remove: removeEffect,
    clear: clearEffect,
    setSigningKey: setSigningKeyEffect,
    getSigningKey: getSigningKeyEffect,
    removeSigningKey: removeSigningKeyEffect,
    clearSigningKeys: clearSigningKeysEffect,
  };

  return {
    Effect: effectAPI,

    async get(privateStateId: string): Promise<unknown | null> {
      return runEffectPromise(getEffect(privateStateId));
    },

    async set(privateStateId: string, state: unknown): Promise<void> {
      return runEffectPromise(setEffect(privateStateId, state));
    },

    async remove(privateStateId: string): Promise<void> {
      return runEffectPromise(removeEffect(privateStateId));
    },

    async clear(): Promise<void> {
      return runEffectPromise(clearEffect());
    },

    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      return runEffectPromise(setSigningKeyEffect(address, signingKey));
    },

    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return runEffectPromise(getSigningKeyEffect(address));
    },

    async removeSigningKey(address: ContractAddress): Promise<void> {
      return runEffectPromise(removeSigningKeyEffect(address));
    },

    async clearSigningKeys(): Promise<void> {
      return runEffectPromise(clearSigningKeysEffect());
    },
  };
}

/**
 * Effect-based interface for in-memory private state provider.
 */
export interface InMemoryPrivateStateProviderWithEffect extends PrivateStateProvider<string, unknown> {
  readonly Effect: PrivateStateProviderEffect;
}

/**
 * Create an in-memory private state provider (no persistence).
 *
 * Useful for testing or ephemeral sessions where persistence isn't needed.
 *
 * @returns PrivateStateProvider that stores state in memory
 *
 * @example
 * ```typescript
 * const provider = inMemoryPrivateStateProvider();
 *
 * // Effect-based usage
 * yield* provider.Effect.set('myContract', { count: 0 });
 *
 * // Promise-based usage
 * await provider.set('myContract', { count: 0 });
 * ```
 */
export function inMemoryPrivateStateProvider(): InMemoryPrivateStateProviderWithEffect {
  const stateStore = new Map<string, unknown>();
  const signingKeyStore = new Map<string, SigningKey>();

  // Effect-based implementations (in-memory operations never fail)
  function getEffect(privateStateId: string): Effect.Effect<unknown | null, PrivateStateError> {
    return Effect.succeed(stateStore.get(privateStateId) ?? null);
  }

  function setEffect(privateStateId: string, state: unknown): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      stateStore.set(privateStateId, state);
    });
  }

  function removeEffect(privateStateId: string): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      stateStore.delete(privateStateId);
    });
  }

  function clearEffect(): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      stateStore.clear();
    });
  }

  function setSigningKeyEffect(address: ContractAddress, signingKey: SigningKey): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      signingKeyStore.set(address, signingKey);
    });
  }

  function getSigningKeyEffect(address: ContractAddress): Effect.Effect<SigningKey | null, PrivateStateError> {
    return Effect.succeed(signingKeyStore.get(address) ?? null);
  }

  function removeSigningKeyEffect(address: ContractAddress): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      signingKeyStore.delete(address);
    });
  }

  function clearSigningKeysEffect(): Effect.Effect<void, PrivateStateError> {
    return Effect.sync(() => {
      signingKeyStore.clear();
    });
  }

  // Effect API object
  const effectAPI: PrivateStateProviderEffect = {
    get: getEffect,
    set: setEffect,
    remove: removeEffect,
    clear: clearEffect,
    setSigningKey: setSigningKeyEffect,
    getSigningKey: getSigningKeyEffect,
    removeSigningKey: removeSigningKeyEffect,
    clearSigningKeys: clearSigningKeysEffect,
  };

  return {
    Effect: effectAPI,

    async get(privateStateId: string): Promise<unknown | null> {
      return stateStore.get(privateStateId) ?? null;
    },

    async set(privateStateId: string, state: unknown): Promise<void> {
      stateStore.set(privateStateId, state);
    },

    async remove(privateStateId: string): Promise<void> {
      stateStore.delete(privateStateId);
    },

    async clear(): Promise<void> {
      stateStore.clear();
    },

    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeyStore.set(address, signingKey);
    },

    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeyStore.get(address) ?? null;
    },

    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeyStore.delete(address);
    },

    async clearSigningKeys(): Promise<void> {
      signingKeyStore.clear();
    },
  };
}
