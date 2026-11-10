/**
 * Private state providers for contract private state and signing keys.
 *
 * Both providers implement midnight-js's `PrivateStateProvider` and scope
 * state by contract: private states are reached through
 * `forContract(address)`, so two contracts that share a provider cannot read
 * or overwrite each other's state.
 *
 * - {@link persistentPrivateStateProvider}: persistent and encrypted
 *   (midnight-js `levelPrivateStateProvider`: AES-GCM under a PBKDF2-derived
 *   key, scoped per account). IndexedDB in browsers, LevelDB on disk in Node.
 * - {@link inMemoryPrivateStateProvider}: ephemeral, for tests and scripts.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const psp = Midday.PrivateState.persistentPrivateStateProvider({
 *   accountId: wallet.addresses.unshielded,
 *   password: () => askUserForPassword(), // ≥ 16 characters, kept secret
 * });
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Context, Data } from 'effect';
import type {
  ContractPrivateStates,
  PrivateStateProvider,
  SigningKeyExport,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
} from '@midnight-ntwrk/midnight-js-types';
import {
  levelPrivateStateProvider,
  type PrivateStoragePasswordProvider,
} from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { sha256 } from '@noble/hashes/sha2.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error from private state operations.
 *
 * @since 0.3.0
 * @category errors
 */
