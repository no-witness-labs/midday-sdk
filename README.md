# midday-sdk

Developer-friendly SDK for building dapps on Midnight Network.

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
const state = await deployed.ledgerState();
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
  const state = yield* deployed.effect.ledgerState();

  return state;
});

const result = await Midday.Runtime.runEffectPromise(program);
```

### Effect DI (Dependency Injection)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect } from 'effect';

const ClientLayer = Midday.Client.layer({
  seed: 'your-64-char-hex-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.MiddayClientService;
  const loaded = yield* client.effect.loadContract({ module: CounterContract });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  return yield* deployed.effect.ledgerState();
});

const result = await Effect.runPromise(program.pipe(Effect.provide(ClientLayer)));
```

## Browser Usage (Lace Wallet)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const connection = await Midday.Wallet.connectWallet('testnet');

// Create client from wallet connection
const client = await Midday.Client.fromWallet(connection, {
  privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
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
// From seed (Node.js)
const wallet = await Midday.Wallet.fromSeed({ seed, networkConfig });
const balance = await wallet.getBalance();

// From browser (Lace extension)
const wallet = await Midday.Wallet.fromBrowser('testnet');
const balance = await wallet.getBalance();

// Read-only (address only, no signing)
const wallet = Midday.Wallet.fromAddress('0x...');
console.log(wallet.address);
```

## Read-Only Client

```typescript
// No wallet, seed, or proof server required
const reader = Midday.Client.createReadonly({
  networkConfig: Midday.Config.NETWORKS.testnet,
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

// Testnet
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.testnet,
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
const state = await deployed.ledgerState();

// State at specific block
const historicalState = await deployed.ledgerStateAt(blockHeight);

// Raw state
const raw = await deployed.getState();
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
- `Midday.Wallet` — Wallet factories (`fromSeed`, `fromBrowser`, `fromAddress`, `connectWallet`)
- `Midday.PrivateState` — Private state providers (in-memory, IndexedDB)
- `Midday.ZkConfig` — ZK configuration providers (`fromPath`, `HttpZkConfigProvider`)
- `Midday.Hash` — Cryptographic hash utilities
- `Midday.Runtime` — Effect runtime utilities (`runEffectPromise`, `runEffectWithLogging`)
- `Midday.Utils` — Hex encoding, address formatting, coin utilities

### Services (Effect DI)

| Service | Layer | Description |
|---------|-------|-------------|
| `Client.MiddayClientService` | `Client.layer(config)` | Pre-initialized client |
| `Client.ClientService` | `Client.ClientLive` | Client factory |

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
  ReadonlyWallet,
  WalletConnection,
  WalletBalance,
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

## License

MIT
