/**
 * Private state providers for contract private state and signing keys.
 *
 * Both providers implement midnight-js's `PrivateStateProvider` and scope
 * state by contract: midnight-js calls `setContractAddress(address)` before
 * every deploy, call and join, and state is stored under
 * `${contractAddress}:${privateStateId}`, so two contracts that share a
 * provider cannot read or overwrite each other's state.
 *
 * - {@link indexedDBPrivateStateProvider}: persistent and encrypted
 *   (midnight-js `levelPrivateStateProvider`: AES-GCM under a PBKDF2-derived
 *   key, scoped per account). IndexedDB in browsers, LevelDB on disk in Node.
 * - {@link inMemoryPrivateStateProvider}: ephemeral, for tests and scripts.
 *
 * @example
 * ```typescript
 * import * as Midday from '@no-witness-labs/midday-sdk';
 *
 * const psp = Midday.PrivateState.indexedDBPrivateStateProvider({
 *   accountId: wallet.address,
 *   password: () => askUserForPassword(), // ≥ 16 characters, kept secret
 * });
 * ```
 *
 * @since 0.3.0
 * @module
 */

import { Context, Data } from 'effect';
import type {
  PrivateStateProvider,
  PrivateStateExport,
  ExportPrivateStatesOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  SigningKeyExport,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
} from '@midnight-ntwrk/midnight-js-types';
import {
  levelPrivateStateProvider,
  type PrivateStoragePasswordProvider,
} from '@midnight-ntwrk/midnight-js-level-private-state-provider';

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

// String aliases so this module does not import compact-runtime.
type ContractAddress = string;
type SigningKey = string;

/**
 * Configuration for {@link indexedDBPrivateStateProvider}.
 *
 * @since 0.2.0
 * @category model
 */
export interface IndexedDBPrivateStateConfig {
  /**
   * Scopes storage to one account so two wallets on one machine never see
   * each other's state. Use the wallet address. Hashed before use.
   */
  accountId: string;
  /**
   * Encryption password, or a function returning it (asked for lazily, on the
   * first access). At least 16 characters, no long runs of one character.
   * Never derive it from public data such as keys or addresses.
   */
  password: string | PrivateStoragePasswordProvider;
  /** Store name for private state (default: midnight-js's `private-states`). */
  privateStateStoreName?: string;
  /** Store name for contract signing keys (default: midnight-js's `signing-keys`). */
  signingKeyStoreName?: string;
  /** Database name: the IndexedDB database in browsers, a directory in Node (default: `midnight-level-db`). */
  dbName?: string;
}

const NO_ADDRESS = 'Contract address not set. Call setContractAddress() before accessing private state.';

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
export function indexedDBPrivateStateProvider(config: IndexedDBPrivateStateConfig): PrivateStateProvider<string, unknown> {
  const { accountId, password, privateStateStoreName, signingKeyStoreName, dbName } = config;
  if (!accountId?.trim()) {
    throw new PrivateStateError({ cause: undefined, message: 'indexedDBPrivateStateProvider: accountId is required (use the wallet address)' });
  }
  if (!password) {
    throw new PrivateStateError({ cause: undefined, message: 'indexedDBPrivateStateProvider: password is required (≥ 16 characters, kept secret)' });
  }
  return levelPrivateStateProvider<string, unknown>({
    accountId,
    privateStoragePasswordProvider: typeof password === 'function' ? password : () => password,
    ...(privateStateStoreName ? { privateStateStoreName } : {}),
    ...(signingKeyStoreName ? { signingKeyStoreName } : {}),
    ...(dbName ? { midnightDbName: dbName } : {}),
  });
}

/**
 * Ephemeral private state for tests and one-off scripts. Same contract
 * scoping as the persistent provider; nothing survives the process.
 *
 * @since 0.2.0
 * @category constructors
 */
export function inMemoryPrivateStateProvider(): PrivateStateProvider<string, unknown> {
  const states = new Map<string, unknown>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let contractAddress: ContractAddress | null = null;

  // Composed synchronously at the start of each call, so a concurrent
  // setContractAddress on a shared provider cannot redirect an access in flight.
  const scopedKey = (privateStateId: string): string => {
    if (contractAddress === null) throw new PrivateStateError({ cause: undefined, message: NO_ADDRESS });
    return `${contractAddress}:${privateStateId}`;
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    async get(privateStateId: string): Promise<unknown | null> {
      return states.get(scopedKey(privateStateId)) ?? null;
    },
    async set(privateStateId: string, state: unknown): Promise<void> {
      states.set(scopedKey(privateStateId), state);
    },
    async remove(privateStateId: string): Promise<void> {
      states.delete(scopedKey(privateStateId));
    },
    async clear(): Promise<void> {
      if (contractAddress === null) throw new PrivateStateError({ cause: undefined, message: NO_ADDRESS });
      states.clear();
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address, signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
    },
    async clearSigningKeys(): Promise<void> {
      signingKeys.clear();
    },
    exportPrivateStates: unsupported('exportPrivateStates') as (o?: ExportPrivateStatesOptions) => Promise<PrivateStateExport>,
    importPrivateStates: unsupported('importPrivateStates') as (
      e: PrivateStateExport,
      o?: ImportPrivateStatesOptions,
    ) => Promise<ImportPrivateStatesResult>,
    exportSigningKeys: unsupported('exportSigningKeys') as (o?: ExportSigningKeysOptions) => Promise<SigningKeyExport>,
    importSigningKeys: unsupported('importSigningKeys') as (
      e: SigningKeyExport,
      o?: ImportSigningKeysOptions,
    ) => Promise<ImportSigningKeysResult>,
  };
}

/**
 * A view of `provider` fixed to one contract. midnight-js sets the address on
 * the shared provider right before each access; with several contracts on one
 * provider those two steps can interleave. The view re-asserts its own address
 * synchronously before every access and refuses a different one.
 *
 * @since 0.7.0
 * @category combinators
 */
export function boundToContract(
  provider: PrivateStateProvider<string, unknown>,
  address: ContractAddress,
): PrivateStateProvider<string, unknown> {
  const bind = (): void => provider.setContractAddress(address);
  return {
    ...provider,
    setContractAddress(requested: ContractAddress): void {
      if (requested !== address) {
        throw new PrivateStateError({
          cause: undefined,
          message: `Private state provider is bound to contract ${address}; refusing to switch to ${requested}`,
        });
      }
      bind();
    },
    get: (id) => { bind(); return provider.get(id); },
    set: (id, state) => { bind(); return provider.set(id, state); },
    remove: (id) => { bind(); return provider.remove(id); },
    clear: () => { bind(); return provider.clear(); },
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
