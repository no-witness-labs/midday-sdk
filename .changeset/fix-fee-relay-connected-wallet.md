---
"@no-witness-labs/midday-sdk": patch
---

### Flat Module Structure

Restructured the SDK from nested folders into 9 flat modules: `Client`, `Contract`, `Config`, `Wallet`, `PrivateState`, `ZkConfig`, `Hash`, `Runtime`, `Utils`. All imports now use `Midday.Module.method()` pattern.

### Contract Split & Typed Actions

- Split contract into two-handle pattern: `LoadedContract` (after load) → `DeployedContract` (after deploy/join)
- Added typed `deployed.actions.increment()` proxy (no more untyped `call()` for common operations)
- Added `ReadonlyContract` for state queries without wallet/proofs

### Event & Subscription System

- `deployed.onStateChange(callback)` — callback-based state watching
- `deployed.watchState()` — async iterator for state changes
- `deployed.effect.watchState()` — Effect Stream variant

### Transaction Lifecycle

- `client.waitForTx(txHash, { timeout })` — wait for transaction finalization
- `deployed.deploy({ timeout })` / `deployed.join(address, { timeout })` — deploy/join with timeout
- `TxTimeoutError` with `txHash` or `operation` for debugging

### Scoped Resource Management (Effect)

- `Client.layer()` now uses `Layer.scoped` — client auto-closes when scope ends
- `Client.layerFromWallet()` now uses `Layer.scoped` with `acquireRelease`
- `Client.effect.createScoped()` — creates a scoped client Effect resource
- `Cluster.effect.makeScoped()` — creates a scoped devnet cluster (acquireRelease: start/remove)
- `Cluster.managedLayer()` — fully managed devnet layer (auto-starts/removes)

### Wallet Enhancements

- `ConnectedWallet.coinPublicKey` — public key for coin operations
- `ConnectedWallet.encryptionPublicKey` — public key for encryption
- `WalletBalance.dust` is now `DustBalance { balance: bigint; cap: bigint }` (breaking)
- `Wallet.fromBrowser()` uses v4 API (`getShieldedAddresses`)

### Fee Relay Fix

- Fixed `Client.create({ wallet, feeRelay: { url } })` silently ignoring the fee relay config when using a pre-created `ConnectedWallet` — browser wallets can now use the fee relay for transaction balancing

### DevNet Tooling

- `Faucet.startDocker()` / `Faucet.startServer()` — fund wallets on local devnet
- `FeeRelay.startDocker()` / `FeeRelay.startServer()` — genesis wallet pays fees for browser wallets
- Auto-builds Docker images on first use

### Examples

- `counter` — Promise API end-to-end (deploy, increment, read state)
- `effect-di` — Pure layer composition with `Cluster.managedLayer()` and `Client.effect.createScoped()`
- `browser-lace` — Lace wallet integration with fee relay and faucet
- `devnet-testing` — DevNet cluster management with faucet and fee relay servers
