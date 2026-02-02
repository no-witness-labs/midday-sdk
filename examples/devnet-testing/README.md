# Devnet Testing Example

Demonstrates local development workflow using Midnight devnet with Docker.

## Prerequisites

- Node.js 18+
- pnpm
- Docker running locally

## Setup

```bash
# From repository root
pnpm install

# Build the SDK
pnpm build

# Build this example
cd examples/devnet-testing
pnpm build
```

## Run

```bash
pnpm start
```

This will:
1. Start a local Midnight devnet cluster (Docker containers)
2. Wait for all services to be healthy
3. Create a client connected to devnet
4. Request funds from the faucet
5. Keep running for manual testing

Press `Ctrl+C` to stop the devnet cluster.

## Code Overview

### Starting the Cluster

```typescript
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';

// Create and start cluster
const cluster = await Cluster.make();
await cluster.start();

// Access network config
console.log(cluster.networkConfig);
```

### Creating a Client

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

const client = await Midday.Client.create({
  seed: Midday.Config.DEV_WALLET_SEED,
  networkConfig: cluster.networkConfig,
  zkConfigProvider: new Midday.HttpZkConfigProvider(cluster.networkConfig.proofServer),
  privateStateProvider: Midday.inMemoryPrivateStateProvider(),
});
```

### Deploying Contracts

```typescript
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/counter/index.js'),
});

const contract = await Midday.ContractBuilder.deploy(builder);
console.log(`Deployed at: ${contract.address}`);
```

### Stopping the Cluster

```typescript
await cluster.remove();
```

## Docker Containers

The devnet cluster starts these containers:
- `midnight-node` - Midnight blockchain node
- `midnight-indexer` - GraphQL indexer
- `midnight-proof-server` - ZK proof generation server

## Troubleshooting

### Docker not running
```
Error: Cannot connect to Docker daemon
```
Start Docker Desktop or the Docker daemon.

### Port conflicts
```
Error: Port 8080 already in use
```
Stop other services using the required ports or configure different ports.

### Container startup timeout
```
Error: Health check timeout
```
Increase the timeout or check Docker resources (CPU/memory).

## Next Steps

- See [counter](../counter) for basic Promise API usage
- See [effect-di](../effect-di) for Effect dependency injection
- See [browser-lace](../browser-lace) for browser integration
