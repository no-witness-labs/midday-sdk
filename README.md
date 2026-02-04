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

// Create client
const client = await Midday.createClient({
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: zkConfig,
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});

// Load and deploy a contract
const contract = await client.loadContract({ module });
await contract.deploy();
console.log(`Deployed at: ${contract.address}`);

// Call contract actions
await contract.call('increment');

// Read state
const state = await contract.ledgerState();
console.log(state.counter);
```

### Effect API

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
  const client = yield* Midday.effect.createClient({
    networkConfig: Midday.Config.NETWORKS.local,
    zkConfigProvider: zkConfig,
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
  });

  const contract = yield* client.effect.loadContract({ module });
  yield* contract.effect.deploy();
  yield* contract.effect.call('increment');
  const state = yield* contract.effect.ledgerState();

  return state;
});

const result = await Midday.runEffectPromise(program);
```

### Effect DI (Dependency Injection)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect, Layer } from 'effect';

const ClientLayer = Midday.Client.layer({
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: zkConfig,
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});

const program = Effect.gen(function* () {
  const client = yield* Midday.MiddayClientService;
  const contract = yield* client.effect.loadContract({ module });
  yield* contract.effect.deploy();
  yield* contract.effect.call('increment');
  return yield* contract.effect.ledgerState();
});

const result = await Effect.runPromise(program.pipe(Effect.provide(ClientLayer)));
```

## Browser Usage (Lace Wallet)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const connection = await Midday.connectWallet('testnet');

// Create client from wallet connection
const client = await Midday.fromWallet(connection, {
  zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
});

// Load and deploy contract
const contract = await client.loadContract({ module });
await contract.deploy();
await contract.call('increment');
```

## Configuration

### Network Configuration

```typescript
// Local network
const client = await Midday.createClient({
  networkConfig: Midday.Config.NETWORKS.local,
  // ...
});

// Testnet
const client = await Midday.createClient({
  networkConfig: Midday.Config.NETWORKS.testnet,
  seed: 'your-64-char-hex-seed',
  // ...
});

// Custom network
const client = await Midday.createClient({
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
const contract = await client.loadContract({ module });
await contract.deploy();
console.log(`Deployed at: ${contract.address}`);
```

### Join an Existing Contract

```typescript
const contract = await client.loadContract({ module });
await contract.join(contractAddress);
```

### With Witnesses

```typescript
const contract = await client.loadContract({
  module,
  witnesses: {
    my_witness_function: myImplementation,
  },
});
await contract.deploy();
```

### Call Actions

```typescript
const result = await contract.call('increment');
console.log(`TX Hash: ${result.txHash}`);
console.log(`Block: ${result.blockHeight}`);
```

### Read State

```typescript
// Parsed state via ledger
const state = await contract.ledgerState();

// State at specific block
const historicalState = await contract.ledgerStateAt(blockHeight);
```

## API Reference

### Top-level Exports

- `Midday.createClient(config)` - Create a new client (Promise)
- `Midday.effect.createClient(config)` - Create a new client (Effect)
- `Midday.fromWallet(connection, config)` - Create client from wallet (browser)

### Modules

- `Midday.Client` - Client creation, contract loading, static functions
- `Midday.Config` - Network configuration utilities
- `Midday.Wallet` - Wallet initialization and management
- `Midday.Providers` - Low-level provider setup

### Services (Effect DI)

| Service | Layer | Description |
|---------|-------|-------------|
| `MiddayClientService` | `Client.layer(config)` | Pre-initialized client |
| `ClientService` | `ClientLive` | Client factory |
| `WalletService` | `WalletLive` | Wallet initialization |
| `ProvidersService` | `ProvidersLive` | Provider setup |
| `ZkConfigService` | `ZkConfigLive` | ZK configuration loading |
| `PrivateStateService` | `PrivateStateLive` | Private state management |
| `WalletConnectorService` | `WalletConnectorLive` | Browser wallet connection |
| `WalletProviderService` | `WalletProviderLive` | Wallet provider operations |

### Types

```typescript
import type {
  ClientConfig,
  MiddayClient,
  Contract,
  ContractState,
  CallResult,
  NetworkConfig,
  WalletContext,
  ContractProviders,
  StorageConfig,
} from '@no-witness-labs/midday-sdk';
```

## License

MIT
