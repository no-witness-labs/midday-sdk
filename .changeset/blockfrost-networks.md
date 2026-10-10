---
'@no-witness-labs/midday-sdk': minor
---

Preprod and mainnet now go through Blockfrost: add `Config.blockfrost(network, projectId)` and `Config.redactUrl()`. The retired `NETWORKS.preprod` preset is removed, and `getNetworkConfig('preprod')` now throws with a pointer to `Config.blockfrost`. Devnet and CI use proof server 8.1.3.
