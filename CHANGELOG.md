# @no-witness-labs/midday-sdk

## 0.5.0

### Minor Changes

- Add `ConnectedWallet.shield(amount)` and `ConnectedWallet.unshield(amount)` helpers for moving NIGHT (or any token) between the shielded and unshielded pools of the same wallet.

  Works on both seed and browser (Lace) backends. Required before interacting with shielded contracts (e.g. `receiveShielded`) when the wallet was funded via a faucet — preview/preprod faucets only deposit to the unshielded address, so users must self-shield before making shielded contract calls.

  ```ts
  const wallet = await Midday.Wallet.fromBrowser("preview");
  const bal = await wallet.getBalance();
  if (!bal.shielded[Midday.Utils.getNativeTokenColor()]) {
    await wallet.shield(1_000_000_000n); // 1 tNIGHT
  }
  ```

  Browser backend uses the Lace DApp Connector's `makeTransfer` (added to `ConnectedAPI` interface). Lace ≥ Midnight DApp Connector 4.0 is required; an explicit error is thrown on older versions.

### Patch Changes

- 545faae: Skip HTTP fetch for built-in ZK circuits (midnight/zswap/\*) in HttpZkConfigProvider to avoid noisy 404s in browser console

## 0.4.2

### Patch Changes

- Add skipFinalization option to DeployOptions

  - When `skipFinalization: true`, deploy returns immediately after tx submission
  - Contract handle is fully functional once the deploy tx lands on-chain
  - Useful for browser dapps where indexer finalization watch may fail

## 0.4.1

### Patch Changes

- Split deploy flow to show contract address before finalization

  - Use createUnprovenDeployTx + submitTxAsync instead of deployContract
  - onSubmit callback now fires with both address and txId after submission
  - Fixes browser dapps not seeing contract address until finalization completes

## 0.4.0

### Minor Changes

- 4d7b4b0: Upgrade all @midnight-ntwrk dependencies to latest stable releases

  - midnight-js-\* 3.1.0 → 4.0.2
  - wallet-sdk-facade 2.0.0-rc.3 → 3.0.0
  - wallet-sdk-dust-wallet 2.0.0-rc.5 → 3.0.0
  - wallet-sdk-shielded 2.0.0-rc.4 → 2.1.0
  - wallet-sdk-unshielded-wallet 2.0.0-rc.4 → 2.1.0
  - wallet-sdk-address-format 3.0.0 → 3.1.0
  - wallet-sdk-hd 3.0.0 → 3.0.1
  - compact-js 2.4.2 → 2.5.0
  - compact-runtime 0.14.0 → 0.15.0
  - ledger-v7 7.0.2 → ledger-v8 8.0.3
  - Add PrivateStateProvider export/import signing keys stubs
  - Add provider instrumentation logging for deploy/join lifecycle
  - Add CAIP-372 wallet discovery for Lace v2.36.0+

## 0.3.2

### Patch Changes

- 8b46361: fix: workaround wallet-sdk intent signing bug

## 0.3.1

### Patch Changes

- fa345fb: fix: use dynamic import instead of require for browser compatibility

## 0.3.0

### Minor Changes

- d883ee1: Simplify Client module and improve API ergonomics

  ### Breaking Changes

  - Removed deprecated exports: `ClientService`, `ClientServiceImpl`, `ClientLive`, `services()`, `ClientData`, `ContractState`, `Contract` (legacy union type), `ContractData`, `createContractHandle`
  - Removed deprecated Promise wrappers from Wallet: `init()`, `waitForSync()`, `close()`, `providers()`, `connectWallet()`, `disconnectWallet()`
  - Removed `wallet` and `relayerWallet` properties from `MiddayClient` handle
  - `layerFromWallet` no longer accepts `zkConfigProvider` in its config

  ### New Features

  - **`FeeRelay` module** — centralised fee relay logic (seed-based and HTTP-based) extracted from Client
  - **`DeployedContractFor<M>`** — convenience type alias for fully-typed deployed contracts
  - **`LoadedContractFor<M>`** — convenience type alias for fully-typed loaded contracts
  - **`FromWalletConfig`** — dedicated config interface for `Client.fromWallet()`
  - **`effect.fromWalletScoped`** — scoped variant for browser wallet connections
  - **Configurable `txTtlMs`** — transaction TTL now configurable via `ClientConfig`, `FromWalletConfig`, and fee relay options (default: 30 minutes via `Config.DEFAULT_TX_TTL_MS`)

  ### Improvements

  - Client internals simplified: removed `ClientData` indirection, `closeClientEffect`, and duplicated provider assembly logic
  - Scoped variants (`createScoped`, `fromWalletScoped`) now reuse the Effect path via `acquireRelease` instead of duplicating logic
  - `Effect.orDie` replaces `Effect.ignore`/`Effect.catchAll` in acquireRelease release functions — close failures are now visible defects
  - `layerFromWallet` reuses `effect.fromWalletScoped` instead of duplicating the pipeline
  - All internal module imports follow Effect-style `import * as Module` pattern with qualified type access
  - All tests and JSDoc examples updated to use typed `contract.actions.*()` instead of untyped `contract.call()`

