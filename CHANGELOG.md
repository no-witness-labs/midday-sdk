# @no-witness-labs/midday-sdk

## 0.7.1

### Patch Changes

- 642acba: `persistentPrivateStateProvider` validates a string `password` against midnight-js's policy when the provider is created (≥ 16 characters, at least 3 of {lowercase, uppercase, digits, other}, no run of 4 identical or sequential characters) and fails with a `PrivateStateError` naming the rule. It was previously checked on the first write, which during `deploy()` happens after the deploy transaction has been submitted, leaving a deployed contract whose private state and signing key were never stored. Function passwords are still checked on first use.

  New `PrivateState.derivePassword(secret)`: a deterministic, always-compliant password from a secret of at least 32 bytes, for applications that already hold one. Random strings (hex in particular) fail the policy often enough that deriving a password ad hoc is unsafe.

## 0.7.0

### Minor Changes

- 0c1cd7d: Preprod and mainnet now go through Blockfrost: add `Config.blockfrost(network, projectId)` and `Config.redactUrl()`. The retired `NETWORKS.preprod` preset is removed, and `getNetworkConfig('preprod')` now throws with a pointer to `Config.blockfrost`. Devnet and CI use proof server 8.1.3.
- 5caa100: The devnet faucet and fee-relay Docker images are now built from the SDK itself (`docker/Dockerfile`, `--build-arg SERVER=faucet|fee-relay`) and run the SDK's own `Faucet.startServer` / `FeeRelay.startServer`. The previous images carried a second implementation pinned to ledger-v7 and wallet-sdk 1.0, and the relay image did not serve `/balance-finalized-tx`, the route `FeeRelay.createRelayProvider` calls; so the documented browser fee-relay flow failed against the shipped image. Images are tagged `midday-<server>:<sdk version>` (`Images.serverImage`) and built on first use (`Images.buildServerImage`), so a new SDK version never reuses a stale `:latest`. `Images.build(image, contextPath)` is replaced by `Images.buildServerImage(server, image?)`; `docker/<server>/build.sh` by `docker/build.sh`. `Faucet.startServer` gains `GET /health`. The new `test/devnet.servers.integration.test.ts` starts both containers next to a devnet cluster and funds a wallet through the faucet container; it runs in the e2e workflow.
- 981fe8b: Failures keep their identity, and subscriptions can report theirs.

  - New `Contract.StateDecodeError` (`address`, `cause`): a `ledger()` parser that throws on a state value (wrong contract, wrong compiler cohort, stale artifacts) was previously an unhandled defect outside the typed error channel.
  - State readers fail with `StateReadError = ContractError | ContractStateNotFoundError | StateDecodeError | IndexerQueryTimeoutError`; an indexer query timeout now surfaces as itself instead of wrapped in `ContractError`, so `catchTag('IndexerQueryTimeoutError')` works.
  - `client.loadContract` passes `ContractLoadArgsError` through instead of wrapping it in `ClientError`.
  - `onStateChange` / `onStateValueChange` (deployed and read-only handles, and the module functions) accept a plain callback or `{ next, error }`. Without `error`, a failed subscription still ends silently; with it, you learn that updates stopped and why. Async iteration (`watchState`) already throws the failure from `next()`.
  - A seed wallet whose initial sync fails or is interrupted is closed instead of left running in the background.

- 32119df: - SDK logging is now off by default (`logging: false` on `Client.create`, `Client.fromWallet`, `createReadonly` and contract loading), and `logging: false` is actually silent: it previously still installed a logger at the default level, so informational output kept appearing. Pass `logging: true` for debug output.
  - `Hash.stringToBytes32` (and therefore `Hash.password`) throws a `RangeError` for input longer than 32 UTF-8 bytes instead of truncating it; truncation gave distinct inputs the same commitment.
  - Removed `Utils.parseShieldedAddress`, `Utils.ParsedAddress` and the hand-rolled bech32m decoder: unused, keyed on a `midnight` prefix that Midnight addresses do not have, and it discarded the checksum without checking it. Use `MidnightBech32m.parse` from `@midnight-ntwrk/wallet-sdk-address-format` for address parsing.
  - README: the Effect DI example now passes the required `zkConfig` to `loadContract`.
