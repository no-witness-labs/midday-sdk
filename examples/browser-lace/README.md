# Browser Lace Wallet Example

Demonstrates browser wallet integration with the Lace wallet extension.

## Overview

This example shows:
- Connecting to the Lace wallet browser extension
- Creating a Midday client from wallet connection
- Using IndexedDB for persistent private state
- Contract deployment and interaction in the browser
- Fee relay for browser wallets (devnet feature)

## Prerequisites

- [Lace Wallet](https://www.lace.io/) browser extension installed
- Docker installed and running (for local devnet)
- Node.js 18+

## Quick Start (Local Devnet)

### 1. Start the devnet (includes fee relay server)

```bash
# Terminal 1
DOCKER_HOST=unix:///var/run/docker.sock pnpm --filter @examples/devnet-testing start
```

Wait until you see:
```
=== Devnet ready for testing ===
Fee relay available at http://localhost:3002
```

### 2. Start the browser app

```bash
# Terminal 2
pnpm --filter @examples/browser-lace dev
```

### 3. Use the app

1. Open http://localhost:5173
2. Select "Local Devnet" from dropdown
3. Click "Connect Wallet" - approve in Lace
4. Click "Deploy Contract" - deploy counter contract (fees paid by genesis via fee relay)
5. Click "Increment" / "Read State" - interact with contract

### 4. Cleanup

```bash
# Stop the browser app (Ctrl+C in Terminal 2)
# Stop the devnet (Ctrl+C in Terminal 1)

# Or force cleanup all containers:
DOCKER_HOST=unix:///var/run/docker.sock pnpm --filter @examples/devnet-testing cleanup
```

## Network Options

| Network | Description |
|---------|-------------|
| Local Devnet | Local Docker containers, fee relay pays tx fees from genesis |
| Preview | Midnight testnet, need testnet tokens |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Browser App    │     │  Devnet         │
│  (Vite :5173)   │     │  (Docker)       │
│                 │     │                 │
│  - Lace Wallet  │────▶│  - Node :9944   │
│  - Midday SDK   │     │  - Indexer :8088│
│  - Counter UI   │     │  - Prover :6300 │
└────────┬────────┘     └─────────────────┘
         │
         │ POST /balance-tx, /submit-tx
         ▼
┌─────────────────┐
│  Fee Relay      │
│  (:3002)        │
│                 │
│  Pays tx fees   │
│  from genesis   │
└─────────────────┘
```

## Fee Relay (Devnet Feature)

On local devnet, only the genesis wallet has dust (tDUST) to pay transaction fees. Browser wallets like Lace start with zero balance. The **fee relay** solves this by letting the genesis wallet pay fees on behalf of browser wallets.

### How it works

A transaction in Midnight has two independent layers:

| Layer | Who | What |
|-------|-----|------|
| **ZK layer** | Lace wallet | Circuit execution, ZK proofs, coin ownership |
| **Fee layer** | Genesis wallet (via fee relay) | Dust for tx fees, submission to node |

The transaction flow for `deploy` or `increment`:

```
1. Circuit executes with Lace's coinPublicKey     ← Lace owns the state
2. ZK proof generated (proof server :6300)         ← proves Lace authorized it
3. UnboundTransaction created                      ← locked to Lace, needs fees
4. Fee relay: genesis wallet adds dust via         ← can't alter the ZK proof
   POST /balance-tx → FinalizedTransaction
5. Fee relay: genesis wallet submits via           ← just sends bytes to node
   POST /submit-tx → TransactionId
```

The genesis wallet **cannot** modify contract state or change ownership — the ZK proof from step 2 locks the transaction to the Lace wallet's keys. Genesis only adds fee inputs/outputs in step 4, which is independent of the ZK layer.

### Key separation

```typescript
// These come from Lace — contract ownership
walletProvider.getCoinPublicKey()       // → Lace's shielded coin key
walletProvider.getEncryptionPublicKey() // → Lace's encryption key

// These are overridden by fee relay — fee payment only
walletProvider.balanceTx()  // → genesis wallet pays dust
midnightProvider.submitTx() // → genesis wallet submits
```

### Usage

```typescript
// Server-side: start fee relay alongside devnet
import { Cluster, FeeRelay } from '@no-witness-labs/midday-sdk/devnet';

const cluster = await Cluster.make();
await cluster.start();
FeeRelay.startServer(cluster.networkConfig, { port: 3002 });

// Browser: point feeRelay to the server URL
const wallet = await Midday.Wallet.fromBrowser('undeployed');
const client = await Midday.Client.create({
  wallet,
  privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
  }),
  feeRelay: { url: 'http://localhost:3002' },
});
```

## Code Walkthrough

### 1. Connect to Lace Wallet

```typescript
const wallet = await Midday.Wallet.fromBrowser('undeployed');
```

### 2. Create Client from Wallet (with fee relay)

```typescript
const client = await Midday.Client.create({
  wallet,
  privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
  }),
  feeRelay: { url: 'http://localhost:3002' },
});
```

### 3. Load and Deploy Contract

```typescript
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: new Midday.ZkConfig.HttpZkConfigProvider('/zk-config'),
  privateStateId: 'my-counter',
});
const deployed = await loaded.deploy();
```

### 4. Call Actions

```typescript
const result = await deployed.call('increment');
console.log(`TX: ${result.txHash}`);
```

## Troubleshooting

**Lace wallet not detected:**
- Ensure Lace extension is installed and enabled
- Refresh the page after installing

**Deploy failed:**
- Ensure devnet is running with fee relay server
- Check that http://localhost:3002/health returns `{"status":"ok"}`
- Check browser console for detailed errors

**Docker issues:**
- Set `DOCKER_HOST=unix:///var/run/docker.sock` before commands
- Run cleanup: `pnpm --filter @examples/devnet-testing cleanup`
