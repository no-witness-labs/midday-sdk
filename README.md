# midday-sdk

Developer-friendly SDK for building dapps on Midnight Network.
This project integrates with the Midnight Network.

## Installation

```bash
pnpm add @no-witness-labs/midday-sdk
```

## Quick Start

### Promise API

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from './contracts/counter/contract/index.js';

// Create client
const client = await Midday.Client.create({
  seed: 'your-64-char-hex-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});

// Load and deploy a contract (deploy returns a DeployedContract handle)
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
  privateStateId: 'my-counter',
});
const deployed = await loaded.deploy();
console.log(`Deployed at: ${deployed.address}`);

// Call contract actions (typed)
await deployed.actions.increment();

// Or untyped fallback
await deployed.call('increment');

// Read state
const state = await deployed.readState();
console.log(state.counter);
```

### Effect API

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import * as CounterContract from './contracts/counter/contract/index.js';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.effect.create({
    seed: 'your-64-char-hex-seed',
    networkConfig: Midday.Config.NETWORKS.local,
    privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
  });

  const loaded = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
    privateStateId: 'my-counter',
  });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  const state = yield* deployed.effect.readState();

  return state;
});

const result = await Midday.Runtime.runEffectPromise(program);
```

### Effect DI (Dependency Injection)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';
import { Cluster, ClusterService } from '@no-witness-labs/midday-sdk/devnet';
import { Effect, Layer } from 'effect';

// Layer composition — all lifecycle is automatic
const ClusterLayer = Cluster.managedLayer({ clusterName: 'my-app' });

const ClientFromCluster = Layer.scoped(
  Midday.Client.MiddayClientService,
  Effect.gen(function* () {
    const cluster = yield* ClusterService;
    return yield* Midday.Client.effect.createScoped({
      seed: 'your-64-char-hex-seed',
      networkConfig: cluster.networkConfig,
      privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
    });
  }),
);

const AppLayer = ClientFromCluster.pipe(Layer.provide(ClusterLayer));

const program = Effect.gen(function* () {
  const client = yield* Midday.Client.MiddayClientService;
  const loaded = yield* client.effect.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
  });
  const deployed = yield* loaded.effect.deploy();
  yield* deployed.effect.actions.increment();
  return yield* deployed.effect.readState();
});

// Zero lifecycle code — cleanup is automatic (LIFO: client closes → cluster removes)
const result = await Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```

For simpler cases without devnet management, use `Client.layer()` directly:

```typescript
const ClientLayer = Midday.Client.layer({
  seed: 'your-64-char-hex-seed',
  networkConfig: Midday.Config.NETWORKS.local,
  privateStateProvider: Midday.PrivateState.inMemoryPrivateStateProvider(),
});

const result = await Effect.runPromise(program.pipe(Effect.provide(ClientLayer)));
```

## Browser Usage (Lace Wallet)

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

// Connect to Lace wallet
const wallet = await Midday.Wallet.fromBrowser('preview');

// Create client with connected wallet; the client uses the wallet's network
const client = await Midday.Client.create({
  wallet,
  privateStateProvider: Midday.PrivateState.persistentPrivateStateProvider({
    accountId: wallet.addresses.unshielded,
    password: () => promptForPrivateStatePassword(), // see PrivateState.derivePassword; policy in the API docs
  }),
});

// Load and deploy contract (zkConfig goes in loadContract, not in client)
const loaded = await client.loadContract({
  module: CounterContract,
  zkConfig: new Midday.ZkConfig.HttpZkConfigProvider('https://cdn.example.com/zk'),
  privateStateId: 'my-counter',
});
const deployed = await loaded.deploy();
await deployed.actions.increment();
```

## Wallet Factories

```typescript
// From seed (Node.js) — positional args
const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);
const balance = await wallet.getBalance();

// Persist sync state and resume after a restart instead of resyncing the chain.
// Snapshots contain private wallet data: store them encrypted, never log them.
const snapshot = await wallet.serializeState();
const resumed = await Midday.Wallet.fromSeed(seed, networkConfig, { restoreState: snapshot });

// From browser (Lace extension)
const wallet = await Midday.Wallet.fromBrowser('preview');
const balance = await wallet.getBalance();

// Reading contracts without a wallet: see "Read-Only Client" below
```

