---
"@no-witness-labs/midday-sdk": patch
---

Add finer-grained `Data.TaggedError` subtypes across `Wallet`, `Contract`, and `ZkConfig`, replacing 14 raw `throw new Error(...)` calls that previously collapsed into a single catch-all `*Error.cause` string.

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
