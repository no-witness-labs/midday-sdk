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
- [pnpm](https://pnpm.io/) package manager
- Docker installed and running (for local devnet)
- Node.js 18+

## Quick Start (Local Devnet)

### 1. Install dependencies

From the **monorepo root** (`midday-sdk/`):

```bash
pnpm install
```

### 3. Start the devnet (includes fee relay server)

```bash
# Terminal 1
pnpm --filter @examples/devnet-testing start
```

Wait until you see:
```
=== Devnet ready for testing ===
Fee relay available at http://localhost:3002
```

### 3. Start the browser app

```bash
# Terminal 2
pnpm --filter @examples/browser-lace dev
```

### 4. Use the app

1. Open http://localhost:5173
2. Select "Local Devnet" from dropdown
3. Click "Connect Wallet" - approve in Lace
4. Click "Deploy Contract" - deploy counter contract (fees paid by genesis via fee relay)
   - Deploy takes ~20 seconds on local devnet (proof generation + block confirmation)
5. Click "Increment" / "Read State" - interact with contract

### 4. Cleanup

```bash
# Stop the browser app (Ctrl+C in Terminal 2)
# Stop the devnet (Ctrl+C in Terminal 1)

# Or force cleanup all containers:
pnpm --filter @examples/devnet-testing cleanup
```

## Network Options

| Network | Fee Relay | Description |
|---------|-----------|-------------|
| Local Devnet | Yes (auto-enabled) | Local Docker containers, genesis wallet pays tx fees |
| Preview | No | Midnight testnet, Lace wallet pays fees with own dust |
| Preprod | No | Midnight testnet, Lace wallet pays fees with own dust |

> **Note:** The fee relay checkbox is automatically disabled when selecting a testnet — it only works with local devnet.

### Using Testnets (Preview / Preprod)

1. Make sure Lace is configured for the **matching network** in its settings
2. Your Lace wallet needs **dust (tDUST)** to pay transaction fees
3. Select the network from the dropdown and connect — no devnet or fee relay needed
4. Optionally run a local proof server for faster proving (otherwise Lace proves in-browser via WASM):
   ```bash
   docker run -d --name proof-server -p 6300:6300 bricktowers/proof-server:7.0.0
   ```
   Then set `http://localhost:6300` as the proof server URL in Lace settings.

## Architecture (Local Devnet)

```
Browser (Vite :5173)          Devnet (Docker)
┌───────────────────┐         ┌──────────────────┐
│ Lace Wallet       │────────▶│ Node :9944       │
│ Midday SDK        │         │ Indexer :8088    │
│ Counter UI        │         │ Proof Server :6300│
└────────┬──────────┘         └──────────────────┘
         │ POST /balance-tx
         ▼
   Fee Relay :3002
   (genesis pays fees)
```

See [`src/main.ts`](src/main.ts) for the full implementation.

## Troubleshooting

**Lace wallet not detected:**
- Ensure Lace extension is installed and enabled
- Refresh the page after installing

**Deploy failed (Local Devnet):**
- Ensure devnet is running with fee relay server
- Check that http://localhost:3002/health returns `{"status":"ok"}`
- Check browser console for detailed errors

**"Failed to balance transaction" (Testnets):**
- Your Lace wallet has **no dust** — dust is required to pay transaction fees
- Failed transactions can desync Lace's wallet state, making it think dust is spent when it isn't
- Fix: disconnect and reconnect Lace to force a resync
- Check dust balance in Lace before retrying

**Lace network mismatch:**
- Lace must be configured for the same network selected in the dropdown
- E.g., selecting "Preprod" in the app but having Lace on "Preview" will fail silently

**Deploy seems stuck:**
- Local devnet: ~20 seconds is normal (proof generation + block confirmation)
- Testnets: can take 1-2 minutes (real block times + network latency)
- If using in-browser proving (no local proof server), proving alone can take 30-60s

**Docker issues:**
- If Docker commands fail with connection errors, set `DOCKER_HOST=unix:///var/run/docker.sock` (needed for some Docker runtimes like Colima)
- Run cleanup: `pnpm --filter @examples/devnet-testing cleanup`
