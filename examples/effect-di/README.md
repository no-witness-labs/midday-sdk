# Effect Dependency Injection Example

Demonstrates using Midday SDK with Effect's dependency injection for testable, composable applications.

## Prerequisites

- Node.js 18+
- pnpm
- Local Midnight devnet running (or testnet access)

## Setup

```bash
# From repository root
pnpm install

# Build the SDK
pnpm build

# Build this example
cd examples/effect-di
pnpm build
```

## Run

```bash
pnpm start
```

## Patterns Demonstrated

### 1. Pre-configured Client Layer

The simplest DI pattern - configure once, use everywhere:

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect } from 'effect';

// Create layer with config
const clientLayer = Midday.Client.layer({
  seed: 'your-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});

// Use in program
const program = Effect.gen(function* () {
  const client = yield* Midday.MidnightClientService;
  // client is automatically available
});

// Run with layer
Effect.runPromise(program.pipe(Effect.provide(clientLayer)));
```

### 2. Service Interfaces

Access services for better testability:

```typescript
const program = Effect.gen(function* () {
  const clientService = yield* Midday.ClientService;
  const contractService = yield* Midday.ContractService;

  const client = yield* clientService.create(config);
  // ...
});

// Provide live implementations
const MainLive = Layer.mergeAll(
  Midday.ClientLive,
  Midday.ContractBuilderLive,
  Midday.ContractLive,
);

Effect.runPromise(program.pipe(Effect.provide(MainLive)));
```

### 3. Testing with Mock Services

Replace services with mocks:

```typescript
const mockClient = { /* ... */ };

const TestClientLive = Layer.succeed(Midday.ClientService, {
  create: () => Effect.succeed(mockClient),
  contractFrom: () => Effect.succeed(mockBuilder),
  // ...
});

// Run tests with mock
Effect.runPromise(program.pipe(Effect.provide(TestClientLive)));
```

### 4. Error Handling

Typed errors with pattern matching:

```typescript
const program = Midday.Client.effect.create(config).pipe(
  Effect.catchTag('ClientError', (error) => {
    console.error('Client error:', error.message);
    return Effect.fail(error);
  }),
);
```

## Available Services

| Service | Layer | Methods |
|---------|-------|---------|
| `ClientService` | `ClientLive` | create, fromWallet, contractFrom, waitForTx |
| `ContractBuilderService` | `ContractBuilderLive` | deploy, join |
| `ContractService` | `ContractLive` | call, state, stateAt, ledgerState, ledgerStateAt |
| `MidnightClientService` | `Client.layer(config)` | Pre-configured client instance |

## Next Steps

- See [counter](../counter) for basic Promise API usage
- See [browser-lace](../browser-lace) for browser integration
- Read [ADR-001](../../website/src/content/docs/architecture/adr-001-dual-api-pattern.mdx) for API design rationale
