/**
 * Private state providers for contract state management.
 *
 * @since 0.3.0
 * @module
 */

export {
  indexedDBPrivateStateProvider,
  inMemoryPrivateStateProvider,
  makeIndexedDB,
  makeInMemory,
  get,
  set,
  remove,
  clear,
  effect,
  PrivateStateService,
  PrivateStateLive,
  PrivateStateProviderService,
  type IndexedDBPrivateStateConfig,
  type PrivateStateProviderData,
  type PrivateStateServiceImpl,
} from './providers/IndexedDBPrivateStateProvider.js';

export { PrivateStateError } from './providers/errors.js';
