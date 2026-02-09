# Devnet Testing Example

Demonstrates the SDK's devnet module for local development with Docker containers.

## What This Example Does

1. Creates a devnet cluster configuration
2. Starts Docker containers (node, indexer, proof server)
3. Creates a Midday client connected to devnet
4. Waits for Ctrl+C to cleanup
5. Removes all containers on exit

## Prerequisites

- [Docker](https://www.docker.com/) installed and running
- For OrbStack users: Set `DOCKER_HOST=unix:///var/run/docker.sock`

## Running

```bash
# Standard Docker
pnpm start

# OrbStack users
DOCKER_HOST=unix:///var/run/docker.sock pnpm start
```

Press `Ctrl+C` to stop and cleanup.

## Expected Output

```
=== Devnet Testing Example ===

1. Creating devnet cluster...
   Cluster created

2. Starting devnet cluster (this may take a few minutes)...
   Cluster started successfully!

3. Network configuration:
   Network ID: undeployed
   Indexer: http://localhost:8088/api/v3/graphql
   Node: ws://localhost:9944
   Proof Server: http://localhost:6300

4. Creating Midday client with devnet config...
   Client created
   Network ID: undeployed

5. Contract operations (demonstration):
   - Load contract: client.loadContract({ module, zkConfig, privateStateId })
   - Deploy: const deployed = await loaded.deploy()
   - Call action: await deployed.actions.increment()
   - Read state: await deployed.ledgerState()

=== Devnet ready for testing ===
Press Ctrl+C to stop and cleanup...
^C
6. Cleaning up devnet cluster...
   Cluster removed

=== Done ===
```

## Code Walkthrough

### Create and Start Cluster

```typescript
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';

const cluster = await Cluster.make();
await cluster.start();
```

### Get Network Configuration

```typescript
const networkConfig = cluster.networkConfig;
// {
//   networkId: 'undeployed',
//   indexer: 'http://localhost:8088/api/v3/graphql',
//   node: 'ws://localhost:9944',
//   proofServer: 'http://localhost:6300',
// }
```

### Create Client with Devnet

```typescript
const client = await Midday.Client.create({
  seed: Midday.Config.DEV_WALLET_SEED,
  networkConfig: cluster.networkConfig,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});
```

### Cleanup

```typescript
await cluster.remove();
```

## Use Cases

- **Development**: Run contracts locally without testnet
- **Testing**: Spin up isolated environments for tests
- **CI/CD**: Automated E2E testing in pipelines

## Next Steps

- See [counter](../counter) for complete Promise API example with contract
- See [effect-di](../effect-di) for Effect DI example with contract
