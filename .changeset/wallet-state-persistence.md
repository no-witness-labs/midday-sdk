---
'@no-witness-labs/midday-sdk': minor
---

Seed wallets can persist and resume their sync state: `wallet.serializeState()` exports a versioned snapshot (network ID, format version, wallet SDK package versions, shielded/unshielded/DUST state and transaction history), and `Wallet.fromSeed(seed, config, { restoreState })` resumes from it instead of syncing from genesis. Invalid, corrupt, foreign-network or foreign-seed snapshots fail with the new `WalletSnapshotError` rather than silently resyncing. `WalletContext` now carries `txHistoryStorage`. Snapshots contain private wallet data; store them encrypted.
