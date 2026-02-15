---
"@no-witness-labs/midday-sdk": minor
---

Simplify Client module and improve API ergonomics

### Breaking Changes

- Removed deprecated exports: `ClientService`, `ClientServiceImpl`, `ClientLive`, `services()`, `ClientData`, `ContractState`, `Contract` (legacy union type), `ContractData`, `createContractHandle`
- Removed deprecated Promise wrappers from Wallet: `init()`, `waitForSync()`, `close()`, `providers()`, `connectWallet()`, `disconnectWallet()`
- Removed `wallet` and `relayerWallet` properties from `MiddayClient` handle
- `layerFromWallet` no longer accepts `zkConfigProvider` in its config

### New Features

- **`FeeRelay` module** — centralised fee relay logic (seed-based and HTTP-based) extracted from Client
- **`DeployedContractFor<M>`** — convenience type alias for fully-typed deployed contracts
- **`LoadedContractFor<M>`** — convenience type alias for fully-typed loaded contracts
- **`FromWalletConfig`** — dedicated config interface for `Client.fromWallet()`
- **`effect.fromWalletScoped`** — scoped variant for browser wallet connections
- **Configurable `txTtlMs`** — transaction TTL now configurable via `ClientConfig`, `FromWalletConfig`, and fee relay options (default: 30 minutes via `Config.DEFAULT_TX_TTL_MS`)

### Improvements

- Client internals simplified: removed `ClientData` indirection, `closeClientEffect`, and duplicated provider assembly logic
- Scoped variants (`createScoped`, `fromWalletScoped`) now reuse the Effect path via `acquireRelease` instead of duplicating logic
- `Effect.orDie` replaces `Effect.ignore`/`Effect.catchAll` in acquireRelease release functions — close failures are now visible defects
- `layerFromWallet` reuses `effect.fromWalletScoped` instead of duplicating the pipeline
- All internal module imports follow Effect-style `import * as Module` pattern with qualified type access
- All tests and JSDoc examples updated to use typed `contract.actions.*()` instead of untyped `contract.call()`
