---
"@no-witness-labs/midday-sdk": patch
---

Add `ConnectedWallet.registerDust()` and `ConnectedWallet.deregisterDust()` helpers as an escape hatch for managing DUST generation from unshielded NIGHT UTXOs.

```ts
const wallet = await Midday.Wallet.fromSeed(seed, networkConfig);

// Register all currently-unregistered NIGHT UTXOs for DUST generation.
const { txId, count } = await wallet.registerDust();
console.log(`Registered ${count} NIGHT UTXOs. tx=${txId}`);

// Or register a specific subset:
await wallet.registerDust({ utxos: [...] });

// Inverse:
await wallet.deregisterDust();
```

**When this is needed.** In practice, **rarely**. Midnight's preview/preprod faucets and local devnet genesis already register NIGHT for DUST generation at mint time — all UTXOs arrive with `meta.registeredForDustGeneration: true`. This helper is an escape hatch for wallets that acquired NIGHT via a path that skipped registration (e.g., a contract payout, a direct transfer from another wallet), or for ops scripts that want to deregister before transferring NIGHT out.

Calling `registerDust()` on a wallet whose NIGHT is already fully registered throws a clear error instead of submitting a no-op tx.

**Seed-backed wallets only.** The Lace DApp Connector does not expose DUST registration programmatically; Lace users must register via the extension UI. Calling `registerDust()` on a browser-backed wallet throws a clear error directing to the UI.
