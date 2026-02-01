# Browser + Lace Wallet Example

Demonstrates browser integration with Lace wallet using Midday SDK.

## Prerequisites

- Node.js 18+
- pnpm
- [Lace wallet](https://www.lace.io/) browser extension
- Lace connected to Midnight testnet

## Setup

```bash
# From repository root
pnpm install

# Build the SDK
pnpm build
```

## Development

```bash
cd examples/browser-lace
pnpm dev
```

Open http://localhost:5173 in your browser.

## Build for Production

```bash
pnpm build
pnpm preview
```

## Code Overview

### Wallet Connection

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const connection = await Midday.connectWallet('testnet');

// Create client from wallet
const client = await Midday.Client.fromWallet(connection, {
  zkConfigProvider: new Midday.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateProvider: Midday.indexedDBPrivateStateProvider({
    privateStateStoreName: 'my-app',
  }),
});
```

### Contract Interaction

```typescript
// Load and deploy contract
const builder = await Midday.Client.contractFrom(client, {
  module: await import('./contracts/counter/index.js'),
});
const contract = await Midday.ContractBuilder.deploy(builder);

// Call actions
await Midday.Contract.call(contract, 'increment');

// Read state
const state = await Midday.Contract.ledgerState(contract);
```

## Browser-Specific Notes

- **Private State**: Uses IndexedDB for persistent storage
- **ZK Config**: Must be served over HTTPS with proper CORS headers
- **Wallet Signing**: All transactions are signed by Lace wallet

## Next Steps

- See [counter](../counter) for Node.js usage
- See [effect-di](../effect-di) for Effect dependency injection patterns
