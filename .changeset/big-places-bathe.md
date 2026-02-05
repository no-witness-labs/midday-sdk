---
"@no-witness-labs/midday-sdk": patch
---

Upgrade to v7 Midnight devnet stack

- Docker: node 0.20.1, indexer 3.0.0, proof-server 7.0.0
- NPM: compact-runtime 0.14.0, ledger-v7 7.0.0, midnight-js-* 3.0.0
- Compact: compactc v0.28.0, language_version 0.20
- Breaking: deployContract/joinContract require CompiledContract.make() wrapper
