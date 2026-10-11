---
'@no-witness-labs/midday-sdk': patch
---

Devnet now runs the ledger-8 compatibility set: `midnight-node:1.0.400` and `indexer-standalone:4.3.7` (proof server 8.1.3). The indexer gets the SPO node settings it now requires, the cluster waits for the node's first block before starting the indexer, and proof server readiness is checked via `/ready` instead of an open port.