export class PrivateStateError extends Data.TaggedError('PrivateStateError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

// =============================================================================
// Types
// =============================================================================

type ContractAddress = string;
type SigningKey = Parameters<PrivateStateProvider['setSigningKey']>[1];

/**
 * Configuration for {@link persistentPrivateStateProvider}.
 *
 * @since 0.2.0
 * @category model
 */
export interface PersistentPrivateStateConfig {
  /**
   * Scopes storage to one account so two wallets on one machine never see
   * each other's state. Use the wallet address. Hashed before use.
   */
  accountId: string;
  /**
   * Encryption password, or a function returning it (asked for lazily, on the
   * first access). midnight-js's policy: at least 16 characters, at least 3 of
   * {lowercase, uppercase, digits, other}, no run of more than 3 identical
   * characters, no ascending or descending run of 4 (`abcd`, `4321`). A string
   * is checked when the provider is created; a function's result is checked on
   * first use. Never derive it from public data such as keys or addresses; to
   * derive one from a secret you already hold, use {@link derivePassword}.
   */
  password: string | PrivateStoragePasswordProvider;
  /** Store name for private state (default: midnight-js's `private-states`). */
  privateStateStoreName?: string;
  /** Store name for contract signing keys (default: midnight-js's `signing-keys`). */
  signingKeyStoreName?: string;
  /** Database name: the IndexedDB database in browsers, a directory in Node (default: `midnight-level-db`). */
  dbName?: string;
}

const unsupported = (what: string) => async (): Promise<never> => {
  throw new PrivateStateError({ cause: undefined, message: `${what} is not supported by the in-memory private state provider` });
};

// =============================================================================
// Providers
// =============================================================================

/**
 * Persistent, encrypted private state: midnight-js's `levelPrivateStateProvider`
 * (IndexedDB in browsers, LevelDB on disk in Node).
 *
 * State is encrypted with AES-GCM under a key derived from `password` with
 * PBKDF2 and stored per account and per contract. The password policy is
 * checked on first use; a wrong password later fails decryption.
 *
 * @since 0.2.0
 * @category constructors
 */
export function persistentPrivateStateProvider(config: PersistentPrivateStateConfig): PrivateStateProvider<string, unknown> {
  const { accountId, password, privateStateStoreName, signingKeyStoreName, dbName } = config;
  if (!accountId?.trim()) {
    throw new PrivateStateError({ cause: undefined, message: 'persistentPrivateStateProvider: accountId is required (use the wallet address)' });
  }
  if (!password) {
    throw new PrivateStateError({ cause: undefined, message: 'persistentPrivateStateProvider: password is required (≥ 16 characters, kept secret)' });
  }
  if (typeof password === 'string') {
    // Fail here, not on the first write: that write can come after a deploy has
    // already been submitted, leaving a contract whose private state was never stored.
    try {
      validatePassword(password);
    } catch (cause) {
      throw new PrivateStateError({
        cause,
        message: `persistentPrivateStateProvider: password rejected: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }
  return levelPrivateStateProvider<string, unknown>({
    accountId,
    privateStoragePasswordProvider: typeof password === 'function' ? password : () => password,
    ...(privateStateStoreName ? { privateStateStoreName } : {}),
    ...(signingKeyStoreName ? { signingKeyStoreName } : {}),
    ...(dbName ? { midnightDbName: dbName } : {}),
  });
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const base64url = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += BASE64URL[(n >> (18 - 6 * c)) & 63];
  }
  return out;
};

/**
 * Derives a storage password from a secret the application already holds (at
 * least 32 bytes), deterministically: the same secret always gives the same
 * password, and the result always satisfies midnight-js's password policy.
 * Hashed outputs are tried in turn until one passes the policy (random strings
 * occasionally contain runs like `aaaa` or `abcd`).
 *
 * @since 0.7.1
 * @category constructors
 */
export function derivePassword(secret: Uint8Array): string {
  if (secret.length < 32) {
    throw new PrivateStateError({ cause: undefined, message: `derivePassword: secret must be at least 32 bytes, got ${secret.length}` });
  }
  const domain = new TextEncoder().encode('midday-sdk/private-state-password/v1');
  for (let counter = 0; counter < 256; counter++) {
    const input = new Uint8Array(domain.length + secret.length + 1);
    input.set(domain);
    input.set(secret, domain.length);
    input[input.length - 1] = counter;
    const candidate = `Md-${base64url(sha256(input))}`;
    try {
      validatePassword(candidate);
      return candidate;
    } catch {
      // try the next counter
    }
  }
  // 256 independent 43-character candidates all failing is not a realistic event.
  throw new PrivateStateError({ cause: undefined, message: 'derivePassword: no policy-compliant password found' });
}

/**
 * Ephemeral private state for tests and one-off scripts. Same contract
 * scoping as the persistent provider; nothing survives the process.
 *
 * @since 0.2.0
 * @category constructors
 */
export function inMemoryPrivateStateProvider(): PrivateStateProvider<string, unknown> {
  // Keyed by lower-case address, as midnight-js compares addresses.
  const states = new Map<ContractAddress, Map<string, unknown>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();

  const forContract = (contractAddress: ContractAddress): ContractPrivateStates<string, unknown> => {
    const key = contractAddress.toLowerCase();
    const scoped = () => {
      let map = states.get(key);
      if (!map) states.set(key, (map = new Map()));
      return map;
    };
    return {
      contractAddress,
      get: async (privateStateId) => scoped().get(privateStateId) ?? null,
      set: async (privateStateId, state) => {
        scoped().set(privateStateId, state);
      },
      remove: async (privateStateId) => {
        scoped().delete(privateStateId);
      },
      clear: async () => {
        states.delete(key);
      },
      exportPrivateStates: unsupported('exportPrivateStates') as ContractPrivateStates['exportPrivateStates'],
      importPrivateStates: unsupported('importPrivateStates') as ContractPrivateStates['importPrivateStates'],
    };
  };

  return {
    forContract,
    async clearAll(): Promise<void> {
      states.clear();
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address.toLowerCase(), signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeys.get(address.toLowerCase()) ?? null;
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address.toLowerCase());
    },
    async clearSigningKeys(): Promise<void> {
      signingKeys.clear();
    },
    exportSigningKeys: unsupported('exportSigningKeys') as (o?: ExportSigningKeysOptions) => Promise<SigningKeyExport>,
    importSigningKeys: unsupported('importSigningKeys') as (
      e: SigningKeyExport,
      o?: ImportSigningKeysOptions,
    ) => Promise<ImportSigningKeysResult>,
  };
}

// =============================================================================
// Effect DI
// =============================================================================

/**
 * Context.Tag for injecting a `PrivateStateProvider`.
 *
 * @since 0.3.0
 * @category effect
 */
export class PrivateStateProviderService extends Context.Tag('PrivateStateProviderService')<
  PrivateStateProviderService,
  PrivateStateProvider
>() {}