## Read-Only Client

```typescript
// No wallet, seed, or proof server required
const reader = Midday.Client.createReadonly({
  networkConfig: Midday.Config.NETWORKS.preview,
});

const counter = reader.loadContract({ module: CounterContract });
const state = await counter.readState(contractAddress);
console.log(state.counter); // 42n
```

## Configuration

### Network Configuration

```typescript
// Local network
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.local,
  // ...
});

// Preview network
const client = await Midday.Client.create({
  networkConfig: Midday.Config.NETWORKS.preview,
  seed: 'your-64-char-hex-seed',
  // ...
});

// Preprod / mainnet are served by Blockfrost and need a project token
const client = await Midday.Client.create({
  networkConfig: Midday.Config.blockfrost('preprod', process.env.BLOCKFROST_PROJECT_ID!),
  seed: 'your-64-char-hex-seed',
  // ...
});

// Custom network
const client = await Midday.Client.create({
  networkConfig: {
    networkId: 'testnet',
    indexer: 'https://indexer.testnet.midnight.network/graphql',
    indexerWS: 'wss://indexer.testnet.midnight.network/graphql/ws',
    node: 'wss://node.testnet.midnight.network',
    proofServer: 'https://proof.testnet.midnight.network',
  },
  seed: 'your-64-char-hex-seed',
  // ...
});
```

## Contract Operations

### Deploy a New Contract

```typescript
const loaded = await client.loadContract({ module, zkConfig, privateStateId: 'my-id' });
const deployed = await loaded.deploy();
console.log(`Deployed at: ${deployed.address}`);

// With timeout
const deployed = await loaded.deploy({ timeout: 60_000 });
```

### Join an Existing Contract

```typescript
const loaded = await client.loadContract({ module, zkConfig, privateStateId: 'my-id' });
const deployed = await loaded.join(contractAddress);

// With timeout
const deployed = await loaded.join(contractAddress, { timeout: 60_000 });
```

### With Witnesses

```typescript
const loaded = await client.loadContract({
  module,
  zkConfig,
  privateStateId: 'my-id',
  witnesses: {
    my_witness_function: myImplementation,
  },
});
const deployed = await loaded.deploy();
```

### Call Actions

```typescript
// Typed — preferred
await deployed.actions.increment();
await deployed.actions.transfer(receiverAddress, 100n);

// Untyped fallback
const result = await deployed.call('increment');
console.log(`TX Hash: ${result.txHash}`);
console.log(`Block: ${result.blockHeight}`);
```

### Read State

```typescript
// Parsed state via ledger
const state = await deployed.readState();

// State at specific block
const historicalState = await deployed.readStateAt(blockHeight);

// Raw state
const raw = await deployed.readStateValue();
```

### Watch State Changes

```typescript
// Callback style
const unsub = deployed.onStateChange((state) => {
  console.log('Counter:', state.counter);
});
// later: unsub();

// Async iterator
for await (const state of deployed.watchState()) {
  console.log('Counter:', state.counter);
  if (state.counter > 10n) break;
}

// Effect Stream
const stream = deployed.effect.watchState();
```

### Transaction Lifecycle

```typescript
// Every action resolves to a FinalizedReceipt once the transaction has landed
const receipt = await deployed.actions.increment(1n);
receipt.txId;        // what the SDK watched (one of receipt.identifiers)
receipt.txHash;      // the enclosing transaction's hash
receipt.status;      // 'SucceedEntirely' | 'FailEntirely' | 'FailFallible'

// Wait for a transaction by id, with timeout; the receipt carries the status
await client.waitForTx(receipt.txId, { timeout: 30_000 });

// deploy() submits and waits; `timeout` bounds the whole pipeline
const deployed = await loaded.deploy({ timeout: 60_000 });

// Or submit first and show progress, then wait for the usable handle
const submitted = await loaded.submitDeploy();
console.log(submitted.address, submitted.txId);
const deployedLater = await submitted.wait({ timeout: 60_000 });
```

## API Reference

### Namespaces

