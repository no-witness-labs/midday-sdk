# midday-sdk

Developer-friendly SDK for building dapps on Midnight Network.
This project integrates with the Midnight Network.

## Installation

```bash
pnpm add @no-witness-labs/midday-sdk
```

## Quick Start

### Promise API

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from './contracts/counter/contract/index.js';

// Create client
const client = await Midday.Client.create({
  seed: 'your-64-char-hex-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});

// Load and deploy a contract (deploy returns a DeployedContract handle)
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
  privateStateId: 'my-counter',
});
const deployed = await loaded.deploy();
console.log(`Deployed at: ${deployed.address}`);

// Call contract actions (typed)
await deployed.actions.increment();

// Or untyped fallback
await deployed.call('increment');

// Read state
const state = await deployed.readState();
console.log(state.counter);
```

### Effect API

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from './contracts/counter/contract/index.js';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.effect.create({
    seed: 'your-64-char-hex-seed',
    networkConfig: Midday.Config.NETWORKS.local,
    privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
  });

  const loaded = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
    privateStateId: 'my-counter',
  });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  const state = yield* deployed.effect.readState();

  return state;
});

const result = await Midday.Runtime.runEffectPromise(program);
```

### Effect DI (Dependency Injection)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
import { Effect, Layer } from 'effect';

// Layer composition — all lifecycle is automatic
const ClusterLayer = Cluster.managedLayer({ clusterName: 'my-app' });

const ClientFromCluster = Layer.scoped(
  Midday.Client.MiddayClientService,
  Effect.gen(function* () {
    const cluster = yield* ClusterService;
    return yield* Midday.Client.effect.createScoped({
      seed: 'your-64-char-hex-seed',
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
  }),
);

const AppLayer = ClientFromCluster.pipe(Layer.provide(ClusterLayer));

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.MiddayClientService;
  const loaded = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
  });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  return yield* deployed.effect.readState();
});

