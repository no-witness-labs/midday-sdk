# midday-sdk

Developer-friendly SDK for building dapps on Midnight Network.

## Installation

```bash
pnpm add @no-witness-labs/midday-sdk
```

## Quick Start

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Create client (uses local network + dev wallet by default)
const client = await Midday.Client.create();

// Load and deploy a contract
const counter = await (await client.contractFrom('build/simple-counter')).deploy();

// Call contract actions
await counter.call('increment');

// Read state
const state = await counter.ledgerState();
console.log(state.counter);
```

## Configuration

### Network Configuration

```typescript
// Local network (default)
const client = await Midday.Client.create();

// Custom network via config
const client = await Midday.Client.create({
  networkConfig: {
    networkId: 'testnet',
    indexer: 'https://indexer.testnet.midnight.network/graphql',
    indexerWS: 'wss://indexer.testnet.midnight.network/graphql/ws',
    node: 'wss://node.testnet.midnight.network',
    proofServer: 'https://proof.testnet.midnight.network',
  },
  seed: 'your-64-char-hex-seed',
});

// Or via environment variables
// MIDNIGHT_INDEXER=https://...
// MIDNIGHT_INDEXER_WS=wss://...
// MIDNIGHT_NODE=wss://...
// MIDNIGHT_PROOF_SERVER=https://...
// MIDNIGHT_NETWORK_ID=testnet
```

### Wallet Seed

```typescript
// Local network uses dev wallet by default
const client = await Midday.Client.create();

// Custom seed
const client = await Midday.Client.create({
  seed: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
});
```

### Storage Configuration

```typescript
const client = await Midday.Client.create({
  storage: {
    path: '.data/my-app-state',
    password: 'secure-password',
  },
});

// Or via environment variable
// MIDNIGHT_STORAGE_PASSWORD=secure-password
```

## Contract Operations

### Deploy a New Contract

```typescript
const contract = await (await client.contractFrom('build/my-contract')).deploy();
console.log(`Deployed at: ${contract.address}`);
```

### Join an Existing Contract

```typescript
const contract = await (await client.contractFrom('build/my-contract')).join(address);
```

### Path Resolution Options

```typescript
// Relative to cwd (default)
await client.contractFrom('build/my-contract');

// Relative to project root (finds package.json)
await client.contractFrom('build/my-contract', { from: 'project' });

// Relative to current file
await client.contractFrom('../build/my-contract', { from: import.meta.url });

// Absolute path
await client.contractFrom('/absolute/path/to/build/my-contract');
```

### With Witnesses

```typescript
const contract = await (
  await client.contractFrom('build/my-contract', {
    witnesses: {
      my_witness_function: myImplementation,
    },
  })
).deploy();
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

// Raw state
const rawState = await contract.state();

// State at specific block
const historicalState = await contract.ledgerStateAt(blockHeight);
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIDNIGHT_INDEXER` | Indexer GraphQL HTTP endpoint |
| `MIDNIGHT_INDEXER_WS` | Indexer GraphQL WebSocket endpoint |
| `MIDNIGHT_NODE` | Node WebSocket endpoint |
| `MIDNIGHT_PROOF_SERVER` | Proof server HTTP endpoint |
| `MIDNIGHT_NETWORK_ID` | Network ID (e.g., 'undeployed', 'testnet') |
| `MIDNIGHT_STORAGE_PASSWORD` | Private state storage password |

## API Reference

### Modules

- `Midday.Client` - High-level client for contract interactions
- `Midday.Config` - Network configuration utilities
- `Midday.Wallet` - Wallet initialization and management
- `Midday.Providers` - Low-level provider setup

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
