---
'@no-witness-labs/midday-sdk': patch
---

`Client.create` no longer implies the public development seed when a custom `networkConfig` is given: the seed is only implied for the built-in `local` preset, and is refused outright (even when passed explicitly) on any network other than `undeployed`. A `network` preset name that contradicts `networkConfig.networkId` is rejected on `create` and `createReadonly` instead of silently using the custom endpoints under the other network's name.
