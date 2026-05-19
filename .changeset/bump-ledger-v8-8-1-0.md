---
"@no-witness-labs/midday-sdk": patch
---

Bump `@midnight-ntwrk/ledger-v8` from 8.0.3 to 8.1.0 (stable).

8.1.0 is the stable successor to 8.0.3 (previously only published as `8.1.0-rc.1`). It is ABI/type-compatible — no public API changes; the SDK builds and typechecks clean against it, and it satisfies `@midnight-ntwrk/wallet-sdk-facade@4.0.0`'s `^8.0.3` range. The `pnpm.overrides` pin is bumped in lockstep so all transitive copies resolve to a single 8.1.0.