## 0.2.14

### Patch Changes

- 565fa70: ### Flat Module Structure

  Restructured the SDK from nested folders into 9 flat modules: `Client`, `Contract`, `Config`, `Wallet`, `PrivateState`, `ZkConfig`, `Hash`, `Runtime`, `Utils`. All imports now use `Midday.Module.method()` pattern.

  ### Contract Split & Typed Actions

  - Split contract into two-handle pattern: `LoadedContract` (after load) → `DeployedContract` (after deploy/join)
  - Added typed `deployed.actions.increment()` proxy (no more untyped `call()` for common operations)
  - Added `ReadonlyContract` for state queries without wallet/proofs

  ### Event & Subscription System

  - `deployed.onStateChange(callback)` — callback-based state watching
  - `deployed.watchState()` — async iterator for state changes
  - `deployed.effect.watchState()` — Effect Stream variant

  ### Transaction Lifecycle

  - `client.waitForTx(txHash, { timeout })` — wait for transaction finalization
  - `deployed.deploy({ timeout })` / `deployed.join(address, { timeout })` — deploy/join with timeout
  - `TxTimeoutError` with `txHash` or `operation` for debugging

  ### Scoped Resource Management (Effect)

  - `Client.layer()` now uses `Layer.scoped` — client auto-closes when scope ends
  - `Client.layerFromWallet()` now uses `Layer.scoped` with `acquireRelease`
  - `Client.effect.createScoped()` — creates a scoped client Effect resource
  - `Cluster.effect.makeScoped()` — creates a scoped devnet cluster (acquireRelease: start/remove)
  - `Cluster.managedLayer()` — fully managed devnet layer (auto-starts/removes)

  ### Wallet Enhancements

  - `ConnectedWallet.coinPublicKey` — public key for coin operations
  - `ConnectedWallet.encryptionPublicKey` — public key for encryption
  - `WalletBalance.dust` is now `DustBalance { balance: bigint; cap: bigint }` (breaking)
  - `Wallet.fromBrowser()` uses v4 API (`getShieldedAddresses`)

  ### Fee Relay Fix

  - Fixed `Client.create({ wallet, feeRelay: { url } })` silently ignoring the fee relay config when using a pre-created `ConnectedWallet` — browser wallets can now use the fee relay for transaction balancing

  ### DevNet Tooling

  - `Faucet.startDocker()` / `Faucet.startServer()` — fund wallets on local devnet
  - `FeeRelay.startDocker()` / `FeeRelay.startServer()` — genesis wallet pays fees for browser wallets
  - Auto-builds Docker images on first use

  ### Examples

  - `counter` — Promise API end-to-end (deploy, increment, read state)
  - `effect-di` — Pure layer composition with `Cluster.managedLayer()` and `Client.effect.createScoped()`
  - `browser-lace` — Lace wallet integration with fee relay and faucet
  - `devnet-testing` — DevNet cluster management with faucet and fee relay servers

## 0.2.13

### Patch Changes

- d6712f6: fix: replace require() with await import() in Client.ts to prevent bundlers from statically following import chains into WASM/Node.js packages

## 0.2.12

### Patch Changes

- 336dbbe: Auto-build faucet/fee-relay Docker images inside SDK

  - Add `Images.build()` for building Docker images from local context
  - Auto-build in `Faucet.startDocker()` and `FeeRelay.startDocker()` when image is missing
  - Ship `docker/` build contexts in npm package
  - Remove `ensureDockerImage()` boilerplate from examples and template

- a9b0411: fix: replace require() with await import() in Client.ts to prevent bundlers from statically following import chains into WASM/Node.js packages

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
