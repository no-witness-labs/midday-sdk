---
"@no-witness-labs/midday-sdk": patch
---

Bump `@midnight-ntwrk/ledger-v8` from 8.0.3 to 8.1.0 (stable), with the bundled devnet images moved in lockstep.

- `@midnight-ntwrk/ledger-v8` `8.0.3` → `8.1.0` (the stable successor to 8.0.3; previously only `8.1.0-rc.1`). ABI/type-compatible — no public API changes; satisfies `@midnight-ntwrk/wallet-sdk-facade@4.0.0`'s `^8.0.3`. The `pnpm.overrides` pin is bumped in lockstep so transitive copies resolve to a single 8.1.0.
- Devnet defaults (`src/devnet/Config.ts`): `proof-server` `8.0.3` → `8.1.0` (proof-server version is coupled to the ledger version; an 8.1.0 client cannot prove against `proof-server:8.0.3`) and `midnight-node` `0.22.3` → `0.22.5` (latest 0.22.x stable) for alignment.
