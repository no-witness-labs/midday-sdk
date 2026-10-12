---
'@no-witness-labs/midday-sdk': patch
---

Closes the remaining way a private-state operation could be redirected to another contract. `boundToContract` views serialize their operations, but the view's own `setContractAddress` (which midnight-js calls right before every access) still moved the shared address outside that queue, so an operation parked on the level provider's internal await could pick up another contract's address. The view's `setContractAddress` now only validates the requested address; the address is bound exclusively inside each queued operation. Regression test uses a provider whose `set` awaits before reading the address, so the interleaving is deterministic.
