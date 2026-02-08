---
"@no-witness-labs/midday-sdk": patch
---

Auto-build faucet/fee-relay Docker images inside SDK

- Add `Images.build()` for building Docker images from local context
- Auto-build in `Faucet.startDocker()` and `FeeRelay.startDocker()` when image is missing
- Ship `docker/` build contexts in npm package
- Remove `ensureDockerImage()` boilerplate from examples and template
