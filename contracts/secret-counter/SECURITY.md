# Security Practices

## Witness Functions: Private State Management

Witness functions provide secrets (like passwords) to circuits without exposing them on-chain. However, they must properly manage private state.

### The Problem

```typescript
// WRONG: Returning undefined clears the private state
const witnesses: Contract.Witnesses<undefined> = {
  provide_password: () => [undefined, SECRET_PASSWORD],
};
```

When a witness returns `undefined` as the new private state, the private state is cleared. Subsequent contract calls will fail with "No private state found".

### The Solution

Always return a valid private state object:

```typescript
// CORRECT: Return an object to preserve private state
const witnesses: Contract.Witnesses<object> = {
  provide_password: () => [{}, SECRET_PASSWORD],
};

// OR if you need to persist data:
interface MyPrivateState {
  cachedValue: bigint;
}

const witnesses: Contract.Witnesses<MyPrivateState> = {
  provide_password: (context) => [
    context.privateState ?? { cachedValue: 0n },
    SECRET_PASSWORD
  ],
};
```

### Key Points

1. **Witness return type**: `(context) => [newPrivateState, witnessValue]`
2. **Context provides**: `context.privateState` (current state), `context.ledger`, `context.contractAddress`
3. **Never return `undefined`** as the first element of the tuple
4. **Use `object` type** if you don't need to persist data between calls

## One-Time Initialization Guard

Public initialization functions that set critical state (like password hashes, owner addresses, or configuration) should be protected against re-initialization attacks.

### The Problem

```compact
// UNSAFE: Anyone can reset the password after deployment
export circuit init(hash: Field): [] {
  password_hash = hash;
}
```

An attacker could call `init` after deployment to overwrite the password hash and take control of the contract.

### The Solution

Assert that the value is unset before allowing initialization:

```compact
// SAFE: Can only be called once
export circuit init(hash: Field): [] {
  assert password_hash == 0 as Field;
  password_hash = hash;
}
```

The assertion fails if `password_hash` has already been set, preventing re-initialization.

### When to Apply

Use this pattern for any initialization that:
- Sets ownership or access control values
- Configures cryptographic parameters (hashes, keys)
- Establishes one-time settings that shouldn't change

### Alternative: Constructor Initialization

If your deployment mechanism supports it, initialize critical state in the constructor/deployment transaction rather than a separate circuit call.
