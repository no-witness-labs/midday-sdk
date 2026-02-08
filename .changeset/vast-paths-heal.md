---
"@no-witness-labs/midday-sdk": patch
---

fix: replace require() with await import() in Client.ts to prevent bundlers from statically following import chains into WASM/Node.js packages
