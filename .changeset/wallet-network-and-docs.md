---
'@no-witness-labs/midday-sdk': minor
---

`ConnectedWallet` now carries `networkId` (and `networkConfig` for seed wallets), and `Client.create({ wallet })` uses the wallet's network instead of defaulting to `local`: the documented browser flow (`Wallet.fromBrowser('preview')` then `Client.create({ wallet, ... })`) previously produced a client pointed at local endpoints. A `network` or `networkConfig` that disagrees with the wallet is rejected, and a wallet on a network without a built-in preset (Preprod) asks for `Config.blockfrost(...)`.

Docs: README gains a supported-networks and pinned-versions matrix, the consumer `onchain-runtime-v3` requirement, and an "Upgrading to 0.7" section; the installation page states Node 22 and the `compact-runtime` peer dependency; the services table no longer lists the removed `ClientService`/`ClientLive`; `@since` tags that named unreleased versions now carry the version recorded in the changelog or were dropped.
