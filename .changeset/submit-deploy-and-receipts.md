---
'@no-witness-labs/midday-sdk': minor
---

Transaction results say what actually happened.

- Actions and `client.waitForTx` resolve to a `FinalizedReceipt`: `{ phase: 'finalized', txId, identifiers, txHash, blockHeight, blockHash, status }` with `status` typed as `'SucceedEntirely' | 'FailEntirely' | 'FailFallible'`. Previously `CallResult` carried only `txHash`, `blockHeight` and an untyped `status`, `waitForTx` dropped the status entirely (a finalized-but-failed transaction looked like success), and the identifiers the SDK watches by were discarded. `CallResult` remains as a deprecated alias of `FinalizedReceipt`.
- `client.waitForTx(txId)` takes the transaction id (what the indexer watches by), not the hash; `TxTimeoutError.txHash` → `txId`.
- `DeployOptions.skipFinalization` and `onSubmit` are removed. The two deploy states now have two shapes: `loaded.deploy(options)` submits and waits (its `timeout` bounds the whole pipeline), and `loaded.submitDeploy(options)` returns `{ phase: 'submitted', address, txId, wait(options?) }` so an application can show progress and obtain the usable handle later. `wait()` resolves only for `SucceedEntirely`.