// Zero lifecycle code — cleanup is automatic (LIFO: client closes → cluster removes)
const result = await Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```

For simpler cases without devnet management, use `Client.layer()` directly:

```typescript
const ClientLayer = Midday.Client.layer({
  seed: 'your-64-char-hex-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});

const result = await Effect.runPromise(program.pipe(Effect.provide(ClientLayer)));
```

## Browser Usage (Lace Wallet)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const wallet = await Midday.Wallet.fromBrowser('preview');

// Create client with connected wallet; the client uses the wallet's network
const client = await Midday.Client.create({
  wallet,
  privateStateProvider: Midday.PrivateState.persistentPrivateStateProvider({
    accountId: wallet.address,
    password: () => promptForPrivateStatePassword(), // ≥ 16 chars, never public data
  }),
});

// Load and deploy contract (zkConfig goes in loadContract, not in client)
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: new Midday.ZkConfig.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateId: 'my-counter',
});
const deployed = await loaded.deploy();
await deployed.actions.increment();
```

## Wallet Factories

```typescript
// From seed (Node.js) — positional args
const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);
const balance = await wallet.getBalance();

// Persist sync state and resume after a restart instead of resyncing the chain.
// Snapshots contain private wallet data: store them encrypted, never log them.
const snapshot = await wallet.serializeState();
const resumed = await Midday.Wallet.fromSeed(seed, networkConfig, { restoreState: snapshot });

// From browser (Lace extension)
const wallet = await Midday.Wallet.fromBrowser('preview');
const balance = await wallet.getBalance();

// Reading contracts without a wallet: see "Read-Only Client" below
```

## Read-Only Client

```typescript
// No wallet, seed, or proof server required
const reader = Midday.Client.createReadonly({
  networkConfig: Midday.Config.NETWORKS.preview,
});

const counter = reader.loadContract({ module: CounterContract });
const state = await counter.readState(contractAddress);
console.log(state.counter); // 42n
```

## Configuration

### Network Configuration

```typescript
// Local network
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.local,
  // ...
});

// Preview network
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.preview,
  seed: 'your-64-char-hex-seed',
  // ...
});

// Preprod / mainnet are served by Blockfrost and need a project token
const client = await Midday.Client.create({
  networkConfig: Midday.Config.blockfrost('preprod', process.env.BLOCKFROST_PROJECT_ID!),
  seed: 'your-64-char-hex-seed',
  // ...
});

// Custom network
const client = await Midday.Client.create({
  networkConfig: {
    networkId: 'testnet',
    indexer: 'https://indexer.testnet.midnight.network/graphql',
    indexerWS: 'wss://indexer.testnet.midnight.network/graphql/ws',
    node: 'wss://node.testnet.midnight.network',
    proofServer: 'https://proof.testnet.midnight.network',
  },
  seed: 'your-64-char-hex-seed',
  // ...
});
```

## Contract Operations

### Deploy a New Contract

```typescript
const loaded = await client.loadContract({ module, zkConfig, privateStateId: 'my-id' });
const deployed = await loaded.deploy();
console.log(`Deployed at: ${deployed.address}`);

// With timeout
const deployed = await loaded.deploy({ timeout: 60_000 });
```

### Join an Existing Contract

```typescript
const loaded = await client.loadContract({ module, zkConfig, privateStateId: 'my-id' });
const deployed = await loaded.join(contractAddress);

// With timeout
const deployed = await loaded.join(contractAddress, { timeout: 60_000 });
```

### With Witnesses

```typescript
const loaded = await client.loadContract({
  module,
  zkConfig,
  privateStateId: 'my-id',
  witnesses: {
    my_witness_function: myImplementation,
  },
});
const deployed = await loaded.deploy();
```

### Call Actions

```typescript
// Typed — preferred
await deployed.actions.increment();
await deployed.actions.transfer(receiverAddress, 100n);

// Untyped fallback
const result = await deployed.call('increment');
console.log(`TX Hash: ${result.txHash}`);
console.log(`Block: ${result.blockHeight}`);
```

### Read State

```typescript
// Parsed state via ledger
const state = await deployed.readState();

// State at specific block
const historicalState = await deployed.readStateAt(blockHeight);

// Raw state
const raw = await deployed.readStateValue();
```

### Watch State Changes

```typescript
// Callback style
const unsub = deployed.onStateChange((state) => {
  console.log('Counter:', state.counter);
});
// later: unsub();

// Async iterator
for await (const state of deployed.watchState()) {
  console.log('Counter:', state.counter);
  if (state.counter > 10n) break;
}

// Effect Stream
const stream = deployed.effect.watchState();
```

### Transaction Lifecycle

```typescript
// Wait for a transaction with timeout
await client.waitForTx(txHash, { timeout: 30_000 });

// Deploy and join support timeout
const deployed = await loaded.deploy({ timeout: 60_000 });
```

## API Reference

### Namespaces

- `Midday.Client` — Client creation, contract loading, read-only client, fee relay
- `Midday.Contract` — Contract types (`LoadedContract`, `DeployedContract`, `ReadonlyContract`)
- `Midday.Config` — Network configuration presets and constants
- `Midday.Wallet` — Wallet factories (`fromSeed`, `fromBrowser`)
- `Midday.PrivateState` — Private state providers (in-memory, IndexedDB)
- `Midday.ZkConfig` — ZK configuration providers (`fromPath`, `HttpZkConfigProvider`)
- `Midday.Hash` — Cryptographic hash utilities
- `Midday.Runtime` — Effect runtime utilities (`runEffectPromise`, `runEffectWithLogging`)
- `Midday.Utils` — Hex encoding, address formatting, coin utilities

### Services (Effect DI)

| Service | Layer | Description |
|---------|-------|-------------|
| `Client.MiddayClientService` | `Client.layer(config)` | Pre-initialized client (scoped — auto-closes) |
| `ClusterService` | `Cluster.managedLayer(config?)` | Managed devnet cluster (auto-starts/removes) |

### Key Types

```typescript
import type {
  // Client
  ClientConfig,
  MiddayClient,
  ReadonlyClient,
  ReadonlyClientConfig,
  WaitForTxOptions,

  // Contract
  LoadedContract,
  DeployedContract,
  ReadonlyContract,
  DeployOptions,
  JoinOptions,
  CallResult,
  ContractProviders,

  // Wallet
  ConnectedWallet,
  WalletConnection,
  WalletBalance,
  DustBalance,
  WalletProviders,

  // Config
  NetworkConfig,

  // Errors
  ClientError,
  ContractError,
  WalletError,
} from '@no-witness-labs/midday-sdk';
```

### Error Types

| Error | Module | Description |
|-------|--------|-------------|
| `ClientError` | `Client` | Client creation/operation failures |
| `Client.TxTimeoutError` | `Client` | Transaction timeout (has `txHash`) |
| `ContractError` | `Contract` | Contract deployment/call failures |
| `Contract.TxTimeoutError` | `Contract` | Deploy/join timeout (has `operation`) |
| `WalletError` | `Wallet` | Wallet connection/operation failures |

## Supported Networks and Versions

Midday 0.7 targets the **ledger 8** cohort, which is what Preview and Preprod run today:

| Network | How to configure | Status |
|---------|------------------|--------|
| Local devnet | `NETWORKS.local` / `Cluster.make()` (node 1.0.400, indexer 4.3.7, proof server 8.1.3) | Supported, tested in CI |
| Preview | `NETWORKS.preview` | Supported |
| Preprod | `Config.blockfrost('preprod', projectId)` | Supported |
| Mainnet | `Config.blockfrost('mainnet', projectId)` | Configurable; not tested |
| Public devnet (ledger 9) | — | Not supported by 0.7; ledger-9 support is planned for 0.8 |

Pinned upstream versions: `@midnight-ntwrk/midnight-js-*` 4.1.1, `compact-runtime` 0.16.0 (peer dependency), `compact-js` 2.5.1, `ledger-v8` 8.1.0, wallet SDK 4.x, Compact compiler 0.31.1. Contracts must be compiled with Compact 0.31.x.

**Consumer requirement:** your install must resolve a single copy of `@midnight-ntwrk/onchain-runtime-v3`. Out of the box it does not: `midnight-js-protocol` pins 3.0.0 while `compact-runtime` accepts `^3.0.0` and gets 3.1.2, and two copies break contract state decoding with `expected instance of StateValue`. The simplest fix, which works with pnpm, npm and yarn, is a direct dependency on the pinned version:

```bash
pnpm add @midnight-ntwrk/onchain-runtime-v3@3.0.0
```

Alternatively use an override. With pnpm 10 and later it belongs in `pnpm-workspace.yaml` (`overrides:` in `package.json` under `pnpm` is ignored there):

```yaml
overrides:
  "@midnight-ntwrk/onchain-runtime-v3": "3.0.0"
```

Check with `pnpm why @midnight-ntwrk/onchain-runtime-v3`: exactly one version should appear.

## Upgrading to 0.7

- `NETWORKS.preprod` is gone; Preprod and mainnet are served by Blockfrost: use `Config.blockfrost(network, projectId)`. Keep the project id out of browser bundles.
- `PrivateState.persistentPrivateStateProvider` now requires `accountId` (the wallet address) and `password` (≥ 16 characters, a string or a function returning one). It is midnight-js's encrypted level provider; state written by the previous store is not migrated.
- `Client.create({ wallet })` follows the wallet's network; a `network`/`networkConfig` that disagrees with the wallet is rejected. The development seed is only implied for the `local` preset.
- `feeRelay` on `Client.create` now applies to browser wallets and is rejected for seed wallets; `FromWalletConfig.txTtlMs` and the unused `storage` option are removed.
- `Client.TxTimeoutError` is the same class as `Contract.TxTimeoutError`.
- Removed: `PrivateState.makeIndexedDB`, `makeInMemory`, the `PrivateState.get/set/...` functions, `PrivateStateService`/`PrivateStateLive`, `Images.build` (use `Images.buildServerImage`).
- Browser-wallet transaction ids are now ledger identifiers instead of the serialized transaction.

## License

MIT
