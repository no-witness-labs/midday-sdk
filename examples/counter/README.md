# Counter Example (Promise API)

Complete working example demonstrating contract deployment and interaction using the Promise API.

## What This Example Does

1. Spins up a local devnet (Docker containers)
2. Creates a Midday client
3. Loads and deploys the counter contract
4. Calls `increment()` twice
5. Reads ledger state after each call
6. Cleans up devnet on exit

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

## Expected Output

```
=== Counter Example (Promise API) ===

1. Starting local devnet...
   Devnet started
   Node: ws://localhost:9944
   Indexer: http://localhost:8088/api/v3/graphql

2. Creating Midday client...
   Client created

3. Loading counter contract...
   Contract loaded (state: loaded)

4. Deploying contract...
   Contract deployed!
   Address: abc123...

5. Calling increment()...
   TX Hash: def456...
   Block: 1

6. Reading ledger state...
   Counter value: 1

7. Calling increment() again...
   TX Hash: ghi789...

8. Reading ledger state...
   Counter value: 2

=== Example complete ===

Cleaning up...
Removing devnet...
Done!
```

## Code Walkthrough

### 1. Start Devnet

```typescript
const cluster = await Cluster.make({ clusterName: 'counter-example' });
await cluster.start();
```

### 2. Create Client

```typescript
const client = await Midday.Client.create({
  seed: Midday.Config.DEV_WALLET_SEED,
  networkConfig: cluster.networkConfig,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});
```

### 3. Load & Deploy Contract

```typescript
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: Midday.ZkConfig.fromPath(COUNTER_CONTRACT_DIR),
  privateStateId: 'counter-example',
});
const deployed = await loaded.deploy();
```

### 4. Call Actions & Read State

```typescript
await deployed.actions.increment();
const state = await deployed.ledgerState();
console.log(state.counter);
```

### 5. Cleanup

Always close the client before removing the cluster to avoid WebSocket noise:

```typescript
if (client) await client.close();
await cluster.remove();
```

## Next Steps

- See [effect-di](../effect-di) for Effect DI patterns
- See [browser-lace](../browser-lace) for browser wallet integration
