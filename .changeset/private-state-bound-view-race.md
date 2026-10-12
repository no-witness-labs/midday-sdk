---
'@no-witness-labs/midday-sdk': patch
---

Fixes cross-contract private-state corruption with the persistent provider. `PrivateState.boundToContract` re-bound the shared provider's address synchronously before each call, but midnight-js's level provider awaits a rotation lock before it reads the address in `set`/`remove`, so a concurrent operation from another contract's view could move the address in between and a write for contract A landed under contract B. Views bound to the same underlying provider now take turns: each operation re-binds its address and completes before the next starts.
