# Browser Lace Wallet Example

Demonstrates browser wallet integration with the Lace wallet extension.

## Overview

This example shows:
- Connecting to the Lace wallet browser extension
- Creating a Midday client from wallet connection
- Using IndexedDB for persistent private state
- Contract deployment and interaction in the browser
- Funding wallet from devnet faucet

## Prerequisites

- [Lace Wallet](https://www.lace.io/) browser extension installed
- Docker installed and running (for local devnet)
- Node.js 18+

## Quick Start (Local Devnet)

### 1. Start the devnet (includes faucet server)

```bash
# Terminal 1
DOCKER_HOST=unix:///var/run/docker.sock pnpm --filter @examples/devnet-testing start
```

Wait until you see:
```
=== Devnet ready for testing ===
Faucet available at http://localhost:3001/faucet
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
4. Click "Fund Wallet" - get tokens from faucet
5. Click "Deploy Contract" - deploy counter contract
6. Click "Increment" / "Read State" - interact with contract

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
| Local Devnet | Local Docker containers, use faucet to fund wallet |
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
         │ POST /faucet
         ▼
┌─────────────────┐
│  Faucet Server  │
│  (:3001)        │
│                 │
│  Funds wallet   │
│  from genesis   │
└─────────────────┘
```

## Code Walkthrough

### 1. Connect to Lace Wallet

```typescript
const connection = await Midday.BrowserWallet.connectWallet('undeployed');
```

### 2. Create Client from Wallet

```typescript
const client = await Midday.Client.fromWallet(connection, {
  privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
  }),
});
```

### 3. Fund Wallet (Local Devnet)

```typescript
// Browser calls faucet HTTP server
const response = await fetch('http://localhost:3001/faucet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    coinPublicKey: connection.addresses.shieldedCoinPublicKey,
    encryptionPublicKey: connection.addresses.shieldedEncryptionPublicKey,
  }),
});
```

### 4. Load and Deploy Contract

```typescript
const contract = await client.loadContract({
  module: CounterContract,
  zkConfig: new Midday.ZkConfig.HttpZkConfigProvider('/zk-config'),
  privateStateId: 'my-counter',
});
await contract.deploy();
```

### 5. Call Actions

```typescript
const result = await contract.call('increment');
console.log(`TX: ${result.txHash}`);
```

## Troubleshooting

**Lace wallet not detected:**
- Ensure Lace extension is installed and enabled
- Refresh the page after installing

**Funding failed:**
- Ensure devnet is running with faucet server
- Check Terminal 1 for faucet logs

**Deploy failed:**
- Ensure wallet has funds (click "Fund Wallet" first)
- Check browser console for detailed errors

**Docker issues:**
- Set `DOCKER_HOST=unix:///var/run/docker.sock` before commands
- Run cleanup: `pnpm --filter @examples/devnet-testing cleanup`
