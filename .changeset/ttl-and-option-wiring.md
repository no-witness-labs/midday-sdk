---
'@no-witness-labs/midday-sdk': minor
---

Transaction TTLs are now anchored after the wallet has finished syncing, so a slow sync can no longer consume the TTL before balancing (the node then rejected the intent with error 182 after proving). A caller-supplied TTL that has already passed by then fails immediately instead of being submitted.

Client options that were silently ignored are now wired or rejected: `Client.create({ wallet, feeRelay })` applies the relay for browser wallets (previously only `Client.fromWallet` did, so the documented `create` form paid fees from the user's wallet) and fails for seed wallets, which cannot balance without fees; `txTtlMs` applies on the `create({ wallet })` path (new `Wallet.ProvidersOptions`); `txTtlMs` is removed from `FromWalletConfig` because browser wallets set their own TTL.

`TxTimeoutError` is one class for the whole SDK (`Client.TxTimeoutError === Contract.TxTimeoutError`) with `operation: 'deploy' | 'join' | 'waitForTx'` and an optional `txHash`, instead of two classes sharing a `_tag`.
