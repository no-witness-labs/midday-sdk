---
"@no-witness-labs/midday-sdk": patch
---

Migrate logging to Effect's built-in Logger layer

- Replace custom `Logger` interface with `Effect.logDebug` for SDK internals
- Add `SdkLogger` module with pre-configured layers (`pretty`, `json`, `logFmt`, `none`)
- Add `runEffectWithLogging(effect, logging)` helper for Promise API
- Remove `LoggerService` from Config (use Effect Logger layers instead)

**Breaking:** SDK logs are now debug-level and hidden by default.

To see SDK debug logs:

```typescript
import { Effect } from 'effect';
import { ClientService, ClientLive, SdkLogger } from '@no-witness-labs/midday-sdk';

const program = Effect.gen(function* () {
  const clientService = yield* ClientService;
  const client = yield* clientService.create(config);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(ClientLive),
    Effect.provide(SdkLogger.pretty),
    Effect.provide(SdkLogger.withDebug)
  )
);
```

Or with Promise API:

```typescript
import { Client } from '@no-witness-labs/midday-sdk';

const client = await Client.create({
  logging: true,
  seed: '...',
  zkConfigProvider,
  privateStateProvider,
});
```