- b3e8f26: Private state is now stored securely and per contract.

  - `PrivateState.indexedDBPrivateStateProvider` is midnight-js's `levelPrivateStateProvider`: AES-GCM under a PBKDF2-derived key, `superjson` encoding (so `Uint8Array` and `bigint` round-trip), scoped per account and per contract, with password rotation. It requires `accountId` (use the wallet address) and `password` (a string or a function returning one; at least 16 characters, never derived from public data). The previous store XOR-ed JSON with a default password and is not readable by the new provider; state written by it is not migrated.
  - Both providers key state as `${contractAddress}:${privateStateId}`, as midnight-js expects (`setContractAddress` was a no-op before, so two contracts on one provider overwrote each other's state), and fail if no address was set.
  - New `PrivateState.boundToContract(provider, address)`: a view fixed to one contract. Contract handles use it, so several contracts can share a provider without interleaving.
  - Removed: `PrivateState.makeIndexedDB`, `makeInMemory`, the `PrivateState.get/set/...` module functions, `PrivateStateService`/`PrivateStateLive`, and the unused `storage` client option. The `browser-level` dependency is gone.

- fcc9239: Naming made consistent across handles, while the API is still cheap to change:

  - Deployed contracts: `ledgerState()` → `readState()`, `ledgerStateAt()` → `readStateAt()` (same verbs as the read-only handle); `getState()`/`getStateAt()` → `readStateValue()`/`readStateValueAt()`. Everywhere, the decoded-runtime-value variants `readRawState*`, `onRawStateChange`, `watchRawState` → `readStateValue*`, `onStateValueChange`, `watchStateValue`: what they return is a decoded `StateValue`, and "raw" is reserved for the undecoded state midnight-js 5 introduces.
  - `PrivateState.indexedDBPrivateStateProvider` → `persistentPrivateStateProvider` (`PersistentPrivateStateConfig`): it is IndexedDB in browsers and LevelDB on disk in Node.
  - Removed `Wallet.fromAddress`, `ReadonlyWallet` and the `MidnightWallet` union. `fromAddress` wrapped an unvalidated string and could neither query balances nor act as a wallet; `Client.createReadonly()` is the wallet-free way to read contracts.

- 6de9441: Transaction results say what actually happened.

  - Actions and `client.waitForTx` resolve to a `FinalizedReceipt`: `{ phase: 'finalized', txId, identifiers, txHash, blockHeight, blockHash, status }` with `status` typed as `'SucceedEntirely' | 'FailEntirely' | 'FailFallible'`. Previously `CallResult` carried only `txHash`, `blockHeight` and an untyped `status`, `waitForTx` dropped the status entirely (a finalized-but-failed transaction looked like success), and the identifiers the SDK watches by were discarded. `CallResult` remains as a deprecated alias of `FinalizedReceipt`.
  - `client.waitForTx(txId)` takes the transaction id (what the indexer watches by), not the hash; `TxTimeoutError.txHash` → `txId`.
  - `DeployOptions.skipFinalization` and `onSubmit` are removed. The two deploy states now have two shapes: `loaded.deploy(options)` submits and waits (its `timeout` bounds the whole pipeline), and `loaded.submitDeploy(options)` returns `{ phase: 'submitted', address, txId, wait(options?) }` so an application can show progress and obtain the usable handle later. `wait()` resolves only for `SucceedEntirely`.

- 159498a: Add seed-wallet balance pool selection, support unshielded devnet faucet requests, and align the wallet/Compact toolchain with the supported Midnight release matrix.
- 3e3cfdd: Transaction TTLs are now anchored after the wallet has finished syncing, so a slow sync can no longer consume the TTL before balancing (the node then rejected the intent with error 182 after proving). A caller-supplied TTL that has already passed by then fails immediately instead of being submitted.

  Client options that were silently ignored are now wired or rejected: `Client.create({ wallet, feeRelay })` applies the relay for browser wallets (previously only `Client.fromWallet` did, so the documented `create` form paid fees from the user's wallet) and fails for seed wallets, which cannot balance without fees; `txTtlMs` applies on the `create({ wallet })` path (new `Wallet.ProvidersOptions`); `txTtlMs` is removed from `FromWalletConfig` because browser wallets set their own TTL.

  `TxTimeoutError` is one class for the whole SDK (`Client.TxTimeoutError === Contract.TxTimeoutError`) with `operation: 'deploy' | 'join' | 'waitForTx'` and an optional `txHash`, instead of two classes sharing a `_tag`.

- d5ad36e: `ConnectedWallet.address` is replaced by `addresses: { shielded, unshielded }`. The single `address` meant different things by wallet source — the unshielded address for seed wallets and the shielded one for browser wallets — so code written against one source silently sent funds to the wrong pool on the other. Both addresses are now available for both sources (the browser wallet's unshielded address is read from the connector at connect time). `Wallet.deriveAddress` is renamed `deriveUnshieldedAddress` to say which one it derives. Use `addresses.unshielded` as the `accountId` for the persistent private-state provider.
- 219857f: `ConnectedWallet` now carries `networkId` (and `networkConfig` for seed wallets), and `Client.create({ wallet })` uses the wallet's network instead of defaulting to `local`: the documented browser flow (`Wallet.fromBrowser('preview')` then `Client.create({ wallet, ... })`) previously produced a client pointed at local endpoints. A `network` or `networkConfig` that disagrees with the wallet is rejected, and a wallet on a network without a built-in preset (Preprod) asks for `Config.blockfrost(...)`.

  Docs: README gains a supported-networks and pinned-versions matrix, the consumer `onchain-runtime-v3` requirement, and an "Upgrading to 0.7" section; the installation page states Node 22 and the `compact-runtime` peer dependency; the services table no longer lists the removed `ClientService`/`ClientLive`; `@since` tags that named unreleased versions now carry the version recorded in the changelog or were dropped.

- 1107835: Seed wallets can persist and resume their sync state: `wallet.serializeState()` exports a versioned snapshot (network ID, format version, wallet SDK package versions, shielded/unshielded/DUST state and transaction history), and `Wallet.fromSeed(seed, config, { restoreState })` resumes from it instead of syncing from genesis. Invalid, corrupt, foreign-network or foreign-seed snapshots fail with the new `WalletSnapshotError` rather than silently resyncing. `WalletContext` now carries `txHistoryStorage`. Snapshots contain private wallet data; store them encrypted.

### Patch Changes

- b14788a: CI now runs lint and the Docker-free unit suite (`pnpm test:unit`) on every push and pull request; previously only type-check, build and the devnet e2e ran, so the config, wallet and private-state unit tests were never executed in CI.

  The bundled `secret-counter` example contract tracks initialization with an explicit `initialized` flag. The previous guard compared `password_hash` with its default, so an `init` with the zero hash could be followed by a second `init` with any hash (#59). Artifacts recompiled with Compact 0.31.1.

- e92a335: Fixes two defects that only show up in a fresh consumer install, not in this workspace:

  - Every clean install resolved **two** copies of `@midnight-ntwrk/onchain-runtime-v3` (`midnight-js-protocol` pins 3.0.0, `compact-runtime` accepts `^3.0.0` and got 3.1.2), which breaks contract state decoding with `expected instance of StateValue`. The SDK now declares `@midnight-ntwrk/onchain-runtime-v3@3.0.0` as a peer dependency; package managers that auto-install peers resolve one copy with no extra configuration. The documented fallback is corrected too: with pnpm 10+ an override belongs in `pnpm-workspace.yaml` (the `pnpm.overrides` field in `package.json` is ignored there), or add the pinned version as a direct dependency.
  - `Images.buildServerImage` could not build the faucet/fee-relay images from an installed package: the Dockerfile copied sources and workspace manifests that are not published. The Dockerfile now builds from `package.json` and `dist/` with dependencies from the registry, so it works from a checkout (after `pnpm build`) and from `node_modules/@no-witness-labs/midday-sdk` alike.

  New `test/consumer.integration.test.ts` packs the SDK, installs it into a clean project and asserts a single runtime copy and a working import; it runs in CI.

- 5b8cc1a: Devnet now runs the ledger-8 compatibility set: `midnight-node:1.0.400` and `indexer-standalone:4.3.7` (proof server 8.1.3). The indexer gets the SPO node settings it now requires, the cluster waits for the node's first block before starting the indexer, and proof server readiness is checked via `/ready` instead of an open port.
- 42dedad: Indexer queries made through `Config.publicDataProvider` (and so every client) now fail with `IndexerQueryTimeoutError` after 60 s instead of waiting forever on a stalled connection, which could hang a contract call before proving. Set `queryTimeoutMs` to change the bound; `Config.withQueryTimeout` applies it to any provider.
- 7a86606: `Client.create` no longer implies the public development seed when a custom `networkConfig` is given: the seed is only implied for the built-in `local` preset, and is refused outright (even when passed explicitly) on any network other than `undeployed`. A `network` preset name that contradicts `networkConfig.networkId` is rejected on `create` and `createReadonly` instead of silently using the custom endpoints under the other network's name.
- cb2f011: The `preview` network preset now uses the documented indexer path `/api/v4/graphql` (and `/api/v4/graphql/ws`). It serves the same GraphQL schema as `/api/v3`.
- 97c1c44: Closes the remaining way a private-state operation could be redirected to another contract. `boundToContract` views serialize their operations, but the view's own `setContractAddress` (which midnight-js calls right before every access) still moved the shared address outside that queue, so an operation parked on the level provider's internal await could pick up another contract's address. The view's `setContractAddress` now only validates the requested address; the address is bound exclusively inside each queued operation. Regression test uses a provider whose `set` awaits before reading the address, so the interleaving is deterministic.
- ec8c912: Fixes cross-contract private-state corruption with the persistent provider. `PrivateState.boundToContract` re-bound the shared provider's address synchronously before each call, but midnight-js's level provider awaits a rotation lock before it reads the address in `set`/`remove`, so a concurrent operation from another contract's view could move the address in between and a write for contract A landed under contract B. Views bound to the same underlying provider now take turns: each operation re-binds its address and completes before the next starts.
- f9df358: Two private-state fixes.

  - `join(address)` no longer wipes stored private state. It passed `initialPrivateState: {}` by default, and midnight-js replaces the stored state whenever that option is present, so an application that persisted state, restarted and joined its contract lost the state. `initialPrivateState` is now only passed when the caller supplies it (a deliberate replacement) or when nothing is stored yet (first join, `{}`).
  - `PrivateState.boundToContract` views spell out every method instead of spreading the shared provider. `exportPrivateStates`/`importPrivateStates` run inside the view's queue bound to its contract (previously they used whatever address the shared provider happened to hold); `clear()` on a view is refused with an explanation, since the underlying `clear` erases every contract's state in the store; signing-key methods pass through (they take an explicit address).

- 975a692: Browser-wallet submissions now return a real transaction identifier (`tx.identifiers()[0]`, the id the indexer watches by) instead of the serialized transaction hex; this applies to `ConnectedWallet.providers().midnightProvider.submitTx` and to `shield`/`unshield` results. New `Wallet.transactionIdOf(tx)`.

  `deploy()` now checks the finalized status: a deploy transaction that lands with anything other than `SucceedEntirely` fails with a `ContractError` naming the address, tx id and status, instead of returning a handle for a contract that does not exist. The `skipFinalization` option no longer installs a fake `{ status: 'submitted' }` watcher for later calls; midnight-js rejects any call whose watched status is not `SucceedEntirely`, so that stub made every call after a `skipFinalization` deploy fail.

## 0.6.4

### Patch Changes

- Bump Midnight dependency stack for preview/preprod wallet-sync compatibility: `compact-js` 2.5.1, `compact-runtime` 0.16.0, `midnight-js-*` 4.1.1, wallet dust/facade/shielded/unshielded packages, and Node engine >=22.
- Recompile bundled counter and secret-counter Compact artifacts with `COMPACTC_VERSION=0.31.0` / `run-compactc`.
- Run Vitest suites with `--no-file-parallelism` to avoid wallet/devnet state races.

## 0.6.3

### Patch Changes

- 7203881: Add finer-grained `Data.TaggedError` subtypes across `Wallet`, `Contract`, and `ZkConfig`, replacing 14 raw `throw new Error(...)` calls that previously collapsed into a single catch-all `*Error.cause` string.

  **New error classes (all `Data.TaggedError`):**

  `Wallet`:

  - **`WalletKeyDerivationError`** — `HDWallet.fromSeed` / `deriveKeysAt` failure. Field `phase: 'init' | 'derive'`.
  - **`LaceUnavailableError`** — Lace extension missing or too old. Field `reason: 'not-installed' | 'incompatible-version'`.
  - **`LaceTransferError`** — `balanceUnsealedTransaction` rejected by Lace. Field `operation: 'balance'`, `detail` carries joined `APIError` fields.
  - **`TransactionDeserializeError`** — `ledger.Transaction.deserialize` failed on Lace-returned bytes (typically version skew). Field `bytesLength`.
  - **`DustRegistrationError`** — no eligible NIGHT UTXOs to (de)register for DUST generation. Field `direction`, `reason: 'no-eligible-utxos'`.

  `Contract`:

  - **`ContractStateNotFoundError`** — `queryContractState` returned no result. Field `address`, optional `blockHeight`. Surfaces from `getState`/`getStateAt`/`ledgerState`/`ledgerStateAt` and the `Readonly` `readState`/`readStateAt`/`readRawState`/`readRawStateAt` variants. Distinct from `ContractError` because consumers may want "not yet deployed → redirect to create flow" UX.
  - **`ContractLoadArgsError`** — `loadContract` called without one of the required argument shapes (`module` + `zkConfig`, `path`, or `moduleUrl` + `zkConfigBaseUrl`).

  `ZkConfig`:

  - **`ZkConfigFetchError`** — HTTP fetch for a ZK key returned a non-ok response. Fields `url`, `status`, `statusText`.

  `WalletError`, `ContractError`, and `ZkConfigError` are **unchanged** and remain the catch-all for genuinely-unclassified upstream failures. Effect signatures on affected paths widen to union types (e.g., `Effect.Effect<ShieldResult, WalletError | LaceUnavailableError>`, `Effect.Effect<unknown, ContractError | ContractStateNotFoundError>`, `Effect.Effect<ZKIR, ZkConfigError | ZkConfigFetchError>`). Additive at the type level:

  - Effect consumers using `catchAll` or no explicit error annotation are unaffected.
  - Effect consumers using `catchTag('WalletError', ...)` continue to work; new tags become opt-in handlers.
  - Promise consumers (`await wallet.shield(...)`) see the same rejection shape — the `_tag` field on the rejection now takes on more values.

## 0.6.2

### Patch Changes

- 231f106: Bump `@midnight-ntwrk/ledger-v8` from 8.0.3 to 8.1.0 (stable), with the bundled devnet images moved in lockstep.

  - `@midnight-ntwrk/ledger-v8` `8.0.3` → `8.1.0` (the stable successor to 8.0.3; previously only `8.1.0-rc.1`). ABI/type-compatible — no public API changes; satisfies `@midnight-ntwrk/wallet-sdk-facade@4.0.0`'s `^8.0.3`. The `pnpm.overrides` pin is bumped in lockstep so transitive copies resolve to a single 8.1.0.
  - Devnet defaults (`src/devnet/Config.ts`): `proof-server` `8.0.3` → `8.1.0` (proof-server version is coupled to the ledger version; an 8.1.0 client cannot prove against `proof-server:8.0.3`) and `midnight-node` `0.22.3` → `0.22.5` (latest 0.22.x stable) for alignment.

## 0.6.1

### Patch Changes

- 46e483e: Remove `signTransactionIntents` workaround in favor of upstream `WalletFacade.signRecipe`.

  The workaround predated `wallet-sdk-unshielded-wallet@1.0.0`, where `addSignature` hard-coded the `'pre-proof'` proof marker even when cloning intents that already carried `'proof'` after balancing — causing `Failed to clone intent` at finalize time. `wallet-sdk-facade@4.0.0` (in the 2026-04-23 release batch) fixes this by routing the proven base transaction through `signUnboundTransaction` and the unproven balancer through `signUnprovenTransaction`, each with the correct marker. `signRecipe` now produces the same output as the manual hand-rolled path.

  Internal-only cleanup. No public API change. Validated against the contract and witness-contract E2E suites (9/9 passing) covering deploy + circuit-call flows.

## 0.6.0

### Minor Changes

- e5cb746: Bump Midnight wallet-sdk packages to the 2026-04-23 release batch:

  - `wallet-sdk-facade` 3.0.0 → 4.0.0
  - `wallet-sdk-dust-wallet` 3.0.0 → 4.0.0
  - `wallet-sdk-shielded` 2.1.0 → 3.0.0
  - `wallet-sdk-unshielded-wallet` 2.1.0 → 3.0.0
  - `wallet-sdk-address-format` 3.1.0 → 3.1.1
  - `wallet-sdk-hd` 3.0.1 → 3.0.2
  - adds `wallet-sdk-abstractions` 2.1.0 (now hosts `InMemoryTransactionHistoryStorage`)

  Includes the upstream deterministic-segment-id fix in the dust-wallet balancer (replaces `Transaction.fromPartsRandomized` with collision-free segment selection), retiring the previous segment_id collision / balanceTx hang workaround.

  `InMemoryTransactionHistoryStorage` now requires a schema argument; the SDK passes `WalletEntrySchema` + `mergeWalletEntries` from `wallet-sdk-facade` at every facade init site.

### Patch Changes

- 70c4497: Fix `Wallet.getBalance().dust` reporting zero on seed-backed wallets.

  `getBalanceFromSeedEffect` was calling `state.dust.walletBalance(time)` and `state.dust.walletCap(time)`, neither of which exist on `DustWalletState`. Optional chaining (`?.`) silently returned `undefined` and the `?? 0n` fallback masked the bug — `wallet.getBalance().dust.balance` always showed `0` even when DUST was present, which made it look like every faucet-funded wallet was missing DUST registration.

  The real APIs are `state.dust.balance(time: Date): bigint` and `state.dust.availableCoinsWithFullInfo(time: Date): readonly DustFullInfo[]` (sum `.maxCap` for total capacity). Fixed both.

  Downstream effect: apps using `Wallet.getBalance().dust.balance` for UI display will now show real values. Fee-paying wallet operations were never affected (the underlying facade balancer always saw real DUST), only the query display.

- 70c4497: Fix `Wallet.shield()` and `Wallet.unshield()` failing with `Wallet.InsufficientFunds` on freshly-funded wallets.

  The previous implementation used `wallet.transferTransaction()` with an output of `type: 'shielded'` for shielding (and `'unshielded'` for unshielding). `transferTransaction` selects inputs from the **same pool** as the output kind — so for `type: 'shielded'` it can only spend shielded UTXOs. On a wallet with NIGHT only in the unshielded pool (every freshly-faucet'd wallet), this returned `Insufficient funds` because there were no shielded UTXOs to spend.

  The correct API for cross-pool conversion is `wallet.initSwap(desiredInputs, desiredOutputs, secretKeys, options)`, which takes explicit per-pool input and output specifications. The fix uses `initSwap` for both `shield` (unshielded inputs → shielded outputs) and `unshield` (shielded inputs → unshielded outputs).

  Why this wasn't caught earlier: on local devnet with the genesis seed, the wallet has _both_ shielded and unshielded NIGHT pre-funded, so the old `transferTransaction(shielded → shielded)` call happened to find shielded UTXOs to spend — semantically a no-op move within the same pool, but it didn't error. Real wallets funded only via faucet (preview/preprod) hit the bug immediately.

- 70c4497: Add `ConnectedWallet.registerDust()` and `ConnectedWallet.deregisterDust()` helpers as an escape hatch for managing DUST generation from unshielded NIGHT UTXOs.

  ```ts
  const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);

  // Register all currently-unregistered NIGHT UTXOs for DUST generation.
  const { txId, count } = await wallet.registerDust();
  console.log(`Registered ${count} NIGHT UTXOs. tx=${txId}`);

  // Or register a specific subset:
  await wallet.registerDust({ utxos: [...] });

  // Inverse:
  await wallet.deregisterDust();
  ```

  **When this is needed.** In practice, **rarely**. Midnight's preview/preprod faucets and local devnet genesis already register NIGHT for DUST generation at mint time — all UTXOs arrive with `meta.registeredForDustGeneration: true`. This helper is an escape hatch for wallets that acquired NIGHT via a path that skipped registration (e.g., a contract payout, a direct transfer from another wallet), or for ops scripts that want to deregister before transferring NIGHT out.

  Calling `registerDust()` on a wallet whose NIGHT is already fully registered throws a clear error instead of submitting a no-op tx.

  **Seed-backed wallets only.** The Lace DApp Connector does not expose DUST registration programmatically; Lace users must register via the extension UI. Calling `registerDust()` on a browser-backed wallet throws a clear error directing to the UI.

## 0.5.0

### Minor Changes

- Add `ConnectedWallet.shield(amount)` and `ConnectedWallet.unshield(amount)` helpers for moving NIGHT (or any token) between the shielded and unshielded pools of the same wallet.

  Works on both seed and browser (Lace) backends. Required before interacting with shielded contracts (e.g. `receiveShielded`) when the wallet was funded via a faucet — preview/preprod faucets only deposit to the unshielded address, so users must self-shield before making shielded contract calls.

  ```ts
  const wallet = await Midday.Wallet.fromBrowser("preview");
  const bal = await wallet.getBalance();
  if (!bal.shielded[Midday.Utils.getNativeTokenColor()]) {
    await wallet.shield(1_000_000_000n); // 1 tNIGHT
  }
  ```

  Browser backend uses the Lace DApp Connector's `makeTransfer` (added to `ConnectedAPI` interface). Lace ≥ Midnight DApp Connector 4.0 is required; an explicit error is thrown on older versions.

### Patch Changes

- 545faae: Skip HTTP fetch for built-in ZK circuits (midnight/zswap/\*) in HttpZkConfigProvider to avoid noisy 404s in browser console

## 0.4.2

### Patch Changes

- Add skipFinalization option to DeployOptions

  - When `skipFinalization: true`, deploy returns immediately after tx submission
  - Contract handle is fully functional once the deploy tx lands on-chain
  - Useful for browser dapps where indexer finalization watch may fail

## 0.4.1

### Patch Changes

- Split deploy flow to show contract address before finalization

  - Use createUnprovenDeployTx + submitTxAsync instead of deployContract
  - onSubmit callback now fires with both address and txId after submission
  - Fixes browser dapps not seeing contract address until finalization completes

## 0.4.0

### Minor Changes

- 4d7b4b0: Upgrade all @midnight-ntwrk dependencies to latest stable releases

  - midnight-js-\* 3.1.0 → 4.0.2
  - wallet-sdk-facade 2.0.0-rc.3 → 3.0.0
  - wallet-sdk-dust-wallet 2.0.0-rc.5 → 3.0.0
  - wallet-sdk-shielded 2.0.0-rc.4 → 2.1.0
  - wallet-sdk-unshielded-wallet 2.0.0-rc.4 → 2.1.0
  - wallet-sdk-address-format 3.0.0 → 3.1.0
  - wallet-sdk-hd 3.0.0 → 3.0.1
  - compact-js 2.4.2 → 2.5.0
  - compact-runtime 0.14.0 → 0.15.0
  - ledger-v7 7.0.2 → ledger-v8 8.0.3
  - Add PrivateStateProvider export/import signing keys stubs
  - Add provider instrumentation logging for deploy/join lifecycle
  - Add CAIP-372 wallet discovery for Lace v2.36.0+

## 0.3.2

### Patch Changes

- 8b46361: fix: workaround wallet-sdk intent signing bug

## 0.3.1

### Patch Changes

- fa345fb: fix: use dynamic import instead of require for browser compatibility

## 0.3.0

### Minor Changes

- d883ee1: Simplify Client module and improve API ergonomics

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

## 0.2.14

### Patch Changes

- 565fa70: ### Flat Module Structure

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

## 0.2.13

### Patch Changes

- d6712f6: fix: replace require() with await import() in Client.ts to prevent bundlers from statically following import chains into WASM/Node.js packages

## 0.2.12

### Patch Changes

- 336dbbe: Auto-build faucet/fee-relay Docker images inside SDK

  - Add `Images.build()` for building Docker images from local context
  - Auto-build in `Faucet.startDocker()` and `FeeRelay.startDocker()` when image is missing
  - Ship `docker/` build contexts in npm package
  - Remove `ensureDockerImage()` boilerplate from examples and template

- a9b0411: fix: replace require() with await import() in Client.ts to prevent bundlers from statically following import chains into WASM/Node.js packages

## 0.2.11

### Patch Changes

- 42cc7e7: Add example projects, dockerized faucet/fee-relay, and devnet infrastructure

  - Add example projects: counter, browser-lace, effect-di, devnet-testing
  - Add dockerized faucet server for funding wallets on local devnet
  - Add dockerized fee relay server with browser-lace toggle
  - Add HTTP ZK config provider
  - Update CI to build example projects

## 0.2.10

### Patch Changes

- 9925369: Add example projects, dockerized faucet/fee-relay, and devnet infrastructure

  - Add example projects: counter, browser-lace, effect-di, devnet-testing
  - Add dockerized faucet server for funding wallets on local devnet
  - Add dockerized fee relay server with browser-lace toggle
  - Add HTTP ZK config provider
  - Update CI to build example projects

## 0.2.9

### Patch Changes

- eb97dec: Add resource cleanup APIs to prevent leaked WebSocket connections

  - Add `client.close()` to gracefully stop wallet sync and release connections
  - Add `Client.withClient()` bracket pattern for guaranteed cleanup
  - Add `Symbol.asyncDispose` support for `await using` syntax
  - Add `effect.createScoped()` and `effect.withClient()` for Effect users

  ```typescript
  // Recommended: withClient bracket — cleanup is automatic
  await Midday.Client.withClient(config, async (client) => {
    const contract = await client.loadContract({ path: "./contracts/counter" });
    await contract.deploy();
    await contract.call("increment");
  });
  // client.close() called automatically, even if body throws

  // Manual close — when you need the client to outlive a single callback
  const client = await Midday.Client.create(config);
  try {
    const contract = await client.loadContract({ path: "./contracts/counter" });
    await contract.deploy();
  } finally {
    await client.close(); // stops wallet sync, releases WebSocket connections
  }

  // Modern: await using (TS 5.2+, Node 22+)
  await using client = await Midday.Client.create(config);
  // client[Symbol.asyncDispose]() called at block exit

  // Effect: scoped resource
  const program = Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Midday.Client.effect.createScoped(config);
      const contract = yield* client.effect.loadContract({ module });
      yield* contract.effect.deploy();
    })
  );
  // wallet stopped when scope closes
  ```

  - Fix noisy `Wallet.Sync` errors on shutdown by closing wallets before teardown

## 0.2.8

### Patch Changes

- 63c9a5c: Add compact-runtime as peerDependency

  User-compiled Compact contracts import `@midnight-ntwrk/compact-runtime` directly.
  With pnpm's strict isolation, this must be declared as a peerDependency so users
  know to install it alongside the SDK.

## 0.2.7

### Patch Changes

- 9c15c78: Upgrade to v7 Midnight devnet stack

  - Docker: node 0.20.1, indexer 3.0.0, proof-server 7.0.0
  - NPM: compact-runtime 0.14.0, ledger-v7 7.0.0, midnight-js-\* 3.0.0
  - Compact: compactc v0.28.0, language_version 0.20
  - Breaking: deployContract/joinContract require CompiledContract.make() wrapper

## 0.2.6

### Patch Changes

- 122643f: Add type-safe contract inference

  Contract types are now automatically inferred from your Compact module:

  ```typescript
  import * as CounterContract from "./contracts/counter/contract";

  const contract = await client.loadContract({
    module: CounterContract,
    zkConfig: Midday.ZkConfig.fromPath("./contracts/counter"),
  });

  // ledgerState() returns typed Ledger - no cast needed
  const state = await contract.ledgerState();
  console.log(state.counter); // bigint

  // call() autocompletes circuit names
  await contract.call("increment"); // 'increment' | 'decrement'
  ```

  New type utilities:

  - `InferLedger<M>` - extract ledger type from module
  - `InferCircuits<M>` - extract circuit names as union type

## 0.2.5

### Patch Changes

- 24bfb2d: Restructure SDK to namespace-only exports for cleaner API surface.

  All exports are now accessed via namespaces:

  ```typescript
  import * as Midday from '@no-witness-labs/midday-sdk';

  Midday.Client.create({ ... });
  Midday.PrivateState.inMemoryPrivateStateProvider();
  Midday.Hash.bytes32(value);
  ```

  New modules: `Hash`, `ZkConfig`, `PrivateState`, `Runtime`, `Utils`, `BrowserWallet`

## 0.2.4

### Patch Changes

- 79033fc: Add comprehensive E2E testing infrastructure

  - Add E2E test suite for contract deployment lifecycle
  - Add counter contract for testing with Compact source and compiled artifacts
  - Add waitForIndexerSynced utility for genesis dust availability
  - Add Docker healthchecks matching docker-compose configuration
  - Add GitHub Actions workflow for E2E tests
  - Fix SigningKey type in IndexedDBPrivateStateProvider
  - Pin onchain-runtime-v1 to 1.0.0-alpha.5 for compatibility

## 0.2.3

### Patch Changes

- 58d6f11: Migrate logging to Effect's built-in Logger layer

  - Replace custom `Logger` interface with `Effect.logDebug` for SDK internals
  - Add `SdkLogger` module with pre-configured layers (`pretty`, `json`, `logFmt`, `none`)
  - Add `runEffectWithLogging(effect, logging)` helper for Promise API
  - Remove `LoggerService` from Config (use Effect Logger layers instead)

  **Breaking:** SDK logs are now debug-level and hidden by default.

  To see SDK debug logs:

  ```typescript
  import { Effect } from "effect";
  import {
    ClientService,
    ClientLive,
    SdkLogger,
  } from "@no-witness-labs/midday-sdk";

  const program = Effect.gen(function* () {
    const clientService = yield* ClientService;
    const client = yield* clientService.create(config);
  });

  Effect.runPromise(
    program.pipe(
      Effect.provide(ClientLive),
      Effect.provide(SdkLogger.pretty),
      Effect.provide(SdkLogger.withDebug)
    )
  );
  ```

  Or with Promise API:

  ```typescript
  import { Client } from "@no-witness-labs/midday-sdk";

  const client = await Client.create({
    logging: true,
    seed: "...",
    zkConfigProvider,
    privateStateProvider,
  });
  ```

## 0.2.2

### Patch Changes

- 2ec54ed: Add `MidnightClientService` and `Client.layer(config)` for Effect DI

  - Add `MidnightClientService` Context.Tag for pre-initialized client injection
  - Add `Client.layer(config)` to create a Layer with pre-configured client (matches `Cluster.layer(config)` pattern)
  - Add `Client.layerFromWallet(connection, config)` for browser wallet integration
  - Rename `Client.layer()` → `Client.services()` to clarify it provides factory services

## 0.2.1

### Patch Changes

- f329952: Add Effect TS integration with browser wallet support

  **New Features:**

  - Dual API pattern: Promise-based and Effect-based for all modules
  - Browser wallet connector for Lace wallet integration via DAppConnectorAPI v4
  - `HttpZkConfigProvider` module for loading ZK artifacts from HTTP endpoints
  - `IndexedDBPrivateStateProvider` for browser-based private state persistence
  - `inMemoryPrivateStateProvider` for testing/Node.js environments
  - Effect runtime utilities (`runEffect`, `runEffectPromise`) with clean stack traces
  - Service tags for dependency injection (`ClientService`, `WalletService`, `ProvidersService`, etc.)
  - Tagged error types colocated with modules (`ClientError`, `WalletError`, `ProviderError`, etc.)
  - Utility modules: `hex`, `address`, `coin` helpers

  **Usage:**

  ```typescript
  // Browser with Lace wallet (Promise-based)
  import * as Midday from "@no-witness-labs/midday-sdk";

  const connection = await Midday.connectWallet("testnet");
  const client = await Midday.Client.fromWallet(connection, {
    zkConfigProvider: new Midday.HttpZkConfigProvider(
      "https://cdn.example.com/zk"
    ),
    privateStateProvider: Midday.indexedDBPrivateStateProvider({
      privateStateStoreName: "my-app",
    }),
  });

  // Effect-based usage
  const program = Effect.gen(function* () {
    const client = yield* Midday.Client.effect.create(config);
    const builder = yield* Midday.Client.effect.contractFrom(client, {
      module,
    });
    const contract = yield* Midday.ContractBuilder.effect.deploy(builder);
    return yield* Midday.Contract.effect.call(contract, "increment");
  });
  ```

## 0.2.0

### Minor Changes

- 32b87ff: Add devnet module for local development and testing

  **New Features:**

  - `Cluster` module with instance-based API for managing devnet lifecycle
  - `Container` module for Docker container operations
  - `Health` module for service health checks (node, indexer, proof server)
  - `Images` module for Docker image management
  - `Config` module with sensible defaults for Midnight Network stack
  - Tagged error types (`ClusterError`, `ContainerError`, `HealthCheckError`)
  - Service tags for dependency injection (`ClusterService`, `ContainerService`, `HealthService`)

  **Usage:**

  ```typescript
  import { Cluster } from "@no-witness-labs/midday-sdk/devnet";

  const cluster = await Cluster.make();
  await cluster.start();
  console.log(cluster.networkConfig);
  await cluster.remove();
  ```

## 0.1.2

### Patch Changes

- 816ea03: address derivation

## 0.1.1

### Patch Changes

- 60510c3: midday sdk the first verion
