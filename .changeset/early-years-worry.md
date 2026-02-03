---
"@no-witness-labs/midday-sdk": patch
---

Add comprehensive E2E testing infrastructure

- Add E2E test suite for contract deployment lifecycle
- Add counter contract for testing with Compact source and compiled artifacts
- Add waitForIndexerSynced utility for genesis dust availability
- Add Docker healthchecks matching docker-compose configuration
- Add GitHub Actions workflow for E2E tests
- Fix SigningKey type in IndexedDBPrivateStateProvider
- Pin onchain-runtime-v1 to 1.0.0-alpha.5 for compatibility