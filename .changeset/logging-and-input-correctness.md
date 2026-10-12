---
'@no-witness-labs/midday-sdk': minor
---

- SDK logging is now off by default (`logging: false` on `Client.create`, `Client.fromWallet`, `createReadonly` and contract loading), and `logging: false` is actually silent: it previously still installed a logger at the default level, so informational output kept appearing. Pass `logging: true` for debug output.
- `Hash.stringToBytes32` (and therefore `Hash.password`) throws a `RangeError` for input longer than 32 UTF-8 bytes instead of truncating it; truncation gave distinct inputs the same commitment.
- Removed `Utils.parseShieldedAddress`, `Utils.ParsedAddress` and the hand-rolled bech32m decoder: unused, keyed on a `midnight` prefix that Midnight addresses do not have, and it discarded the checksum without checking it. Use `MidnightBech32m.parse` from `@midnight-ntwrk/wallet-sdk-address-format` for address parsing.
- README: the Effect DI example now passes the required `zkConfig` to `loadContract`.
