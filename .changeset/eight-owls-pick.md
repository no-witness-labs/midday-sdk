---
"@no-witness-labs/midday-sdk": patch
---

Add `MidnightClientService` and `Client.layer(config)` for Effect DI

- Add `MidnightClientService` Context.Tag for pre-initialized client injection
- Add `Client.layer(config)` to create a Layer with pre-configured client (matches `Cluster.layer(config)` pattern)
- Add `Client.layerFromWallet(connection, config)` for browser wallet integration
- Rename `Client.layer()` → `Client.services()` to clarify it provides factory services
