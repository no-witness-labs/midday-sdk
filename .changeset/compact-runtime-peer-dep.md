---
"@no-witness-labs/midday-sdk": patch
---

Add compact-runtime as peerDependency

User-compiled Compact contracts import `@midnight-ntwrk/compact-runtime` directly.
With pnpm's strict isolation, this must be declared as a peerDependency so users
know to install it alongside the SDK.
