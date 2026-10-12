---
'@no-witness-labs/midday-sdk': minor
---

Failures keep their identity, and subscriptions can report theirs.

- New `Contract.StateDecodeError` (`address`, `cause`): a `ledger()` parser that throws on a state value (wrong contract, wrong compiler cohort, stale artifacts) was previously an unhandled defect outside the typed error channel.
- State readers fail with `StateReadError = ContractError | ContractStateNotFoundError | StateDecodeError | IndexerQueryTimeoutError`; an indexer query timeout now surfaces as itself instead of wrapped in `ContractError`, so `catchTag('IndexerQueryTimeoutError')` works.
- `client.loadContract` passes `ContractLoadArgsError` through instead of wrapping it in `ClientError`.
- `onStateChange` / `onStateValueChange` (deployed and read-only handles, and the module functions) accept a plain callback or `{ next, error }`. Without `error`, a failed subscription still ends silently; with it, you learn that updates stopped and why. Async iteration (`watchState`) already throws the failure from `next()`.
- A seed wallet whose initial sync fails or is interrupted is closed instead of left running in the background.
