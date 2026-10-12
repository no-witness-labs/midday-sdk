---
'@no-witness-labs/midday-sdk': minor
---

`ConnectedWallet.address` is replaced by `addresses: { shielded, unshielded }`. The single `address` meant different things by wallet source — the unshielded address for seed wallets and the shielded one for browser wallets — so code written against one source silently sent funds to the wrong pool on the other. Both addresses are now available for both sources (the browser wallet's unshielded address is read from the connector at connect time). `Wallet.deriveAddress` is renamed `deriveUnshieldedAddress` to say which one it derives. Use `addresses.unshielded` as the `accountId` for the persistent private-state provider.