- `Midday.Client` — Client creation, contract loading, read-only client, fee relay
- `Midday.Contract` — Contract types (`LoadedContract`, `DeployedContract`, `ReadonlyContract`)
- `Midday.Config` — Network configuration presets and constants
- `Midday.Wallet` — Wallet factories (`fromSeed`, `fromBrowser`)
- `Midday.PrivateState` — Private state providers (in-memory, IndexedDB)
- `Midday.ZkConfig` — ZK configuration providers (`fromPath`, `HttpZkConfigProvider`)
- `Midday.Hash` — Cryptographic hash utilities
- `Midday.Runtime` — Effect runtime utilities (`runEffectPromise`, `runEffectWithLogging`)
- `Midday.Utils` — Hex encoding, address formatting, coin utilities

### Services (Effect DI)

| Service | Layer | Description |
|---------|-------|-------------|
| `Client.MiddayClientService` | `Client.layer(config)` | Pre-initialized client (scoped — auto-closes) |
| `ClusterService` | `Cluster.managedLayer(config?)` | Managed devnet cluster (auto-starts/removes) |

### Key Types

```typescript
import type {
  // Client
  ClientConfig,
  MiddayClient,
  ReadonlyClient,
  ReadonlyClientConfig,
  WaitForTxOptions,

  // Contract
  LoadedContract,
  DeployedContract,
  ReadonlyContract,
  DeployOptions,
  JoinOptions,
  FinalizedReceipt,
  SubmittedDeploy,
  ContractProviders,

  // Wallet
  ConnectedWallet,
  WalletConnection,
  WalletBalance,
  DustBalance,
  WalletProviders,

  // Config
  NetworkConfig,

  // Errors
  ClientError,
  ContractError,
  WalletError,
} from '@no-witness-labs/midday-sdk';
```

### Error Types

| Error | Module | Description |
|-------|--------|-------------|
| `ClientError` | `Client` | Client creation/operation failures |
| `Client.TxTimeoutError` | `Client` | Transaction timeout (has `txHash`) |
| `ContractError` | `Contract` | Contract deployment/call failures |
| `Contract.TxTimeoutError` | `Contract` | Deploy/join timeout (has `operation`) |
| `WalletError` | `Wallet` | Wallet connection/operation failures |

## Supported Networks and Versions

Midday 0.8 targets **ledger 9**. Preview, Preprod and mainnet run it since their hard forks (mainnet on 6 November 2026, Preprod on 9 November 2026):

| Network | How to configure | Status |
|---------|------------------|--------|
| Local devnet | `NETWORKS.local` / `Cluster.make()` (node 2.1.101, indexer 4.4.101, proof server 9.0.1) | Supported, tested in CI |
| Preview | `NETWORKS.preview` | Supported |
| Preprod | `Config.blockfrost('preprod', projectId)` | Supported |
| Mainnet | `Config.blockfrost('mainnet', projectId)` | Configurable; not tested |

Pinned upstream versions: `@midnight-ntwrk/midnight-js-*` 5.0.0, `compact-runtime` 0.21.0 (peer dependency), `@midnightntwrk/ledger-v9` 1.0.0, wallet SDK 2.0.0 (`@midnightntwrk/wallet-sdk-facade` 5.0.0), Compact compiler 0.36.0. Contracts must be compiled with Compact 0.36.0. Proving needs proof server 9.0.0 or later.

**Consumer requirement:** your install must resolve a single copy of each protocol package. `midnight-js-protocol` pins `@midnightntwrk/ledger-v9` 1.0.0 and `@midnightntwrk/onchain-runtime-v4` 4.0.0, while `compact-runtime` and the wallet SDK accept caret ranges that resolve newer releases, and two copies break contract state decoding with `expected instance of StateValue`. Pin them with overrides (with pnpm 10 and later they belong in `pnpm-workspace.yaml`):

```yaml
overrides:
  "@midnightntwrk/ledger-v9": "1.0.0"
  "@midnightntwrk/onchain-runtime-v4": "4.0.0"
  "@midnight-ntwrk/platform-js": "3.0.0"
```

Check with `pnpm why @midnightntwrk/onchain-runtime-v4`: exactly one version should appear.

## Upgrading to 0.8

