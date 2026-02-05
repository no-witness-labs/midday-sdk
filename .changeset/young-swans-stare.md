---
"@no-witness-labs/midday-sdk": patch
---

Add type-safe contract inference

Contract types are now automatically inferred from your Compact module:

```typescript
import * as CounterContract from './contracts/counter/contract';

const contract = await client.loadContract({
  module: CounterContract,
  zkConfig: Midday.ZkConfig.fromPath('./contracts/counter'),
});

// ledgerState() returns typed Ledger - no cast needed
const state = await contract.ledgerState();
console.log(state.counter); // bigint

// call() autocompletes circuit names
await contract.call('increment'); // 'increment' | 'decrement'
```

New type utilities:
- `InferLedger<M>` - extract ledger type from module
- `InferCircuits<M>` - extract circuit names as union type
