---
"@no-witness-labs/midday-sdk": patch
---

Restructure SDK to namespace-only exports for cleaner API surface.

All exports are now accessed via namespaces:

```typescript
import * as Midday from '@no-witness-labs/midday-sdk';

Midday.Client.create({ ... });
Midday.PrivateState.inMemoryPrivateStateProvider();
Midday.Hash.bytes32(value);
```

New modules: `Hash`, `ZkConfig`, `PrivateState`, `Runtime`, `Utils`, `BrowserWallet`
