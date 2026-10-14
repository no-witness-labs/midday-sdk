---
"@no-witness-labs/midday-sdk": minor
---

Browser wallets prove contract calls themselves through the DApp connector's `getProvingProvider`, so a DApp no longer needs a proof server. Applies to `Client.fromWallet(connection)` and to `Client.create({ wallet })` with a `Wallet.fromBrowser` wallet; pass `proving: 'proof-server'` to keep proving through the proof server. `ConnectedWallet.provingProvider` exposes the wallet's prover. Seed wallets are unchanged.
