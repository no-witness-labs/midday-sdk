---
'@no-witness-labs/midday-sdk': minor
---

Naming made consistent across handles, while the API is still cheap to change:

- Deployed contracts: `ledgerState()` → `readState()`, `ledgerStateAt()` → `readStateAt()` (same verbs as the read-only handle); `getState()`/`getStateAt()` → `readStateValue()`/`readStateValueAt()`. Everywhere, the decoded-runtime-value variants `readRawState*`, `onRawStateChange`, `watchRawState` → `readStateValue*`, `onStateValueChange`, `watchStateValue`: what they return is a decoded `StateValue`, and "raw" is reserved for the undecoded state midnight-js 5 introduces.
- `PrivateState.indexedDBPrivateStateProvider` → `persistentPrivateStateProvider` (`PersistentPrivateStateConfig`): it is IndexedDB in browsers and LevelDB on disk in Node.
- Removed `Wallet.fromAddress`, `ReadonlyWallet` and the `MidnightWallet` union. `fromAddress` wrapped an unvalidated string and could neither query balances nor act as a wallet; `Client.createReadonly()` is the wallet-free way to read contracts.
