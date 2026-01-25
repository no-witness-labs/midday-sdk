/**
 * IndexedDB-based private state provider for browser environments.
 *
 * Uses browser-level (which wraps IndexedDB) for persistent encrypted storage.
 *
 * @since 0.2.0
 * @module
 */

import { BrowserLevel } from 'browser-level';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

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
 * const privateStateProvider = indexedDBPrivateStateProvider({
 *   privateStateStoreName: 'my-dapp-state',
 *   password: 'user-password',
 * });
 * ```
 */
export function indexedDBPrivateStateProvider(
  config: IndexedDBPrivateStateConfig,
): PrivateStateProvider<string, unknown> {
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

  return {
    async get(privateStateId: string): Promise<unknown | null> {
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

    async set(privateStateId: string, state: unknown): Promise<void> {
      const json = JSON.stringify(state);
      const bytes = new TextEncoder().encode(json);
      const encrypted = encrypt(bytes);
      await stateDb.put(privateStateId, encrypted);
    },

    async remove(privateStateId: string): Promise<void> {
      try {
        await stateDb.del(privateStateId);
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'LEVEL_NOT_FOUND') {
          throw error;
        }
      }
    },

    async clear(): Promise<void> {
      await stateDb.clear();
    },

    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      const serialized = serializeSigningKey(signingKey);
      const encrypted = encrypt(serialized);
      await signingKeyDb.put(address, encrypted);
    },

    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
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

    async removeSigningKey(address: ContractAddress): Promise<void> {
      try {
        await signingKeyDb.del(address);
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'LEVEL_NOT_FOUND') {
          throw error;
        }
      }
    },

    async clearSigningKeys(): Promise<void> {
      await signingKeyDb.clear();
    },
  };
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
 * // State will be lost when page refreshes
 * ```
 */
export function inMemoryPrivateStateProvider(): PrivateStateProvider<string, unknown> {
  const stateStore = new Map<string, unknown>();
  const signingKeyStore = new Map<string, SigningKey>();

  return {
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
