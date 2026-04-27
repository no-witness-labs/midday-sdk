---
"@no-witness-labs/midday-sdk": minor
---

Bump Midnight wallet-sdk packages to the 2026-04-23 release batch:

- `wallet-sdk-facade` 3.0.0 → 4.0.0
- `wallet-sdk-dust-wallet` 3.0.0 → 4.0.0
- `wallet-sdk-shielded` 2.1.0 → 3.0.0
- `wallet-sdk-unshielded-wallet` 2.1.0 → 3.0.0
- `wallet-sdk-address-format` 3.1.0 → 3.1.1
- `wallet-sdk-hd` 3.0.1 → 3.0.2
- adds `wallet-sdk-abstractions` 2.1.0 (now hosts `InMemoryTransactionHistoryStorage`)

Includes the upstream deterministic-segment-id fix in the dust-wallet balancer (replaces `Transaction.fromPartsRandomized` with collision-free segment selection), retiring the previous segment_id collision / balanceTx hang workaround.

`InMemoryTransactionHistoryStorage` now requires a schema argument; the SDK passes `WalletEntrySchema` + `mergeWalletEntries` from `wallet-sdk-facade` at every facade init site.
