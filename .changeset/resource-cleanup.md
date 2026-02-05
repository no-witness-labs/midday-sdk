---
"@no-witness-labs/midday-sdk": patch
---

Add resource cleanup APIs to prevent leaked WebSocket connections

- Add `client.close()` to gracefully stop wallet sync and release connections
- Add `Client.withClient()` bracket pattern for guaranteed cleanup
- Add `Symbol.asyncDispose` support for `await using` syntax
- Add `effect.createScoped()` and `effect.withClient()` for Effect users

```typescript
// Recommended: withClient bracket — cleanup is automatic
await Midday.Client.withClient(config, async (client) => {
  const contract = await client.loadContract({ path: "./contracts/counter" });
  await contract.deploy();
  await contract.call("increment");
});
// client.close() called automatically, even if body throws

// Manual close — when you need the client to outlive a single callback
const client = await Midday.Client.create(config);
try {
  const contract = await client.loadContract({ path: "./contracts/counter" });
  await contract.deploy();
} finally {
  await client.close(); // stops wallet sync, releases WebSocket connections
}

// Modern: await using (TS 5.2+, Node 22+)
await using client = await Midday.Client.create(config);
// client[Symbol.asyncDispose]() called at block exit

// Effect: scoped resource
const program = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* Midday.Client.effect.createScoped(config);
    const contract = yield* client.effect.loadContract({ module });
    yield* contract.effect.deploy();
  })
);
// wallet stopped when scope closes
```
- Fix noisy `Wallet.Sync` errors on shutdown by closing wallets before teardown
