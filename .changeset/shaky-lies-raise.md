---
"@no-witness-labs/midday-sdk": patch
---

Add Effect TS integration with browser wallet support

**New Features:**

- Dual API pattern: Promise-based and Effect-based for all modules
- Browser wallet connector for Lace wallet integration via DAppConnectorAPI v4
- `HttpZkConfigProvider` module for loading ZK artifacts from HTTP endpoints
- `IndexedDBPrivateStateProvider` for browser-based private state persistence
- `inMemoryPrivateStateProvider` for testing/Node.js environments
- Effect runtime utilities (`runEffect`, `runEffectPromise`) with clean stack traces
- Service tags for dependency injection (`ClientService`, `WalletService`, `ProvidersService`, etc.)
- Tagged error types colocated with modules (`ClientError`, `WalletError`, `ProviderError`, etc.)
- Utility modules: `hex`, `address`, `coin` helpers

**Usage:**

```typescript
// Browser with Lace wallet (Promise-based)
import * as Midday from '@no-witness-labs/midday-sdk';

const connection = await Midday.connectWallet('testnet');
const client = await Midday.Client.fromWallet(connection, {
  zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
});

// Effect-based usage
const program = Effect.gen(function* () {
  const client = yield* Midday.Client.effect.create(config);
  const builder = yield* Midday.Client.effect.contractFrom(client, { module });
  const contract = yield* Midday.ContractBuilder.effect.deploy(builder);
  return yield* Midday.Contract.effect.call(contract, 'increment');
});
```
