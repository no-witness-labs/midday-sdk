---
'@no-witness-labs/midday-sdk': patch
---

Browser-wallet submissions now return a real transaction identifier (`tx.identifiers()[0]`, the id the indexer watches by) instead of the serialized transaction hex; this applies to `ConnectedWallet.providers().midnightProvider.submitTx` and to `shield`/`unshield` results. New `Wallet.transactionIdOf(tx)`.

`deploy()` now checks the finalized status: a deploy transaction that lands with anything other than `SucceedEntirely` fails with a `ContractError` naming the address, tx id and status, instead of returning a handle for a contract that does not exist. The `skipFinalization` option no longer installs a fake `{ status: 'submitted' }` watcher for later calls; midnight-js rejects any call whose watched status is not `SucceedEntirely`, so that stub made every call after a `skipFinalization` deploy fail.
