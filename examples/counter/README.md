# Counter Example

Basic example demonstrating contract deployment and interaction using the Promise API.

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
cd examples/counter
pnpm build
```

## Configuration

Set environment variables or use defaults:

```bash
export WALLET_SEED="your-64-char-hex-seed"  # Default: DEV_WALLET_SEED
export ZK_CONFIG_URL="http://localhost:3000/zk"
```

## Run

```bash
pnpm start
```

## Code Overview

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Create client
const client = await Midday.Client.create({
  seed: CONFIG.seed,
  networkConfig: Midday.Config.NETWORKS.local,
  zkConfigProvider: new Midday.HttpZkConfigProvider(CONFIG.zkConfigUrl),
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});

// Load contract
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/counter/index.js'),
});

// Deploy
const contract = await Midday.ContractBuilder.deploy(builder);

// Interact
await Midday.Contract.call(contract, 'increment');
const state = await Midday.Contract.ledgerState(contract);
```

## Next Steps

- See [browser-lace](../browser-lace) for browser integration with Lace wallet
- See [effect-di](../effect-di) for Effect dependency injection patterns
