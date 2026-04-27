---
"@no-witness-labs/midday-sdk": patch
---

Remove `signTransactionIntents` workaround in favor of upstream `WalletFacade.signRecipe`.

The workaround predated `wallet-sdk-unshielded-wallet@1.0.0`, where `addSignature` hard-coded the `'pre-proof'` proof marker even when cloning intents that already carried `'proof'` after balancing — causing `Failed to clone intent` at finalize time. `wallet-sdk-facade@4.0.0` (in the 2026-04-23 release batch) fixes this by routing the proven base transaction through `signUnboundTransaction` and the unproven balancer through `signUnprovenTransaction`, each with the correct marker. `signRecipe` now produces the same output as the manual hand-rolled path.

Internal-only cleanup. No public API change. Validated against the contract and witness-contract E2E suites (9/9 passing) covering deploy + circuit-call flows.
