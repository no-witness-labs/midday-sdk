---
'@no-witness-labs/midday-sdk': minor
---

Private state is now stored securely and per contract.

- `PrivateState.indexedDBPrivateStateProvider` is midnight-js's `levelPrivateStateProvider`: AES-GCM under a PBKDF2-derived key, `superjson` encoding (so `Uint8Array` and `bigint` round-trip), scoped per account and per contract, with password rotation. It requires `accountId` (use the wallet address) and `password` (a string or a function returning one; at least 16 characters, never derived from public data). The previous store XOR-ed JSON with a default password and is not readable by the new provider; state written by it is not migrated.
- Both providers key state as `${contractAddress}:${privateStateId}`, as midnight-js expects (`setContractAddress` was a no-op before, so two contracts on one provider overwrote each other's state), and fail if no address was set.
- New `PrivateState.boundToContract(provider, address)`: a view fixed to one contract. Contract handles use it, so several contracts can share a provider without interleaving.
- Removed: `PrivateState.makeIndexedDB`, `makeInMemory`, the `PrivateState.get/set/...` module functions, `PrivateStateService`/`PrivateStateLive`, and the unused `storage` client option. The `browser-level` dependency is gone.
