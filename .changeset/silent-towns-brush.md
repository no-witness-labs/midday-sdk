---
"@no-witness-labs/midday-sdk": minor
---

Add devnet module for local development and testing

**New Features:**
- `Cluster` module with instance-based API for managing devnet lifecycle
- `Container` module for Docker container operations
- `Health` module for service health checks (node, indexer, proof server)
- `Images` module for Docker image management
- `Config` module with sensible defaults for Midnight Network stack
- Tagged error types (`ClusterError`, `ContainerError`, `HealthCheckError`)
- Service tags for dependency injection (`ClusterService`, `ContainerService`, `HealthService`)

**Usage:**
```typescript
import { Cluster } from '@no-witness-labs/midday-sdk/devnet';

const cluster = await Cluster.make();
await cluster.start();
console.log(cluster.networkConfig);
await cluster.remove();
```
