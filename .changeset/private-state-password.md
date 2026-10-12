---
'@no-witness-labs/midday-sdk': patch
---

`persistentPrivateStateProvider` validates a string `password` against midnight-js's policy when the provider is created (≥ 16 characters, at least 3 of {lowercase, uppercase, digits, other}, no run of 4 identical or sequential characters) and fails with a `PrivateStateError` naming the rule. It was previously checked on the first write, which during `deploy()` happens after the deploy transaction has been submitted, leaving a deployed contract whose private state and signing key were never stored. Function passwords are still checked on first use.

New `PrivateState.derivePassword(secret)`: a deterministic, always-compliant password from a secret of at least 32 bytes, for applications that already hold one. Random strings (hex in particular) fail the policy often enough that deriving a password ad hoc is unsafe.
