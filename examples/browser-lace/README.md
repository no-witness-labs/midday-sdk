# Browser Lace Wallet Example

Demonstrates browser wallet integration with the Lace wallet extension.

## Overview

This example shows:
- Connecting to the Lace wallet browser extension
- Creating a Midday client from wallet connection
- Using IndexedDB for persistent private state
- Contract deployment and interaction in the browser

## Prerequisites

- [Lace Wallet](https://www.lace.io/) browser extension installed
- Testnet account with funds (or local devnet - see [devnet-testing](../devnet-testing))
- Compiled contract module (for actual deployment)

## Network Options

**Testnet (default):** Connect to Midnight testnet with Lace wallet configured for testnet.

**Local Devnet:** For local development, first start a devnet:
```bash
cd ../devnet-testing
pnpm install && pnpm start
```
Then update the wallet connection in the code to use local network.

## Setup

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build
```

## Running

```bash
# Start development server
pnpm dev

# Open http://localhost:5173 in browser with Lace extension
```

## Code Walkthrough

### 1. Connect to Lace Wallet

```typescript
const connection = await Midday.BrowserWallet.connectWallet('testnet');
```

### 2. Create Client from Wallet

```typescript
const client = await Midday.Client.fromWallet(connection, {
  zkConfigProvider: new Midday.Providers.HttpZkConfigProvider(zkConfigUrl),
  privateStateProvider: Midday.PrivateState.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
  }),
});
```

### 3. Load and Deploy Contract

```typescript
const contract = await client.loadContract({ module: MyContract });
await contract.deploy();
```

### 4. Call Actions

```typescript
const result = await contract.call('increment');
console.log(`TX: ${result.txHash}`);
```

## Browser Considerations

- **WASM Support**: The SDK uses WASM modules. Vite config includes plugins for WASM support.
- **IndexedDB**: Private state persists in browser storage between sessions.
- **Wallet Approval**: Users must approve the connection in their Lace wallet.

## Vite Configuration

```typescript
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: {
    target: 'esnext',
  },
});
```

## Next Steps

- See [counter](../counter) for the Promise API pattern
- See [effect-di](../effect-di) for Effect dependency injection
- See [devnet-testing](../devnet-testing) for local development
