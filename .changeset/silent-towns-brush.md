---
"@no-witness-labs/midday-sdk": patch
---

Add devnet module for local development and testing

- Add `Cluster` module for managing devnet lifecycle (create, start, stop, remove)
- Add `Container` module for Docker container operations
- Add `Health` module for service health checks (node, indexer, proof server)
- Add `Images` module for Docker image management
- Add `Config` module with sensible defaults for Midnight Network stack
- Support for Midnight node, indexer, and proof server containers
