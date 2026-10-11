---
'@no-witness-labs/midday-sdk': patch
---

Indexer queries made through `Config.publicDataProvider` (and so every client) now fail with `IndexerQueryTimeoutError` after 60 s instead of waiting forever on a stalled connection, which could hang a contract call before proving. Set `queryTimeoutMs` to change the bound; `Config.withQueryTimeout` applies it to any provider.
