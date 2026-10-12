---
'@no-witness-labs/midday-sdk': patch
---

Two private-state fixes.

- `join(address)` no longer wipes stored private state. It passed `initialPrivateState: {}` by default, and midnight-js replaces the stored state whenever that option is present, so an application that persisted state, restarted and joined its contract lost the state. `initialPrivateState` is now only passed when the caller supplies it (a deliberate replacement) or when nothing is stored yet (first join, `{}`).
- `PrivateState.boundToContract` views spell out every method instead of spreading the shared provider. `exportPrivateStates`/`importPrivateStates` run inside the view's queue bound to its contract (previously they used whatever address the shared provider happened to hold); `clear()` on a view is refused with an explanation, since the underlying `clear` erases every contract's state in the store; signing-key methods pass through (they take an explicit address).
