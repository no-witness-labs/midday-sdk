# @no-witness-labs/midday-sdk

## 0.2.11

### Patch Changes

- 42cc7e7: Add example projects, dockerized faucet/fee-relay, and devnet infrastructure

  - Add example projects: counter, browser-lace, effect-di, devnet-testing
  - Add dockerized faucet server for funding wallets on local devnet
  - Add dockerized fee relay server with browser-lace toggle
  - Add HTTP ZK config provider
  - Update CI to build example projects

## 0.2.10

### Patch Changes

- 9925369: Add example projects, dockerized faucet/fee-relay, and devnet infrastructure

  - Add example projects: counter, browser-lace, effect-di, devnet-testing
  - Add dockerized faucet server for funding wallets on local devnet
  - Add dockerized fee relay server with browser-lace toggle
  - Add HTTP ZK config provider
  - Update CI to build example projects

## 0.2.9

### Patch Changes

- eb97dec: Add resource cleanup APIs to prevent leaked WebSocket connections

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

## 0.2.8

### Patch Changes

- 63c9a5c: Add compact-runtime as peerDependency

  User-compiled Compact contracts import `@midnight-ntwrk/compact-runtime` directly.
  With pnpm's strict isolation, this must be declared as a peerDependency so users
  know to install it alongside the SDK.

## 0.2.7

### Patch Changes

- 9c15c78: Upgrade to v7 Midnight devnet stack

  - Docker: node 0.20.1, indexer 3.0.0, proof-server 7.0.0
  - NPM: compact-runtime 0.14.0, ledger-v7 7.0.0, midnight-js-\* 3.0.0
  - Compact: compactc v0.28.0, language_version 0.20
  - Breaking: deployContract/joinContract require CompiledContract.make() wrapper

## 0.2.6

### Patch Changes

- 122643f: Add type-safe contract inference

  Contract types are now automatically inferred from your Compact module:

  ```typescript
  import * as CounterContract from "./contracts/counter/contract";

  const contract = await client.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath("./contracts/counter"),
  });

  // ledgerState() returns typed Ledger - no cast needed
  const state = await contract.ledgerState();
  console.log(state.counter); // bigint

  // call() autocompletes circuit names
  await contract.call("increment"); // 'increment' | 'decrement'
  ```

  New type utilities:

  - `InferLedger<M>` - extract ledger type from module
  - `InferCircuits<M>` - extract circuit names as union type

## 0.2.5

### Patch Changes

- 24bfb2d: Restructure SDK to namespace-only exports for cleaner API surface.

  All exports are now accessed via namespaces:

  ```typescript
  import * as Midday from '@no-witness-labs/midday-sdk';

  Midday.Client.create({ ... });
  Midday.PrivateState.inMemoryPrivateStateProvider();
  Midday.Hash.bytes32(value);
  ```

  New modules: `Hash`, `ZkConfig`, `PrivateState`, `Runtime`, `Utils`, `BrowserWallet`

## 0.2.4

### Patch Changes

- 79033fc: Add comprehensive E2E testing infrastructure

  - Add E2E test suite for contract deployment lifecycle
  - Add counter contract for testing with Compact source and compiled artifacts
  - Add waitForIndexerSynced utility for genesis dust availability
  - Add Docker healthchecks matching docker-compose configuration
  - Add GitHub Actions workflow for E2E tests
  - Fix SigningKey type in IndexedDBPrivateStateProvider
  - Pin onchain-runtime-v1 to 1.0.0-alpha.5 for compatibility

## 0.2.3

### Patch Changes

- 58d6f11: Migrate logging to Effect's built-in Logger layer

  - Replace custom `Logger` interface with `Effect.logDebug` for SDK internals
  - Add `SdkLogger` module with pre-configured layers (`pretty`, `json`, `logFmt`, `none`)
  - Add `runEffectWithLogging(effect, logging)` helper for Promise API
  - Remove `LoggerService` from Config (use Effect Logger layers instead)

  **Breaking:** SDK logs are now debug-level and hidden by default.

  To see SDK debug logs:

  ```typescript
  import { Effect } from "effect";
  import {
    ClientService,
    ClientLive,
    SdkLogger,
  } from "@no-witness-labs/midday-sdk";

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
  import { Client } from "@no-witness-labs/midday-sdk";

  const client = await Client.create({
    logging: true,
    seed: "...",
    zkConfigProvider,
    privateStateProvider,
  });
  ```

## 0.2.2

### Patch Changes

- 2ec54ed: Add `MidnightClientService` and `Client.layer(config)` for Effect DI

  - Add `MidnightClientService` Context.Tag for pre-initialized client injection
  - Add `Client.layer(config)` to create a Layer with pre-configured client (matches `Cluster.layer(config)` pattern)
  - Add `Client.layerFromWallet(connection, config)` for browser wallet integration
  - Rename `Client.layer()` → `Client.services()` to clarify it provides factory services

## 0.2.1

### Patch Changes

- f329952: Add Effect TS integration with browser wallet support

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
  import * as Midday from "@no-witness-labs/midday-sdk";

  const connection = await Midday.connectWallet("testnet");
  const client = await Midday.Client.fromWallet(connection, {
    zkConfigProvider: new Midday.HttpZkConfigProvider(
      "https://cdn.example.com/zk"
    ),
    privateStateProvider: Midday.indexedDBPrivateStateProvider({
      privateStateStoreName: "my-app",
    }),
  });

  // Effect-based usage
  const program = Effect.gen(function* () {
    const client = yield* Midday.Client.effect.create(config);
    const builder = yield* Midday.Client.effect.contractFrom(client, {
      module,
    });
    const contract = yield* Midday.ContractBuilder.effect.deploy(builder);
    return yield* Midday.Contract.effect.call(contract, "increment");
  });
  ```

## 0.2.0

### Minor Changes

- 32b87ff: Add devnet module for local development and testing

  **New Features:**

  - `Cluster` module with instance-based API for managing devnet lifecycle
  - `Container` module for Docker container operations
  - `Health` module for service health checks (node, indexer, proof server)
  - `Images` module for Docker image management
  - `Config` module with sensible defaults for Midnight Network stack
  - Tagged error types (`ClusterError`, `ContainerError`, `HealthCheckError`)
  - Service tags for dependency injection (`ClusterService`, `ContainerService`, `HealthService`)

  **Usage:**

  ```typescript
  import { Cluster } from "@no-witness-labs/midday-sdk/devnet";

  const cluster = await Cluster.make();
  await cluster.start();
  console.log(cluster.networkConfig);
  await cluster.remove();
  ```

## 0.1.2

### Patch Changes

- 816ea03: address derivation

## 0.1.1

### Patch Changes

- 60510c3: midday sdk the first verion
