---
"@no-witness-labs/midday-sdk": minor
---

Ledger 9: move to midnight-js 5.0.0, wallet SDK 2.0.0 (`@midnightntwrk/wallet-sdk-facade` 5.0.0), `@midnightntwrk/ledger-v9` 1.0.0 and compact-runtime 0.21.0. Contracts must be compiled with Compact 0.36.0. The devnet runs node 2.1.101, indexer 4.4.101 and proof server 9.0.1.

Breaking: `Contract.create` requires `networkId`; private state is reached through `forContract(address)` and `PrivateState.boundToContract` is removed; wallet providers take ledger 9 transaction handles; `Wallet.balanceAndFinalize` returns bytes. Browser wallet balancing errors no longer name a specific wallet. See "Upgrading to 0.8" in the README.
