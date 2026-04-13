---
"@no-witness-labs/midday-sdk": patch
---

Fix `Wallet.shield()` and `Wallet.unshield()` failing with `Wallet.InsufficientFunds` on freshly-funded wallets.

The previous implementation used `wallet.transferTransaction()` with an output of `type: 'shielded'` for shielding (and `'unshielded'` for unshielding). `transferTransaction` selects inputs from the **same pool** as the output kind — so for `type: 'shielded'` it can only spend shielded UTXOs. On a wallet with NIGHT only in the unshielded pool (every freshly-faucet'd wallet), this returned `Insufficient funds` because there were no shielded UTXOs to spend.

The correct API for cross-pool conversion is `wallet.initSwap(desiredInputs, desiredOutputs, secretKeys, options)`, which takes explicit per-pool input and output specifications. The fix uses `initSwap` for both `shield` (unshielded inputs → shielded outputs) and `unshield` (shielded inputs → unshielded outputs).

Why this wasn't caught earlier: on local devnet with the genesis seed, the wallet has *both* shielded and unshielded NIGHT pre-funded, so the old `transferTransaction(shielded → shielded)` call happened to find shielded UTXOs to spend — semantically a no-op move within the same pool, but it didn't error. Real wallets funded only via faucet (preview/preprod) hit the bug immediately.
