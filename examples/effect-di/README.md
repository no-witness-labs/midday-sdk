# Effect Dependency Injection Example

Complete working example demonstrating **pure layer composition** with automatic resource management.
Everything is a single Effect program — cluster and client are both managed resources with
automatic LIFO cleanup (client closes before cluster removes).

## What This Example Does

1. Composes layers: `Cluster.managedLayer()` → `Client.effect.createScoped()` → `AppLayer`
2. Runs an Effect program that accesses the client via `MiddayClientService`
3. Loads, deploys, and interacts with the counter contract
4. All cleanup is automatic — no `try/finally`, no manual `close()`

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
timestamp=... level=INFO fiber=#0 message="=== Effect DI Example ==="
timestamp=... level=INFO fiber=#0 message="Devnet ready: ws://localhost:9944"
timestamp=... level=INFO fiber=#0 message="Client accessed via MiddayClientService (network: undeployed)"
timestamp=... level=INFO fiber=#0 message="Loading counter contract..."
timestamp=... level=INFO fiber=#0 message="Contract loaded"
timestamp=... level=INFO fiber=#0 message="Deploying contract..."
timestamp=... level=INFO fiber=#0 message="Contract deployed at: abc123..."
timestamp=... level=INFO fiber=#0 message="Calling increment()..."
timestamp=... level=INFO fiber=#0 message="TX Hash: def456... (block: 1)"
timestamp=... level=INFO fiber=#0 message="Reading ledger state..."
timestamp=... level=INFO fiber=#0 message="Counter value: 1"
timestamp=... level=INFO fiber=#0 message="=== Effect DI Example complete ==="

Done! Counter: 1
```

## Code Walkthrough

### 1. Define the Program (Pure Effect)

The program has **zero lifecycle code** — it only depends on `MiddayClientService`:

```typescript
const program = Effect.gen(function* () {
  yield* Effect.log('=== Effect DI Example ===');
  const client = yield* Midday.Client.MiddayClientService;

  const contract = yield* client.effect.loadContract({ module, zkConfig, privateStateId: 'effect-di-example' });
  const deployed = yield* contract.effect.deploy();
  const result = yield* deployed.effect.actions.increment();
  const state = yield* deployed.effect.ledgerState();

  yield* Effect.log(`Counter value: ${state.counter}`);
  return { address: deployed.address, counter: state.counter };
});
```

### 2. Compose Layers

```typescript
// Managed devnet cluster (auto-starts, auto-removes)
const ClusterLayer = Cluster.managedLayer({ clusterName: 'effect-di-example' });

// Derives a MiddayClient from ClusterService (auto-closes when scope ends)
const ClientFromCluster = Layer.scoped(
  Midday.Client.MiddayClientService,
  Effect.gen(function* () {
    const cluster = yield* ClusterService;
    return yield* Midday.Client.effect.createScoped({
      seed: Midday.Config.DEV_WALLET_SEED,
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
  }),
);

// Full app layer — Cluster feeds into Client
const AppLayer = ClientFromCluster.pipe(Layer.provide(ClusterLayer));
```

### 3. Run

```typescript
Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```

## Key Concepts

- **`Cluster.managedLayer()`** — creates a `Layer` that provides `ClusterService`. The cluster is started on layer creation and removed on layer release.
- **`Client.effect.createScoped()`** — creates a client as a scoped Effect resource. The client is automatically closed when the scope ends.
- **`Layer.scoped()`** — builds a layer from a scoped Effect, enabling automatic LIFO cleanup.
- **Layer composition** — `ClientFromCluster` depends on `ClusterService`, which `ClusterLayer` provides. `Layer.provide()` wires them together.

## Benefits of Layer Composition

1. **Zero lifecycle code** — no `try/finally`, no manual `close()` or `remove()`
2. **LIFO cleanup** — client closes before cluster removes (correct order, automatically)
3. **Testability** — swap `AppLayer` with a mock layer in tests
4. **Composability** — add more layers (logging, metrics) without changing the program
5. **Type Safety** — Effect tracks service requirements in types

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
