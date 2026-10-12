---
'@no-witness-labs/midday-sdk': patch
---

Fixes two defects that only show up in a fresh consumer install, not in this workspace:

- Every clean install resolved **two** copies of `@midnight-ntwrk/onchain-runtime-v3` (`midnight-js-protocol` pins 3.0.0, `compact-runtime` accepts `^3.0.0` and got 3.1.2), which breaks contract state decoding with `expected instance of StateValue`. The SDK now declares `@midnight-ntwrk/onchain-runtime-v3@3.0.0` as a peer dependency; package managers that auto-install peers resolve one copy with no extra configuration. The documented fallback is corrected too: with pnpm 10+ an override belongs in `pnpm-workspace.yaml` (the `pnpm.overrides` field in `package.json` is ignored there), or add the pinned version as a direct dependency.
- `Images.buildServerImage` could not build the faucet/fee-relay images from an installed package: the Dockerfile copied sources and workspace manifests that are not published. The Dockerfile now builds from `package.json` and `dist/` with dependencies from the registry, so it works from a checkout (after `pnpm build`) and from `node_modules/@no-witness-labs/midday-sdk` alike.

New `test/consumer.integration.test.ts` packs the SDK, installs it into a clean project and asserts a single runtime copy and a working import; it runs in CI.
