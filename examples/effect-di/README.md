# Effect Dependency Injection Example

Complete working example demonstrating the Effect DI pattern with contract operations.

## What This Example Does

1. Spins up a local devnet (Docker containers)
2. Creates a `ClientLayer` for dependency injection
3. Runs an Effect program that:
   - Accesses client via `MiddayClientService`
   - Loads and deploys the counter contract
   - Calls `increment()` and reads state
4. Cleans up devnet on exit

## Prerequisites

- [Docker](https://www.docker.com/) installed and running
- For OrbStack users: Set `DOCKER_HOST=unix:///var/run/docker.sock`
- Basic familiarity with [Effect](https://effect.website/)

## Running

```bash
# Standard Docker
pnpm start

# OrbStack users
DOCKER_HOST=unix:///var/run/docker.sock pnpm start
```

## Expected Output

```
Starting local devnet...

Devnet ready: ws://localhost:9944

=== Effect DI Example ===

1. Client accessed via MiddayClientService
   Network: undeployed

2. Loading counter contract (Effect API)...
   Contract loaded (state: loaded)

3. Deploying contract (Effect API)...
   Contract deployed!
   Address: abc123...

4. Calling increment() (Effect API)...
   TX Hash: def456...
   Block: 1

5. Reading ledger state (Effect API)...
   Counter value: 1

=== Effect DI Example complete ===

Final result:
  Contract: abc123...
  Counter: 1

Cleaning up devnet...
Done!
```

## Code Walkthrough

### 1. Create Client Layer

```typescript
const ClientLayer = Midday.Client.layer({
  seed: Midday.Config.DEV_WALLET_SEED,
  networkConfig: cluster.networkConfig,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});
```

### 2. Define Effect Program

```typescript
const program = Effect.gen(function* () {
  // Access injected client
  const client = yield* Midday.Client.MiddayClientService;

  // Use Effect API for contract operations
  const loaded = yield* client.effect.loadContract({ module, zkConfig, privateStateId: 'my-id' });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  const state = yield* deployed.effect.ledgerState();

  return state;
});
```

### 3. Provide Layer and Run

```typescript
const result = await Effect.runPromise(
  program.pipe(Effect.provide(ClientLayer))
);
```

## Benefits of Effect DI

1. **Testability**: Mock `ClientLayer` in tests
2. **Composability**: Combine effects without passing dependencies
3. **Type Safety**: Effect tracks service requirements in types
4. **Error Handling**: Typed errors with `Effect.catchTag()`

## Testing with DI

```typescript
const MockClientLayer = Layer.succeed(
  Midday.Client.MiddayClientService,
  mockClient
);

const result = await Effect.runPromise(
  program.pipe(Effect.provide(MockClientLayer))
);
```

## Next Steps

- See [counter](../counter) for Promise API pattern
- See [browser-lace](../browser-lace) for browser integration
