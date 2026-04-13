---
"@no-witness-labs/midday-sdk": patch
---

Fix `Wallet.getBalance().dust` reporting zero on seed-backed wallets.

`getBalanceFromSeedEffect` was calling `state.dust.walletBalance(time)` and `state.dust.walletCap(time)`, neither of which exist on `DustWalletState`. Optional chaining (`?.`) silently returned `undefined` and the `?? 0n` fallback masked the bug — `wallet.getBalance().dust.balance` always showed `0` even when DUST was present, which made it look like every faucet-funded wallet was missing DUST registration.

The real APIs are `state.dust.balance(time: Date): bigint` and `state.dust.availableCoinsWithFullInfo(time: Date): readonly DustFullInfo[]` (sum `.maxCap` for total capacity). Fixed both.

Downstream effect: apps using `Wallet.getBalance().dust.balance` for UI display will now show real values. Fee-paying wallet operations were never affected (the underlying facade balancer always saw real DUST), only the query display.
