---
"@no-witness-labs/midday-sdk": patch
---

Add resource cleanup APIs to prevent leaked WebSocket connections

- Add `client.close()` to gracefully stop wallet sync and release connections
- Add `Client.withClient()` bracket pattern for guaranteed cleanup
- Add `Symbol.asyncDispose` support for `await using` syntax
- Add `effect.createScoped()` and `effect.withClient()` for Effect users
- Fix noisy `Wallet.Sync` errors on shutdown by closing wallets before teardown