- Recompile contracts with Compact 0.36.0 and depend on `@midnight-ntwrk/compact-runtime` 0.21.0. Contracts deployed before a network's ledger 9 fork keep the verifier keys of their old build and are not served by 0.8; deploy them again.
- Serve the `compiler/` directory compactc writes next to `keys/` and `zkir/`. `HttpZkConfigProvider` reads the runtime version from `{baseUrl}/compiler/contract-info.json`.
- Run proof server 9.0.0 or later and indexer 4.4.0-rc.6 or later.
- `Contract.create` requires `networkId` (and takes `txTtlMs`): midnight-js no longer reads a global network id.
- Private state is reached per contract through `provider.forContract(address)`; `setContractAddress` is gone and `PrivateState.boundToContract` is removed. `clearAll()` clears every contract.
- Signing keys are `{ tag: 'schnorr', value }` objects.
- Wallet providers serve ledger 9 transaction handles (`supportedEras: ['v9']`). Code that calls `walletProvider.balanceTx` or `midnightProvider.submitTx` itself passes `LedgerTransaction` handles from `@midnight-ntwrk/midnight-js-types`. `Wallet.balanceAndFinalize` returns the finalized transaction's bytes.
- Wallet snapshots are written by wallet SDK 2.0 and cannot be read by 0.7. A 0.7 snapshot is handed to wallet SDK 2.0, which upgrades 1.x states; if it is refused (`WalletSnapshotError`, `'restore-failed'`), sync from the seed without `restoreState`.

## Upgrading to 0.7

- `NETWORKS.preprod` is gone; Preprod and mainnet are served by Blockfrost: use `Config.blockfrost(network, projectId)`. Keep the project id out of browser bundles.
- `PrivateState.persistentPrivateStateProvider` now requires `accountId` (the wallet address) and `password` (a string or a function returning one) meeting midnight-js's policy: ≥ 16 characters, at least 3 of {lowercase, uppercase, digits, other}, no `aaaa` or `abcd`/`4321` runs. `PrivateState.derivePassword(secret)` derives a compliant one from a 32-byte secret. It is midnight-js's encrypted level provider; state written by the previous store is not migrated.
- `Client.create({ wallet })` follows the wallet's network; a `network`/`networkConfig` that disagrees with the wallet is rejected. The development seed is only implied for the `local` preset.
- `feeRelay` on `Client.create` now applies to browser wallets and is rejected for seed wallets; `FromWalletConfig.txTtlMs` and the unused `storage` option are removed.
- `Client.TxTimeoutError` is the same class as `Contract.TxTimeoutError`.
- Removed: `PrivateState.makeIndexedDB`, `makeInMemory`, the `PrivateState.get/set/...` functions, `PrivateStateService`/`PrivateStateLive`, `Images.build` (use `Images.buildServerImage`).
- Browser-wallet transaction ids are now ledger identifiers instead of the serialized transaction.
- `wallet.address` → `wallet.addresses.{shielded,unshielded}`; `Wallet.deriveAddress` → `deriveUnshieldedAddress`. Use `addresses.unshielded` as the private-state `accountId`.
- State readers renamed: `ledgerState()`/`ledgerStateAt()` → `readState()`/`readStateAt()`; `getState()`/`getStateAt()` → `readStateValue()`/`readStateValueAt()`; `readRawState*`, `onRawStateChange`, `watchRawState` → `readStateValue*`, `onStateValueChange`, `watchStateValue`.
- `PrivateState.indexedDBPrivateStateProvider` → `persistentPrivateStateProvider`; `Wallet.fromAddress`/`ReadonlyWallet` removed (use `Client.createReadonly()`).
- Actions and `client.waitForTx(txId)` return a `FinalizedReceipt` (`txId`, `identifiers`, `txHash`, `status`); `waitForTx` takes the transaction id. `DeployOptions.skipFinalization`/`onSubmit` are replaced by `loaded.submitDeploy()` + `wait()`.
- `onStateChange`/`onStateValueChange` accept `{ next, error }`; new `StateDecodeError`; `IndexerQueryTimeoutError` and `ContractLoadArgsError` surface unwrapped.
- Logging is off by default; pass `logging: true` for debug output. `Hash.stringToBytes32` rejects input over 32 bytes.

## License

MIT
