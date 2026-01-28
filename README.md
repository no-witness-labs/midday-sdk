# midday-sdk

Developer-friendly SDK for building dapps on Midnight Network.

## Installation

```bash
pnpm add @no-witness-labs/midday-sdk
```

## Quick Start

### Promise API (Non-Effect Users)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Create client
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});

// Load and deploy a contract
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/counter/index.js'),
});
const contract = await Midday.ContractBuilder.deploy(builder);

// Call contract actions
await Midday.Contract.call(contract, 'increment');

// Read state
const state = await Midday.Contract.ledgerState(contract);
console.log(state.counter);
```

### Effect API (Pure Effect Users)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.effect.create({
    networkConfig: Midday.Config.NETWORKS.local,
    zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
  });

  const builder = yield* Midday.Client.effect.contractFrom(client, {
    module: await import('./contracts/counter/index.js'),
  });

  const contract = yield* Midday.ContractBuilder.effect.deploy(builder);
  const result = yield* Midday.Contract.effect.call(contract, 'increment');

  return result;
});

const result = await Midday.runEffectPromise(program);
```

### Effect DI (Dependency Injection)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Effect, Layer } from 'effect';

const program = Effect.gen(function* () {
  const clientService = yield* Midday.ClientService;
  const contractBuilderService = yield* Midday.ContractBuilderService;
  const contractService = yield* Midday.ContractService;

  const client = yield* clientService.create({
    networkConfig: Midday.Config.NETWORKS.local,
    zkConfigProvider: new Midday.HttpZkConfigProvider('http://localhost:3000/zk'),
    privateStateProvider: Midday.inMemoryPrivateStateProvider(),
  });

  const builder = yield* clientService.contractFrom(client, {
    module: await import('./contracts/counter/index.js'),
  });

  const contract = yield* contractBuilderService.deploy(builder);
  const result = yield* contractService.call(contract, 'increment');

  return result;
});

// Compose layers
const MainLive = Layer.mergeAll(
  Midday.ClientLive,
  Midday.ContractBuilderLive,
  Midday.ContractLive,
);

const result = await Effect.runPromise(program.pipe(Effect.provide(MainLive)));
```

## Browser Usage (Lace Wallet)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const connection = await Midday.connectWallet('testnet');

// Create client from wallet connection
const client = await Midday.Client.fromWallet(connection, {
  zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateProvider: Midday.indexedDBPrivateStateProvider({ privateStateStoreName: 'my-app' }),
});

// Use contract
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/counter/index.js'),
});
const contract = await Midday.ContractBuilder.deploy(builder);
await Midday.Contract.call(contract, 'increment');
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
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/my-contract/index.js'),
});
const contract = await Midday.ContractBuilder.deploy(builder);
console.log(`Deployed at: ${contract.address}`);
```

### Join an Existing Contract

```typescript
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/my-contract/index.js'),
});
const contract = await Midday.ContractBuilder.join(builder, { address: contractAddress });
```

### With Witnesses

```typescript
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/my-contract/index.js'),
  witnesses: {
    my_witness_function: myImplementation,
  },
});
const contract = await Midday.ContractBuilder.deploy(builder);
```

### Call Actions

```typescript
const result = await Midday.Contract.call(contract, 'increment');
console.log(`TX Hash: ${result.txHash}`);
console.log(`Block: ${result.blockHeight}`);
```

### Read State

```typescript
// Parsed state via ledger
const state = await Midday.Contract.ledgerState(contract);

// Raw state
const rawState = await Midday.Contract.state(contract);

// State at specific block
const historicalState = await Midday.Contract.ledgerStateAt(contract, blockHeight);
```

## API Reference

### Modules

- `Midday.Client` - High-level client for contract interactions
- `Midday.ContractBuilder` - Contract deployment and joining
- `Midday.Contract` - Contract operations (call, state)
- `Midday.Config` - Network configuration utilities
- `Midday.Wallet` - Wallet initialization and management
- `Midday.Providers` - Low-level provider setup

### Services (Effect DI)

| Service | Layer | Description |
|---------|-------|-------------|
| `ClientService` | `ClientLive` | Client creation and contract loading |
| `ContractBuilderService` | `ContractBuilderLive` | Contract deployment and joining |
| `ContractService` | `ContractLive` | Contract operations |
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
  MidnightClient,
  ContractBuilder,
  ConnectedContract,
  CallResult,
  NetworkConfig,
  WalletContext,
  ContractProviders,
  StorageConfig,
} from '@no-witness-labs/midday-sdk';
```

## License

MIT
