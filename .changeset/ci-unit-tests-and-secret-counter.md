---
'@no-witness-labs/midday-sdk': patch
---

CI now runs lint and the Docker-free unit suite (`pnpm test:unit`) on every push and pull request; previously only type-check, build and the devnet e2e ran, so the config, wallet and private-state unit tests were never executed in CI.

The bundled `secret-counter` example contract tracks initialization with an explicit `initialized` flag. The previous guard compared `password_hash` with its default, so an `init` with the zero hash could be followed by a second `init` with any hash (#59). Artifacts recompiled with Compact 0.31.1.
